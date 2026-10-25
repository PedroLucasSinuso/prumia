import { ClipboardPaste, FileUp, ListChecks, Receipt, ScanText } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { extractDocument, MAX_PARSE_TEXT, parseDocumentText, useCategories, useInvoiceActions, usePayees } from '../api/queries'
import { ApiError } from '../api/errors'
import type { Category, DocumentExtraction } from '../api/types'
import { boletoErrorMessage, networkErrorMessage, problemMessage } from '../auth/errors'
import { useActiveHouse } from '../auth/useActiveHouse'
import { Button } from './Button'
import { FormError } from './FormError'
import { MoneyInput } from './MoneyInput'
import { DatePicker } from './ui/DatePicker'
import { MonthPicker } from './ui/MonthPicker'
import { useToast } from './toastContext'
import { MAX_BOLETO_BYTES } from '../lib/boleto'
import { buildTree } from '../lib/categories'
import { formatDigitableLine } from '../lib/boleto'
import { isValidISO, todayISO } from '../lib/dates'
import { markRepeated, progressMarks, RETRY_DELAYS_MS, rowErrors, rowsFrom, toInput, type ImportRow } from '../lib/importing'
import { formatCents } from '../lib/money'

type FileStatus = 'waiting' | 'reading' | 'retrying' | 'password' | 'done' | 'error'

/** Um arquivo escolhido. O File e a URL de pré-visualização só existem na memória do navegador (nunca vão para o estado do servidor). */
type FileEntry = {
  id: string
  name: string
  file?: File
  /** Texto colado (no lugar de arquivo): fica só na memória até a leitura dar certo. */
  text?: string
  /** object URL da imagem, para a pré-visualização (revogada ao sair da tela). */
  url?: string
  isPdf: boolean
  status: FileStatus
  message?: string
  wrongPassword?: boolean
  found?: number
}

/** Estado que o formulário de conta passa ao "Abrir em Importar" (uma lista lida lá). */
export type ImportState = { extraction: DocumentExtraction; fileName: string }

const label = 'text-xs font-medium uppercase tracking-wider text-ink/70'
const input = 'h-11 w-full rounded-md border border-line bg-surface px-2 text-sm text-ink md:h-9'
const link = 'text-sm font-semibold text-accent underline underline-offset-4'
const ACCEPT = 'application/pdf,image/png,image/jpeg'

const originText: Record<ImportRow['origin'], string> = { boleto: 'boleto', bill: 'conta', list: 'lista' }

/** Vencimento só aceito se for uma data real e de um ano plausível (o servidor recusa o lote inteiro com uma data torta). */
const validDueDate = (iso: string) => isValidISO(iso) && Number(iso.slice(0, 4)) >= 2000 && Number(iso.slice(0, 4)) <= 2100

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let fileSeq = 0

/**
 * "Importar": escolher um ou vários arquivos (PDF, foto, print) -> cada um é lido em sequência no servidor -> revisar
 * uma linha por conta encontrada (boleto, conta sem boleto ou cada item de uma lista) -> "Criar N contas" (um lote só,
 * tudo ou nada). Nada é criado antes da revisão. Celular: cartões editáveis. Computador: arquivo à esquerda, contas à direita.
 */
// O que a tela lê, mostrado enquanto ela está vazia (a funcionalidade precisa se explicar sozinha).
const examples = [
  { Icon: Receipt, title: 'Boleto ou fatura', text: 'Linha digitável, valor, vencimento e quem recebe. Reconhece o favorecido pelo CNPJ.' },
  { Icon: ScanText, title: 'Conta em foto, sem código de barras', text: 'Lê valor, vencimento e mês de referência direto da imagem.' },
  { Icon: ListChecks, title: 'Lista, print de conversa ou texto', text: 'Uma conta por linha, "descrição: valor", com o vencimento se quiser: Gás: R$ 150,00 vence 10/11. Pode colar o texto.' },
]

