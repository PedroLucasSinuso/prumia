import { useRef, useState, type FormEvent } from 'react'

import { ApiError } from '../api/errors'
import type { Boleto, DocumentExtraction, DocumentItem, Category, CategoryInput, Invoice, Payee, InvoiceInput, InvoicePatch, PurchaseInput, RecurrenceInput, SeriesScope } from '../api/types'
import { networkErrorMessage, problemFields, problemMessage } from '../auth/errors'
import { buildTree } from '../lib/categories'
import { addDays, dayMonth, monthOf, todayISO } from '../lib/dates'
import { flashRow } from '../lib/flash'
import { readPref, writePref } from '../lib/storage'
import { formatCents } from '../lib/money'
import { BoletoImport } from './BoletoImport'
import { Button } from './Button'
import { Field } from './Field'
import { FormError } from './FormError'
import { MoneyInput } from './MoneyInput'
import { Combobox, type ComboOption } from './ui/Combobox'
import { DatePicker } from './ui/DatePicker'
import { MonthPicker } from './ui/MonthPicker'
import { PanelFooter } from './ui/Panel'
import { Segmented } from './ui/Segmented'
import { chipCls } from './ui/styles'
import { Tooltip } from './ui/Tooltip'

type Props = {
  /** Mês exibido na tela (define o vencimento padrão ao criar). */
  month: string
  /** Casa ativa: separa as categorias "recentes" de cada casa no aparelho. */
  houseId?: string
  categories: Category[]
  /** Todos os favorecidos da casa (arquivados só aparecem se a conta já usa um). Opcional: sem a lista, o campo some. */
  payees?: Payee[]
  invoice?: Invoice // presente = editar
  canWrite: boolean
  /** Terminou (salvou): ao criar, fecha o painel; ao editar, volta ao detalhe da conta. */
  onDone: () => void
  /** Desiste da edição (volta ao detalhe). Sem ela, não há botão Cancelar. */
  onCancel?: () => void
  onCreate: (body: InvoiceInput) => Promise<unknown>
  onCreatePurchase: (body: PurchaseInput) => Promise<unknown>
  onCreateRecurrence: (body: RecurrenceInput) => Promise<unknown>
  onUpdate: (id: string, body: InvoicePatch, scope: SeriesScope) => Promise<unknown>
  /** Cria uma categoria na hora (botão "+ nova"). Sem ela, o botão não aparece. */
  onCreateCategory?: (body: CategoryInput) => Promise<Category>
  /** Lê um boleto (só na criação). Sem ela, o botão "Importar boleto" não aparece. */
  onExtractBoleto?: (file: File, password?: string) => Promise<DocumentExtraction>
  /** Abre outra conta (aviso de boleto duplicado). */
  onOpenInvoice?: (id: string) => void
  /** Tipo já escolhido ao criar (ex.: a tela de Parcelas abre direto em "parcelada" ou "fixa"). Padrão: avulsa. */
  initialKind?: 'single' | 'installments' | 'recurring'
}

// Nomes dos campos da API -> nome que o formulário usa para mostrar o erro.
const fieldMap: Record<string, string> = {
  description: 'description', amountCents: 'amount', dueDate: 'dueDate', categoryId: 'categoryId',
  competenceMonth: 'competence', notes: 'notes', payeeId: 'payeeId', newPayee: 'newPayee', name: 'newPayee', installmentsCount: 'count', totalAmountCents: 'amount',
  installmentAmountCents: 'amount', dayOfMonth: 'dueDate', startMonth: 'dueDate', endMonth: 'endMonth', firstDueDate: 'dueDate',
  'boleto.digitableLine': 'boleto',
}

type Kind = 'single' | 'installments' | 'recurring'
const kinds: Array<[Kind, string]> = [['single', 'avulsa'], ['installments', 'parcelada'], ['recurring', 'fixa todo mês']]

/** O servidor acrescenta " (n/N)" ao descrever parcelas; ao editar "esta e as seguintes" mandamos só o nome-base. */
const stripInstallmentSuffix = (d: string) => d.replace(/\s*\(\d+\/\d+\)\s*$/, '')

const RECENT_MAX = 4
const recentKey = (houseId?: string) => `prumia.categoriasRecentes.${houseId ?? 'casa'}`