export function ImportFlow({ onCreated }: { onCreated: (month: string) => void }) {
  const { house } = useActiveHouse()
  const houseId = house?.id ?? ''
  const canWrite = house?.role !== 'viewer'
  const categories = useCategories(houseId)
  const payees = usePayees(houseId)
  const actions = useInvoiceActions(houseId)
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()

  const [files, setFiles] = useState<FileEntry[]>([])
  const [rows, setRows] = useState<ImportRow[]>([])
  const [selected, setSelected] = useState<string>()
  const [errors, setErrors] = useState<Record<string, Record<string, string>>>({})
  const [error, setError] = useState<string>()
  const [dragging, setDragging] = useState(false)
  const [pasting, setPasting] = useState(false)
  const [pasted, setPasted] = useState('')

  // O laço de leitura é assíncrono e longo: lê o estado mais recente por refs (o estado do React "congela" no closure).
  const filesRef = useRef<FileEntry[]>([])
  const running = useRef(false)
  const alive = useRef(true)
  // Senha do PDF: só na memória até o reenvio, nunca no estado do React.
  const passwords = useRef(new Map<string, string>())
  const picker = useRef<HTMLInputElement>(null)
  const ready = categories.isSuccess && payees.isSuccess
  const cats = useMemo(() => categories.data ?? [], [categories.data])
  const tree = useMemo(() => buildTree(cats), [cats])

  const setAll = (next: FileEntry[]) => {
    filesRef.current = next
    setFiles(next)
  }
  const patch = (id: string, p: Partial<FileEntry>) => setAll(filesRef.current.map((f) => (f.id === id ? { ...f, ...p } : f)))

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      for (const f of filesRef.current) if (f.url) URL.revokeObjectURL(f.url)
    }
  }, [])

  // Lista vinda do formulário de conta ("Abrir em Importar"): entra já lida, sem arquivo para pré-visualizar.
  const fromState = (location.state as ImportState | null) ?? null
  const consumed = useRef(false)
  useEffect(() => {
    if (!fromState || !ready || consumed.current) return
    consumed.current = true
    const id = `f${++fileSeq}`
    const found = rowsFrom(fromState.extraction, id, todayISO(), cats, payees.data ?? [])
    setAll([...filesRef.current, { id, name: fromState.fileName, isPdf: false, status: 'done', found: found.length }])
    setRows((rs) => markRepeated([...rs, ...found]))
    setSelected(id)
    // Tira o estado do histórico: recarregar a página não duplica as linhas.
    navigate(location.pathname, { replace: true, state: null })
  }, [fromState, ready, cats, payees.data, navigate, location.pathname])

  async function readOne(entry: FileEntry) {
    patch(entry.id, { status: 'reading', message: undefined })
    for (let attempt = 0; ; attempt++) {
      const password = passwords.current.get(entry.id)
      passwords.current.delete(entry.id)
      try {
        const ext = entry.text !== undefined ? await parseDocumentText(houseId, entry.text) : await extractDocument(houseId, entry.file as File, password)
        if (!alive.current) return
        const found = rowsFrom(ext, entry.id, todayISO(), cats, payees.data ?? [])
        setRows((rs) => markRepeated([...rs, ...found]))
        patch(entry.id, { status: 'done', found: found.length, text: undefined })
        setSelected((s) => s ?? entry.id)
        return
      } catch (err) {
        if (!alive.current) return
        const api = err instanceof ApiError ? err : undefined
        const code = api?.problem?.code
        // O servidor limita as leituras por pessoa e por vez: espera e tenta de novo, sem perder a fila.
        if ((code === 'too_many_requests' || code === 'busy') && attempt < RETRY_DELAYS_MS.length) {
          patch(entry.id, { status: 'retrying' })
          await sleep(RETRY_DELAYS_MS[attempt])
          if (!alive.current) return
          patch(entry.id, { status: 'reading' })
          continue
        }
        if (code === 'password_required' || code === 'wrong_password') {
          patch(entry.id, { status: 'password', wrongPassword: code === 'wrong_password' })
          return
        }
        patch(entry.id, { status: 'error', message: api?.network ? networkErrorMessage : documentError(code, entry.text !== undefined) })
        return
      }
    }
  }

  // Lê a fila um arquivo por vez (o servidor também só aceita poucas leituras ao mesmo tempo).
  async function run() {
    if (running.current) return
    running.current = true
    try {
      for (;;) {
        const next = filesRef.current.find((f) => f.status === 'waiting')
        if (!next || !alive.current) break
        await readOne(next)
      }
    } finally {
      running.current = false
    }
  }

  function add(list: FileList | File[]) {
    const added: FileEntry[] = Array.from(list).map((file) => {
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
      const tooBig = file.size > MAX_BOLETO_BYTES
      const isImage = file.type.startsWith('image/')
      return {
        id: `f${++fileSeq}`, name: file.name, file, isPdf,
        url: isImage && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : undefined,
        status: tooBig ? 'error' : 'waiting',
        message: tooBig ? boletoErrorMessage({ title: 'file_too_large', status: 413, code: 'file_too_large' }) : undefined,
      }
    })
    if (added.length === 0) return
    setAll([...filesRef.current, ...added])
    setSelected((s) => s ?? added[0].id)
    void run()
  }

  /** "Colar texto": o texto entra na MESMA fila dos arquivos e cai na mesma tabela de revisão. */
  function addText() {
    const text = pasted.trim()
    if (!text) return
    const n = filesRef.current.filter((f) => f.text !== undefined || f.name.startsWith('texto')).length
    const entry: FileEntry = { id: `f${++fileSeq}`, name: n === 0 ? 'texto' : `texto ${n + 1}`, text, isPdf: false, status: 'waiting' }
    setAll([...filesRef.current, entry])
    setSelected((s) => s ?? entry.id)
    setPasted('')
    setPasting(false)
    void run()
  }

  function sendPassword(id: string, el: HTMLInputElement | null) {
    const pw = el?.value ?? ''
    if (el) el.value = ''
    if (!pw) return
    passwords.current.set(id, pw)
    patch(id, { status: 'waiting', wrongPassword: false })
    void run()
  }

  function removeFile(id: string) {
    const f = filesRef.current.find((x) => x.id === id)
    if (f?.url) URL.revokeObjectURL(f.url)
    setAll(filesRef.current.filter((x) => x.id !== id))
    setRows((rs) => markRepeated(rs.filter((r) => r.fileId !== id)))
    setSelected((s) => (s === id ? filesRef.current[0]?.id : s))
  }

  const editRow = (key: string, p: Partial<ImportRow>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)))
    setErrors(({ [key]: _gone, ...rest }) => rest)
    setError(undefined)
  }

  const included = rows.filter((r) => r.include)
  const total = included.reduce((s, r) => s + r.amountCents, 0)
  const done = files.filter((f) => f.status !== 'waiting' && f.status !== 'reading' && f.status !== 'retrying').length
  const busy = files.some((f) => f.status === 'waiting' || f.status === 'reading' || f.status === 'retrying')
  const current = files.findIndex((f) => f.status === 'reading' || f.status === 'retrying')
  const waitingServer = files.some((f) => f.status === 'retrying')
  const preview = files.find((f) => f.id === selected)

  async function create() {
    // Confere o básico aqui (o servidor confere de novo): cada linha precisa de descrição, valor e categoria.
    const local: Record<string, Record<string, string>> = {}
    for (const r of included) {
      const e: Record<string, string> = {}
      if (!r.description.trim()) e.description = 'informe a descrição'
      if (r.amountCents <= 0) e.amountCents = 'informe o valor'
      if (!r.categoryId) e.categoryId = 'escolha a categoria'
      if (!r.dueDate) e.dueDate = 'informe o vencimento'
      else if (!validDueDate(r.dueDate)) e.dueDate = 'data de vencimento inválida'
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.competence)) e.competenceMonth = 'informe o mês de competência'
      if (Object.keys(e).length) local[r.key] = e
    }
    if (Object.keys(local).length) {
      setErrors(local)
      setError('Confira as contas marcadas.')
      return
    }
    try {
      const res = await actions.createBatch.mutateAsync(included.map(toInput))
      const ids = res.items.map((i) => i.id)
      const month = included[0].competence
      toast({
        message: ids.length === 1 ? '1 conta criada.' : `${ids.length} contas criadas.`,
        actionLabel: 'Desfazer',
        onAction: () => {
          void Promise.all(ids.map((id) => actions.remove.mutateAsync({ id }))).catch(() =>
            toast({ message: 'Não foi possível desfazer tudo. Exclua as que sobraram no mês.' }),
          )
        },
      })
      onCreated(month)
    } catch (err) {
      const api = err instanceof ApiError ? err : undefined
      if (api?.problem?.fields) {
        setErrors(rowErrors(api.problem.fields, included))
        setError('Confira as contas marcadas.')
      } else {
        setError(api?.network ? networkErrorMessage : api?.problem?.detail && api.problem.status === 409 ? api.problem.detail : problemMessage(api?.problem))
      }
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (canWrite && ready) add(e.dataTransfer.files)
  }

  return (
    <div className="flex flex-col gap-5 md:gap-6">
        {!canWrite && (
          <p className="rounded-md border border-line px-3 py-2 text-sm">Seu papel nesta casa é somente leitura: não dá para criar contas.</p>
        )}

        {canWrite && (
          <section
            aria-label="Arquivos"
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`flex gap-3 rounded-md border border-dashed transition-colors duration-150 ${dragging ? 'border-accent bg-accent/10' : 'border-line'} ${
              files.length === 0
                ? 'flex-col items-center justify-center px-4 py-10 text-center md:min-h-72'
                : 'flex-col items-start p-4 md:flex-row md:items-center md:justify-between'
            }`}
          >
            <input
              ref={picker}
              type="file"
              multiple
              // Sem `capture`: no celular o sistema oferece câmera, galeria e arquivos.
              accept={ACCEPT}
              aria-label="Arquivos para importar"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) add(e.target.files)
                e.target.value = ''
              }}
            />
            {files.length === 0 && <FileUp aria-hidden="true" size={40} strokeWidth={1.25} className="text-accent" />}
            <div className="text-sm">
              <p className={files.length === 0 ? 'text-base font-semibold' : 'font-semibold'}>PDF, foto ou print, um ou vários (até 5 MB cada).</p>
              <p className="hidden text-ink/75 md:block">Arraste os arquivos para cá ou escolha no computador.</p>
              <p className="text-ink/75 md:hidden">Tire uma foto, escolha da galeria ou dos arquivos.</p>
            </div>
            <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row">
              <Button type="button" disabled={!ready} onClick={() => picker.current?.click()} className="w-full md:h-9 md:w-auto">
                {files.length ? 'Adicionar arquivos' : 'Escolher arquivos'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={!ready}
                aria-expanded={pasting}
                onClick={() => setPasting((v) => !v)}
                className="w-full md:h-9 md:w-auto"
              >
                <ClipboardPaste aria-hidden="true" size={16} strokeWidth={1.5} className="mr-2 inline" />
                Colar texto
              </Button>
            </div>
          </section>
        )}

        {canWrite && pasting && (
          <section aria-label="Colar texto" className="flex flex-col gap-2 rounded-md border border-line bg-surface p-4">
            <label htmlFor="texto-contas" className={label}>Texto das contas</label>
            <textarea
              id="texto-contas"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              maxLength={MAX_PARSE_TEXT}
              rows={6}
              autoFocus
              placeholder={'Gás: R$ 150,00\nMercado: 310,25\nInternet: 119,90'}
              className="w-full rounded-md border border-line bg-surface p-2 font-mono text-sm text-ink"
            />
            <p className="text-xs text-ink/70">
              Uma conta por linha: <strong>descrição: valor</strong>, e se quiser o vencimento: <strong>Luz: R$ 210,35 vence 10/11</strong> (também vale 10/11/2026, 10/11/26 ou "dia 10"; sem ano, o app escolhe o próximo). Aceita R$ 1.234,56, R$150, 154,72 e 150 (número inteiro só vale em lista com 2 ou mais contas com R$ ou vírgula).
            </p>
            <div className="flex gap-2">
              <Button type="button" disabled={!pasted.trim()} onClick={addText} className="md:h-9">Ler texto</Button>
              <Button type="button" variant="ghost" onClick={() => { setPasting(false); setPasted('') }} className="md:h-9">Cancelar</Button>
            </div>
          </section>
        )}

        {canWrite && files.length === 0 && (
          <ul aria-label="O que dá para importar" className="grid gap-3 text-sm md:grid-cols-3">
            {examples.map(({ Icon, title, text }) => (
              <li key={title} className="flex gap-3 rounded-md border border-line p-3">
                <Icon aria-hidden="true" size={20} strokeWidth={1.5} className="mt-0.5 shrink-0 text-accent" />
                <span>
                  <span className="block font-semibold">{title}</span>
                  <span className="block text-ink/75">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {files.length > 0 && (
          <p role="status" aria-live="polite" className="font-mono text-sm uppercase tracking-wider tabular-nums">
            <span aria-hidden="true">{progressMarks(done, files.length)}</span>{' '}
            {busy
              ? waitingServer
                ? `aguardando o servidor… ${current + 1} de ${files.length}`
                : `lendo ${current + 1} de ${files.length}`
              : `${files.length === 1 ? '1 arquivo lido' : `${files.length} arquivos lidos`} · ${rows.length === 1 ? '1 conta' : `${rows.length} contas`}`}
          </p>
        )}

        {files.length > 0 && (
          <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start lg:gap-8">
            <aside aria-label="Arquivos lidos" className="flex flex-col gap-3 lg:sticky lg:top-0">
              <ul className="flex flex-col divide-y divide-ink/10 rounded-md border border-line">
                {files.map((f) => (
                  <FileItem
                    key={f.id}
                    file={f}
                    selected={f.id === selected}
                    onSelect={() => setSelected(f.id)}
                    onRemove={() => removeFile(f.id)}
                    onPassword={(el) => sendPassword(f.id, el)}
                    onRetry={() => { patch(f.id, { status: 'waiting' }); void run() }}
                  />
                ))}
              </ul>
              {preview && <Preview file={preview} />}
            </aside>

            <section aria-label="Contas encontradas" className="flex flex-col gap-3">
              {rows.length === 0 && !busy && (
                <p className="rounded-md border border-line p-4 text-sm text-ink/80">Nenhuma conta encontrada ainda.</p>
              )}
              <ul className="flex flex-col gap-3">
                {rows.map((r, i) => (
                  <RowEditor
                    key={r.key}
                    row={r}
                    index={i}
                    tree={tree}
                    categories={cats}
                    errors={errors[r.key]}
                    active={r.fileId === selected}
                    onFocus={() => setSelected(r.fileId)}
                    onChange={(p) => editRow(r.key, p)}
                    onRemove={() => setRows((rs) => markRepeated(rs.filter((x) => x.key !== r.key)))}
                  />
                ))}
              </ul>
              {rows.length > 0 && (
                <div className="flex flex-col gap-2 border-t border-line pt-3 md:flex-row md:items-center md:justify-between">
                  <p className="text-sm">
                    {included.length === 1 ? '1 conta' : `${included.length} contas`} ·{' '}
                    <span className="font-mono tabular-nums">{formatCents(total)}</span>
                  </p>
                  <Button type="button" disabled={included.length === 0 || busy || actions.createBatch.isPending} onClick={() => void create()} className="md:h-9">
                    {actions.createBatch.isPending ? 'Criando…' : included.length === 1 ? 'Criar 1 conta' : `Criar ${included.length} contas`}
                  </Button>
                </div>
              )}
              {error && <FormError message={error} />}
            </section>
          </div>
        )}
    </div>
  )
}

function documentError(code: string | undefined, isText = false): string {
  if (code === 'boleto_not_found' && isText) return 'Não encontrei contas neste texto. Use uma conta por linha, "descrição: valor".'
  if (code === 'boleto_not_found') return 'Não encontrei boleto nem valor neste arquivo. Tente uma foto mais nítida ou lance à mão.'
  return boletoErrorMessage(code ? { title: code, status: 422, code } : undefined)
}

const statusText: Record<FileStatus, string> = {
  waiting: 'na fila', reading: 'lendo…', retrying: 'aguardando…', password: 'pede senha', done: 'lido', error: 'não lido',
}

function FileItem({ file, selected, onSelect, onRemove, onPassword, onRetry }: {
  file: FileEntry
  selected: boolean
  onSelect: () => void
  onRemove: () => void
  onPassword: (el: HTMLInputElement | null) => void
  onRetry: () => void
}) {
  const pw = useRef<HTMLInputElement>(null)
  const mark = file.status === 'done' ? '[ ▪ ]' : file.status === 'error' || file.status === 'password' ? '[ ✖ ]' : '[ ▫ ]'
  return (
    <li className={`flex flex-col gap-2 px-3 py-2 ${selected ? 'bg-accent/10' : ''}`}>
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className={`font-mono text-xs ${file.status === 'error' || file.status === 'password' ? 'text-alert' : 'text-accent'}`}>{mark}</span>
        <button type="button" onClick={onSelect} aria-pressed={selected} className="min-h-11 min-w-0 flex-1 truncate text-left text-sm md:min-h-8">
          {file.name}
        </button>
        <span className="shrink-0 text-xs text-ink/75">
          {file.status === 'done' ? (file.found === 1 ? '1 conta' : `${file.found} contas`) : statusText[file.status]}
        </span>
        <button type="button" onClick={onRemove} aria-label={`Tirar ${file.name}`} className="h-11 w-11 shrink-0 rounded-md text-ink/70 hover:bg-ink/5 md:h-8 md:w-8">
          ×
        </button>
      </div>
      {file.status === 'error' && file.message && (
        <div className="flex flex-col gap-1">
          <p className="text-xs">{file.message}</p>
          {((file.file && file.file.size <= MAX_BOLETO_BYTES) || file.text !== undefined) && (
            <button type="button" className={`${link} self-start text-xs`} onClick={onRetry}>
              Tentar de novo
            </button>
          )}
        </div>
      )}
      {file.status === 'password' && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`pw-${file.id}`} className={label}>Senha do PDF</label>
          <div className="flex gap-2">
            <input
              ref={pw}
              id={`pw-${file.id}`}
              type="password"
              autoComplete="off"
              aria-invalid={file.wrongPassword || undefined}
              className={input}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onPassword(pw.current) } }}
            />
            <Button type="button" className="shrink-0 md:h-9" onClick={() => onPassword(pw.current)}>Abrir</Button>
          </div>
          <p className="text-xs text-ink/70">{file.wrongPassword ? 'Senha incorreta. Confira e tente de novo.' : 'Usada só para abrir este arquivo; não fica guardada.'}</p>
        </div>
      )}
    </li>
  )
}