type NewCategory = { name: string; asChild: boolean; busy: boolean; error?: string }

/**
 * Formulário de criar/editar conta. Valor em destaque (recebe o foco ao abrir). Vencimento: controle segmentado (hoje, amanhã,
 * em 7 dias) + calendário em "outra data". Categoria: até 4 atalhos "recentes" (por casa, no aparelho) e uma lista pesquisável com
 * "Mãe › filha". "Mais opções" guarda favorecido, competência e observação. O rodapé com a ação principal fica sempre à vista.
 * Pagar, desfazer e excluir ficam no detalhe da conta (`InvoiceDetail`), não aqui. Enter salva (envio nativo do formulário).
 */
export function InvoiceForm({ month, houseId, categories: baseCategories, payees = [], invoice, canWrite, onDone, onCancel, onCreate, onCreatePurchase, onCreateRecurrence, onUpdate, onCreateCategory, onExtractBoleto, onOpenInvoice, initialKind }: Props) {
  const editing = invoice !== undefined
  const today = todayISO()
  const inCurrentMonth = month === monthOf(today)
  const defaultDue = inCurrentMonth ? today : month

  // Categoria criada aqui ("+ nova") entra na hora; a lista do servidor chega logo depois e já a traz.
  const [created, setCreated] = useState<Category[]>([])
  const categories = [...baseCategories, ...created.filter((c) => !baseCategories.some((b) => b.id === c.id))]

  const [description, setDescription] = useState(invoice?.description ?? '')
  const [amount, setAmount] = useState(invoice?.amountCents ?? 0)
  const [dueDate, setDueDate] = useState(invoice?.dueDate ?? defaultDue)
  const [otherDate, setOtherDate] = useState(editing || !inCurrentMonth)
  const [recent, setRecent] = useState<string[]>(() => readPref<string[]>(recentKey(houseId), []))
  const [categoryId, setCategoryId] = useState(invoice?.categoryId ?? buildTree(baseCategories)[0]?.category.id ?? '')
  const [payeeId, setPayeeId] = useState(invoice?.payeeId ?? '')
  const [competence, setCompetence] = useState(invoice ? invoice.competenceMonth.slice(0, 7) : '')
  const [notes, setNotes] = useState(invoice?.notes ?? '')
  const [kind, setKind] = useState<Kind>(initialKind ?? 'single')
  const [count, setCount] = useState('6')
  const [amountIsTotal, setAmountIsTotal] = useState(false)
  const [endMonth, setEndMonth] = useState('')
  const [scope, setScope] = useState<SeriesScope>('this')
  const [error, setError] = useState<string>()
  const [fields, setFields] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  // Boleto lido e revisado: vai junto ao criar. `importKey` reinicia a importação ("Adicionar e lançar outra").
  const [boleto, setBoleto] = useState<Boleto>()
  // Arquivados não se oferecem para contas novas, mas o da própria conta continua visível ao editar.
  const payeeOptions = payees.filter((p) => !p.archived || p.id === invoice?.payeeId)
  const [importKey, setImportKey] = useState(0)
  // Competência lida do boleto: abre a seção "mais opções" para a pessoa ver e conferir o que foi preenchido.
  const [competenceImported, setCompetenceImported] = useState(false)
  // Favorecido reconhecido pelo CNPJ do boleto (já escolhido) e apelido de um favorecido NOVO a criar junto com a conta.
  const [matchedPayee, setMatchedPayee] = useState<Payee>()
  const [newPayeeName, setNewPayeeName] = useState('')
  // "+ nova" categoria: nome digitado e se entra dentro da categoria principal aberta.
  const [newCat, setNewCat] = useState<NewCategory | null>(null)
  const descRef = useRef<HTMLInputElement>(null)
  const amountRef = useRef<HTMLInputElement>(null)

  // Guarda a categoria usada como "recente" (por casa, no aparelho; falha de armazenamento é ignorada).
  function remember(id: string) {
    const next = [id, ...recent.filter((x) => x !== id)].slice(0, RECENT_MAX)
    setRecent(next)
    writePref(recentKey(houseId), next)
  }

  const clear = (f: string) => {
    setFields(({ [f]: _removed, ...rest }) => rest)
    setError(undefined)
  }

  // Pré-preenche com o que o boleto diz; a descrição só se ainda estiver vazia. A pessoa sempre revisa antes de salvar.
  // Ao salvar vão só a linha e o beneficiário: o servidor recalcula valor e vencimento do documento a partir da linha.
  // Conta sem boleto ("bill") preenche só valor, vencimento, competência e descrição.
  function applyBoleto(it: DocumentItem) {
    const payee = it.payee
    const b = { beneficiaryName: it.beneficiaryName, beneficiaryCnpj: it.beneficiaryCnpj }
    setBoleto(it.boleto ? { digitableLine: it.boleto.digitableLine, ...b } : undefined)
    setNewPayeeName('')
    setMatchedPayee(payee ?? undefined)
    // Sem favorecido reconhecido e com algum já cadastrado: abre "Mais opções" para a pessoa poder escolher um existente.
    if (it.boleto && b.beneficiaryCnpj && !payee && payees.length > 0) setCompetenceImported(true)
    if (payee) {
      setPayeeId(payee.id)
      if (payee.defaultCategoryId && categories.some((c) => c.id === payee.defaultCategoryId)) setCategoryId(payee.defaultCategoryId)
    }
    if (it.amountCents) { setAmount(it.amountCents); clear('amount') }
    if (it.dueDate) { setDueDate(it.dueDate); setOtherDate(true); clear('dueDate') }
    if (it.competenceMonth) { setCompetence(it.competenceMonth.slice(0, 7)); setCompetenceImported(true); clear('competence') }
    const suggested = payee?.name ?? it.description ?? b.beneficiaryName
    if (!description.trim() && suggested) { setDescription(suggested); clear('description') }
  }

  // Escolher o favorecido ajuda a preencher: nome (se ainda vazio) e categoria sugerida (só ao criar).
  function pickPayee(id: string) {
    setPayeeId(id)
    clear('payeeId')
    const p = payees.find((x) => x.id === id)
    if (!p || editing) return
    if (!description.trim()) { setDescription(p.name); clear('description') }
    if (p.defaultCategoryId && categories.some((c) => c.id === p.defaultCategoryId)) setCategoryId(p.defaultCategoryId)
  }

  // Boleto só vale para conta avulsa: trocar o tipo descarta a leitura (os campos já preenchidos ficam).
  function clearBoleto() {
    setBoleto(undefined)
    setNewPayeeName('')
    if (matchedPayee) { setPayeeId(''); setMatchedPayee(undefined) }
  }
  function discardBoleto() {
    clearBoleto()
    setImportKey((k) => k + 1)
  }

  async function submit(addAnother: boolean) {
    setBusy(true)
    setError(undefined)
    setFields({})
    try {
      const competenceMonth = competence ? `${competence}-01` : undefined
      if (editing) {
        // "Esta e as seguintes" não aceita data (cada parcela tem a sua) e usa a descrição-base.
        const following = scope === 'following' && invoice.series != null
        await onUpdate(
          invoice.id,
          {
            description: following && invoice.series?.kind === 'installment' ? stripInstallmentSuffix(description) : description,
            amountCents: amount, categoryId, payeeId: payeeId || null,
            ...(following ? {} : { dueDate, ...(competenceMonth ? { competenceMonth } : {}) }),
            notes: notes.trim() === '' ? null : notes,
          } as InvoicePatch,
          following ? 'following' : 'this',
        )
        flashRow(invoice.id)
        remember(categoryId)
        onDone()
      } else if (kind === 'installments') {
        const n = Number(count)
        await onCreatePurchase({
          categoryId, description, purchaseDate: today, firstDueDate: dueDate, installmentsCount: n,
          // Sem juros: informar o total deixa o servidor dividir (resto de centavos na última). Com parcela fixa, todas valem igual.
          ...(amountIsTotal ? { totalAmountCents: amount } : { totalAmountCents: amount * n, installmentAmountCents: amount }),
          ...(notes.trim() ? { notes } : {}),
        })
        remember(categoryId)
        onDone()
      } else if (kind === 'recurring') {
        await onCreateRecurrence({
          categoryId, description, amountCents: amount, dayOfMonth: Number(dueDate.slice(8, 10)), startMonth: `${dueDate.slice(0, 7)}-01`,
          ...(endMonth ? { endMonth: `${endMonth}-01` } : {}),
          ...(notes.trim() ? { notes } : {}),
        })
        remember(categoryId)
        onDone()
      } else {
        const created = await onCreate({
          description, amountCents: amount, dueDate, categoryId,
          ...(payeeId ? { payeeId } : {}),
          ...(!payeeId && newPayeeName.trim() ? { newPayee: { name: newPayeeName.trim() } } : {}),
          ...(competenceMonth ? { competenceMonth } : {}),
          ...(notes.trim() ? { notes } : {}),
          ...(boleto ? { boleto } : {}),
        })
        const newId = (created as { id?: string } | undefined)?.id
        if (newId) flashRow(newId)
        remember(categoryId)
        if (addAnother) {
          // mantém categoria e vencimento (lançar várias contas parecidas) e volta ao começo: o valor
          setDescription('')
          setAmount(0)
          setNotes('')
          discardBoleto()
          amountRef.current?.focus()
        } else {
          onDone()
        }
      }
    } catch (err) {
      const api = err instanceof ApiError ? err : undefined
      setError(api?.network ? networkErrorMessage : problemMessage(api?.problem))
      const raw = problemFields(api?.problem)
      setFields(Object.fromEntries(Object.entries(raw).map(([k, v]) => [fieldMap[k] ?? k, v])))
    } finally {
      setBusy(false)
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void submit(false)
  }

  const inSeries = invoice?.series != null
  const selectedCat = categories.find((c) => c.id === categoryId)
  // Categoria da conta = a mais específica. A linha de cima mostra as mães (e as categorias sem filhas); a de baixo, as filhas da escolhida.
  const tree = buildTree(categories)
  const topId = selectedCat?.parentId && categories.some((c) => c.id === selectedCat.parentId) ? selectedCat.parentId : categoryId
  const topNode = tree.find((n) => n.category.id === topId)

  // "+ nova": cria a categoria pela API e já a escolhe. Marcada "dentro de X", vira subcategoria da principal aberta.
  async function createCategory() {
    if (!newCat || !onCreateCategory || !newCat.name.trim()) return
    const parent = newCat.asChild && topNode ? topNode.category : undefined
    setNewCat({ ...newCat, busy: true, error: undefined })
    try {
      const cat = await onCreateCategory({
        name: newCat.name.trim(),
        isEssential: parent?.isEssential ?? false,
        ...(parent ? { parentId: parent.id } : {}),
        // a filha herda a carteira sugerida da mãe (Mercado › Feira continua sugerindo o benefício)
        ...(parent?.defaultWallet ? { defaultWallet: parent.defaultWallet } : {}),
      })
      setCreated((list) => [...list, cat])
      setCategoryId(cat.id)
      clear('categoryId')
      setNewCat(null)
    } catch (err) {
      const api = err instanceof ApiError ? err : undefined
      const msg = api?.problem?.code === 'category_exists' ? 'Já existe uma categoria com esse nome.' : api?.network ? networkErrorMessage : problemMessage(api?.problem)
      setNewCat((c) => (c ? { ...c, busy: false, error: msg } : c))
    }
  }

  // Opções do combobox: mãe, depois as filhas ("Moradia › Gás"). A mãe com filhas continua escolhível (conta "geral" dela).
  const vr = { badge: 'VR', badgeTitle: 'Sugere a carteira de benefício' } as const
  const categoryOptions: ComboOption[] = tree.flatMap(({ category: c, children }) => [
    { value: c.id, label: c.name, ...(c.defaultWallet === 'benefit' ? vr : {}) },
    ...children.map((k): ComboOption => ({ value: k.id, label: k.name, group: c.name, ...(k.defaultWallet === 'benefit' ? vr : {}) })),
  ])
  // Atalhos: as últimas categorias usadas e, para completar até 4, as principais da lista.
  const byId = new Map(categories.map((c) => [c.id, c]))
  const shortcutIds = [...recent.filter((id) => byId.has(id)), ...tree.map((n) => n.category.id)].filter((id, i, all) => all.indexOf(id) === i).slice(0, RECENT_MAX)
  const dueOptions = [
    { id: 'today', date: today, name: 'Hoje' },
    { id: 'tomorrow', date: addDays(today, 1), name: 'Amanhã' },
    { id: 'week', date: addDays(today, 7), name: 'Em 7 dias' },
  ]
  const dueValue = otherDate ? 'other' : (dueOptions.find((o) => o.date === dueDate)?.id ?? null)
  const dueLabel = !editing && kind === 'installments' ? '1ª parcela vence' : !editing && kind === 'recurring' ? 'Vence no dia' : 'Vence'
  const invalid = busy || !description || amount <= 0 || !dueDate || !categoryId
  const primaryText = editing ? 'Salvar alterações' : kind === 'installments' ? 'Adicionar compra parcelada' : kind === 'recurring' ? 'Adicionar conta fixa' : 'Adicionar conta'

  return (
    <form onSubmit={onSubmit} className="flex min-h-full flex-col gap-4" noValidate>
      <FormError message={error} />

      {!editing && canWrite && (
        <Segmented
          label="Tipo de conta"
          hideLabel
          value={kind}
          onChange={(k) => { setKind(k); setError(undefined); if (k !== 'single') discardBoleto() }}
          options={kinds.map(([value, label]) => ({ value, label }))}
        />
      )}

      {!editing && canWrite && kind === 'single' && onExtractBoleto && (
        <BoletoImport
          key={importKey}
          onExtract={onExtractBoleto}
          onExtracted={applyBoleto}
          onDiscard={() => { clearBoleto(); clear('boleto') }}
          onManual={() => descRef.current?.focus()}
          onOpenInvoice={onOpenInvoice}
        />
      )}
      {fields.boleto && (
        <p className="text-xs text-alert">A linha digitável deste boleto é inválida. Importe de novo ou preencha manualmente.</p>
      )}
      {boleto && matchedPayee && (
        <p className="rounded-md border border-line px-3 py-2 text-sm" aria-live="polite">
          Favorecido: <strong>{matchedPayee.name}</strong> <span className="text-xs text-ink/70">(reconhecido pelo CNPJ do boleto)</span>
        </p>
      )}
      {boleto?.beneficiaryCnpj && !payeeId && (
        <Field
          label={`Como vocês chamam ${boleto.beneficiaryName ?? 'quem recebe'}? (opcional)`}
          name="newPayee"
          autoComplete="off"
          maxLength={60}
          value={newPayeeName}
          placeholder="Gás, Internet, Luz…"
          hint="Se preencher, o prumia guarda este favorecido e reconhece o boleto dele nas próximas vezes."
          error={fields.newPayee}
          onChange={(e) => {
            setNewPayeeName(e.target.value)
            clear('newPayee')
            // o nome do boleto foi só uma sugestão: o apelido o substitui enquanto a descrição não foi editada à mão
            if (!description.trim() || description === boleto.beneficiaryName || description === newPayeeName) setDescription(e.target.value)
          }}
        />
      )}
      {boleto?.beneficiaryCnpj && payeeId && !matchedPayee && (
        <p className="text-xs text-ink/70">O CNPJ deste boleto será associado ao favorecido escolhido, se ele ainda não tiver um.</p>
      )}

      <MoneyInput
        ref={amountRef}
        autoFocus={!editing}
        hero
        label={kind === 'installments' ? (amountIsTotal ? 'Valor total da compra' : 'Valor de cada parcela') : 'Valor'}
        value={amount}
        onChange={(c) => { setAmount(c); clear('amount') }}
        error={fields.amount}
      />

      {!editing && kind === 'installments' && (
        <div className="flex flex-col gap-3">
          <Field label="Parcelas" name="count" type="number" inputMode="numeric" min={2} max={120} value={count} onChange={(e) => { setCount(e.target.value); clear('count') }} error={fields.count} />
          <Segmented
            label="O valor informado é"
            hideLabel
            value={amountIsTotal ? 'total' : 'each'}
            onChange={(v) => setAmountIsTotal(v === 'total')}
            options={[{ value: 'each', label: 'de cada parcela' }, { value: 'total', label: 'total da compra' }]}
          />
          {amount > 0 && Number(count) >= 2 && (
            <p className="rounded-md border border-line px-3 py-2 text-sm" aria-live="polite">
              {amountIsTotal
                ? `${count}x de ${formatCents(Math.floor(amount / Number(count)))} (total ${formatCents(amount)}; sobra de centavos na última)`
                : `${count}x de ${formatCents(amount)} = ${formatCents(amount * Number(count))}`}
              . O app cria todas as parcelas, uma por mês.
            </p>
          )}
        </div>
      )}
      {!editing && kind === 'recurring' && (
        <p className="rounded-md border border-line px-3 py-2 text-sm">
          {amount > 0 ? `${formatCents(amount)} ` : ''}todo dia {dueDate.slice(8, 10)}, a partir deste mês. O app cria os próximos 12 meses e continua criando sozinho.
        </p>
      )}

      <Field
        ref={descRef}
        label="Descrição"
        name="description"
        autoComplete="off"
        required
        value={description}
        disabled={!canWrite}
        onChange={(e) => { setDescription(e.target.value); clear('description') }}
        error={fields.description}
      />

      <fieldset className="flex flex-col gap-2" disabled={!canWrite}>
        <Segmented
          label={dueLabel}
          value={dueValue}
          onChange={(id) => {
            if (id === 'other') return setOtherDate(true)
            const o = dueOptions.find((x) => x.id === id)
            if (!o) return
            setDueDate(o.date)
            setOtherDate(false)
            clear('dueDate')
          }}
          options={[
            ...dueOptions.map((o) => ({
              value: o.id,
              ariaLabel: `${o.name}, ${dayMonth(o.date)}`,
              label: (
                <span className="flex flex-col items-center leading-tight">
                  {o.name}
                  <span className="font-mono text-[11px] font-normal tabular-nums opacity-80">{dayMonth(o.date)}</span>
                </span>
              ),
            })),
            { value: 'other', label: 'Outra data' },
          ]}
        />
        {otherDate ? (
          <DatePicker label="Data de vencimento" name="dueDate" required value={dueDate} onChange={(d) => { setDueDate(d); clear('dueDate') }} error={fields.dueDate} />
        ) : (
          fields.dueDate && <p className="text-xs text-alert">{fields.dueDate}</p>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-2" disabled={!canWrite}>
        <legend className="sr-only">Categoria</legend>
        {shortcutIds.length > 0 && (
          <div role="group" aria-label="Categorias recentes" className="flex flex-wrap gap-2">
            {shortcutIds.map((id) => {
              const c = byId.get(id)!
              const on = categoryId === id
              return (
                <button key={id} type="button" aria-pressed={on} onClick={() => { setCategoryId(id); clear('categoryId') }} className={chipCls(on)}>
                  {c.name}
                  {c.defaultWallet === 'benefit' && (
                    <span className={`rounded-xs border px-1 font-mono text-[10px] ${on ? 'border-on-structure/70' : 'border-ink/50'}`} title="Sugere a carteira de benefício">
                      VR
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
        <Combobox
          label="Categoria"
          options={categoryOptions}
          value={categoryId}
          onChange={(v) => { setCategoryId(v); clear('categoryId') }}
          placeholder="Buscar categoria…"
          onCreate={canWrite && onCreateCategory ? (typed) => setNewCat({ name: typed, asChild: false, busy: false }) : undefined}
          createLabel="Nova categoria"
          error={fields.categoryId}
        />
        {newCat && (
          <div role="group" aria-label="Nova categoria" className="flex flex-col gap-2 rounded-md border border-line p-3">
            <div className="flex flex-wrap gap-2">
              <input
                aria-label="Nome da nova categoria"
                autoFocus
                maxLength={60}
                value={newCat.name}
                placeholder="Ex.: Pets"
                onChange={(e) => setNewCat({ ...newCat, name: e.target.value, error: undefined })}
                onKeyDown={(e) => {
                  // Enter aqui cria a categoria (e não envia a conta); Esc desiste sem fechar o painel.
                  if (e.key === 'Enter') { e.preventDefault(); void createCategory() }
                  if (e.key === 'Escape') { e.preventDefault(); e.nativeEvent.stopImmediatePropagation(); setNewCat(null) }
                }}
                className="h-11 min-w-0 flex-1 basis-40 rounded-md border border-ink/25 bg-raised/40 px-3 text-base text-ink transition-colors hover:border-ink/45 focus-visible:border-accent md:h-9 md:text-sm"
              />
              <Button type="button" disabled={!newCat.name.trim()} loading={newCat.busy} loadingLabel="Criando…" onClick={() => void createCategory()}>
                Criar categoria
              </Button>
              <Button type="button" variant="ghost" onClick={() => setNewCat(null)}>
                Cancelar
              </Button>
            </div>
            {topNode && (
              <label className="flex min-h-9 items-center gap-2 text-sm">
                <input type="checkbox" checked={newCat.asChild} onChange={(e) => setNewCat({ ...newCat, asChild: e.target.checked })} className="size-4 accent-[var(--color-structure)]" />
                dentro de {topNode.category.name} (subcategoria)
              </label>
            )}
            {newCat.error && <p role="alert" className="text-xs text-alert">{newCat.error}</p>}
          </div>
        )}
      </fieldset>

      <details className="rounded-md border border-line px-3 py-2" open={Boolean(fields.competence || fields.notes || fields.payeeId || competenceImported)}>
        <summary className="flex min-h-9 cursor-pointer items-center justify-between text-sm font-semibold transition-colors hover:text-heading">
          Mais opções <span className="text-xs font-normal text-ink/75">favorecido · competência · observação</span>
        </summary>
        <div className="mt-3 flex flex-col gap-4 pb-1">
          {!editing && kind === 'recurring' && (
            <MonthPicker label="Termina em (opcional)" value={endMonth} clearable onChange={(m) => { setEndMonth(m); clear('endMonth') }} hint="Em branco: continua até você encerrar." error={fields.endMonth} />
          )}
          {(editing || kind === 'single') && payeeOptions.length > 0 && (
            <Combobox
              label="Favorecido (opcional)"
              options={payeeOptions.map((p) => ({ value: p.id, label: p.name }))}
              value={payeeId}
              emptyLabel="nenhum"
              placeholder="nenhum"
              disabled={!canWrite}
              onChange={pickPayee}
              error={fields.payeeId}
            />
          )}
          {(editing || kind === 'single') && (
            <MonthPicker
              label="Mês de competência"
              value={competence}
              clearable
              disabled={!canWrite}
              hint="Em branco: usa o mês do vencimento."
              onChange={(m) => { setCompetence(m); clear('competence') }}
              error={fields.competence}
            />
          )}
          <Field label="Observação" name="notes" autoComplete="off" value={notes} disabled={!canWrite} onChange={(e) => { setNotes(e.target.value); clear('notes') }} error={fields.notes} />
        </div>
      </details>

      {inSeries && canWrite && (
        <fieldset className="flex flex-col gap-1.5">
          <Segmented
            label={invoice.series?.kind === 'recurrence' ? 'Esta conta é fixa. Alterar' : 'Esta conta é uma parcela. Alterar'}
            value={scope}
            onChange={setScope}
            options={[{ value: 'this', label: 'só esta' }, { value: 'following', label: 'esta e as seguintes' }]}
          />
          {scope === 'following' && (
            <p className="text-xs text-ink/75">Vale para as ainda não pagas daqui para frente. Contas pagas e anteriores não mudam, e o vencimento de cada uma é mantido.</p>
          )}
        </fieldset>
      )}

      {canWrite && (
        <PanelFooter>
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Tooltip label="Salvar" shortcut="Enter" className="flex flex-1">
              <Button type="submit" loading={busy} className="w-full" disabled={invalid || (kind === 'installments' && !editing && !(Number(count) >= 2))}>
                {primaryText}
              </Button>
            </Tooltip>
            {!editing && kind === 'single' && (
              <Button type="button" variant="ghost" disabled={invalid} onClick={() => void submit(true)}>
                Adicionar e lançar outra
              </Button>
            )}
            {editing && onCancel && (
              <Button type="button" variant="ghost" onClick={onCancel}>
                Cancelar
              </Button>
            )}
          </div>
        </PanelFooter>
      )}
    </form>
  )
}