/** Pré-visualização do arquivo escolhido: a imagem em si; do PDF, o nome (o navegador não desenha PDF aqui). */
function Preview({ file }: { file: FileEntry }) {
  if (file.url) {
    return <img src={file.url} alt={`Pré-visualização de ${file.name}`} className="hidden max-h-[70vh] w-full rounded-md border border-line object-contain lg:block" />
  }
  return (
    <div className="hidden items-center gap-3 rounded-md border border-line p-4 text-sm lg:flex">
      <span aria-hidden="true" className="font-mono text-accent">{file.isPdf ? '[ PDF ]' : '[ ▫ ]'}</span>
      <span className="min-w-0 truncate">{file.name}</span>
    </div>
  )
}

function RowEditor({ row, index, tree, categories, errors = {}, active, onFocus, onChange, onRemove }: {
  row: ImportRow
  index: number
  tree: ReturnType<typeof buildTree>
  categories: Category[]
  errors?: Record<string, string>
  active: boolean
  onFocus: () => void
  onChange: (p: Partial<ImportRow>) => void
  onRemove: () => void
}) {
  const id = (f: string) => `r${index}-${f}`
  const err = (f: string) => errors[f] && <p className="text-xs text-alert">{errors[f]}</p>
  const otherErrors = Object.entries(errors).filter(([k]) => !['description', 'amountCents', 'dueDate', 'categoryId', 'competenceMonth'].includes(k))
  const known = categories.some((c) => c.id === row.categoryId)
  return (
    <li
      aria-label={`Conta ${index + 1}: ${row.description || 'sem descrição'}`}
      onFocusCapture={onFocus}
      className={`flex flex-col gap-3 rounded-md border p-3 transition-colors duration-150 ${active ? 'border-accent' : 'border-line'} ${row.include ? '' : 'opacity-60'}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className={`font-mono ${row.ocr ? 'font-semibold' : ''}`}>
          {row.ocr ? (
            <><span aria-hidden="true" className="text-alert">[ ✖ ]</span> OCR: confira</>
          ) : (
            <><span aria-hidden="true" className="text-accent">[ ▪ ]</span> {originText[row.origin]}</>
          )}
        </span>
        {row.ocr && <span className="text-ink/75">{originText[row.origin]}</span>}
        {row.payee && <span className="text-ink/75">favorecido: <strong>{row.payee.name}</strong></span>}
        <label className="ml-auto flex min-h-11 items-center gap-2 md:min-h-8">
          <input type="checkbox" checked={row.include} onChange={(e) => onChange({ include: e.target.checked })} />
          criar
        </label>
        <button type="button" onClick={onRemove} className={`${link} min-h-11 text-xs md:min-h-8`}>
          remover
        </button>
      </div>

      {row.duplicateOf && (
        <p role="alert" className="rounded-md border border-alert/60 bg-alert/10 px-3 py-2 text-xs">
          <span aria-hidden="true" className="font-mono text-alert">[ ✖ ]</span>{' '}
          {row.duplicateOf === 'batch' ? 'Este boleto já está em outra linha desta importação.' : 'Já existe uma conta com este boleto.'}{' '}
          {row.include ? 'Será criada mesmo assim.' : 'Fica de fora; marque "criar" para incluir mesmo assim.'}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-[minmax(0,2fr)_9rem_9.5rem_8rem] md:items-start md:gap-2">
        <div className="col-span-2 flex flex-col gap-1 md:col-span-1">
          <label htmlFor={id('desc')} className={label}>Descrição</label>
          <input id={id('desc')} value={row.description} maxLength={120} onChange={(e) => onChange({ description: e.target.value })} className={`${input} ${errors.description ? 'border-alert' : ''}`} />
          {err('description')}
        </div>
        <div className="col-span-2 md:col-span-1 md:[&_input]:h-9">
          <MoneyInput id={id('valor')} label="Valor" value={row.amountCents} onChange={(amountCents) => onChange({ amountCents })} error={errors.amountCents} />
        </div>
        <div className="flex flex-col gap-1">
          {/* Calendário do app (e não o type="date" do navegador): no celular o campo nativo deixa digitar ano de 5 dígitos
              ou ficar incompleto, e o servidor recusava o lote inteiro sem dizer qual conta. */}
          <DatePicker
            id={id('venc')} label="Vencimento" value={row.dueDate} error={errors.dueDate}
            // A competência acompanha o vencimento enquanto a pessoa não a tiver escolhido à parte.
            onChange={(d) => onChange({ dueDate: d, ...(d && row.competence === row.dueDate.slice(0, 7) ? { competence: d.slice(0, 7) } : {}) })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <MonthPicker id={id('comp')} label="Competência" value={row.competence} onChange={(m) => onChange({ competence: m })} error={errors.competenceMonth} />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 md:gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={id('cat')} className={label}>Categoria (sugerida)</label>
          <select id={id('cat')} value={known ? row.categoryId : ''} onChange={(e) => onChange({ categoryId: e.target.value })} className={input}>
            {!known && <option value="">escolha</option>}
            {tree.map(({ category, children }) => [
              <option key={category.id} value={category.id}>{category.name}</option>,
              ...children.map((c) => <option key={c.id} value={c.id}>{`${category.name} › ${c.name}`}</option>),
            ])}
          </select>
          {err('categoryId')}
        </div>
        {row.beneficiaryCnpj && !row.payee && (
          <div className="flex flex-col gap-1">
            <label htmlFor={id('apelido')} className={label}>Apelido do favorecido (opcional)</label>
            <input
              id={id('apelido')}
              value={row.newPayeeName}
              maxLength={60}
              placeholder={row.beneficiaryName ? `ex.: como vocês chamam ${row.beneficiaryName}` : undefined}
              onChange={(e) => onChange({ newPayeeName: e.target.value })}
              className={input}
            />
            <p className="text-xs text-ink/70">Se preencher, o prumia reconhece as próximas contas deste CNPJ.</p>
          </div>
        )}
      </div>

      {row.boleto && (
        <p className="break-words font-mono text-xs tabular-nums text-ink/75">{formatDigitableLine(row.boleto.digitableLine)}</p>
      )}
      {otherErrors.map(([k, msg]) => (
        <p key={k} className="text-xs text-alert">{msg}</p>
      ))}
    </li>
  )
}
