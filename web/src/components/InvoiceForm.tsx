import { Plus } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'

import { ApiError } from '../api/errors'
import type { Boleto, DocumentExtraction, DocumentItem, Category, CategoryInput, Invoice, Payee, InvoiceInput, InvoicePatch, PurchaseInput, RecurrenceInput, SeriesScope } from '../api/types'
import { networkErrorMessage, problemFields, problemMessage } from '../auth/errors'
import { addDays, dayMonth, monthOf, todayISO } from '../lib/dates'
import { buildTree } from '../lib/categories'
import { formatCents } from '../lib/money'
import { BoletoImport } from './BoletoImport'
import { Button } from './Button'
import { Field } from './Field'
import { FormError } from './FormError'
import { MoneyInput } from './MoneyInput'

type Props = {
  /** Mês exibido na tela (define o vencimento padrão ao criar). */
  month: string
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

// Botão de escolha. `whitespace-nowrap`: o rótulo nunca quebra ("hoje ·" / "20/10"); quem quebra é a fileira.
// Celular: 44 px de alvo; computador (md+): 36 px, mais denso para o mouse.
const chip = (on: boolean) =>
  `flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border px-3 text-[13px] transition-colors md:min-h-9 ${
    on ? 'border-structure bg-structure font-semibold text-on-structure' : 'border-ink/30 font-medium text-ink hover:bg-ink/5'
  }`

type NewCategory = { name: string; asChild: boolean; busy: boolean; error?: string }

/**
 * Formulário de criar/editar conta. Valor em destaque (recebe o foco ao abrir); vencimento e categoria são BOTÕES visíveis
 * (nada de menu suspenso): menos toques e menos decisões escondidas. "Mais opções" guarda favorecido, competência e observação.
 * Pagar, desfazer e excluir ficam no detalhe da conta (`InvoiceDetail`), não aqui. Enter salva (envio nativo do formulário).
 */
export function InvoiceForm({ month, categories: baseCategories, payees = [], invoice, canWrite, onDone, onCancel, onCreate, onCreatePurchase, onCreateRecurrence, onUpdate, onCreateCategory, onExtractBoleto, onOpenInvoice }: Props) {
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
  const [categoryId, setCategoryId] = useState(invoice?.categoryId ?? buildTree(baseCategories)[0]?.category.id ?? '')
  const [payeeId, setPayeeId] = useState(invoice?.payeeId ?? '')
  const [competence, setCompetence] = useState(invoice ? invoice.competenceMonth.slice(0, 7) : '')
  const [notes, setNotes] = useState(invoice?.notes ?? '')
  const [kind, setKind] = useState<Kind>('single')
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
        onDone()
      } else if (kind === 'installments') {
        const n = Number(count)
        await onCreatePurchase({
          categoryId, description, purchaseDate: today, firstDueDate: dueDate, installmentsCount: n,
          // Sem juros: informar o total deixa o servidor dividir (resto de centavos na última). Com parcela fixa, todas valem igual.
          ...(amountIsTotal ? { totalAmountCents: amount } : { totalAmountCents: amount * n, installmentAmountCents: amount }),
          ...(notes.trim() ? { notes } : {}),
        })
        onDone()
      } else if (kind === 'recurring') {
        await onCreateRecurrence({
          categoryId, description, amountCents: amount, dayOfMonth: Number(dueDate.slice(8, 10)), startMonth: `${dueDate.slice(0, 7)}-01`,
          ...(endMonth ? { endMonth: `${endMonth}-01` } : {}),
          ...(notes.trim() ? { notes } : {}),
        })
        onDone()
      } else {
        await onCreate({
          description, amountCents: amount, dueDate, categoryId,
          ...(payeeId ? { payeeId } : {}),
          ...(!payeeId && newPayeeName.trim() ? { newPayee: { name: newPayeeName.trim() } } : {}),
          ...(competenceMonth ? { competenceMonth } : {}),
          ...(notes.trim() ? { notes } : {}),
          ...(boleto ? { boleto } : {}),
        })
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

  const pick = (c: Category, text: string, on: boolean, key = c.id) => (
    <button key={key} type="button" aria-pressed={on} onClick={() => { setCategoryId(c.id); clear('categoryId') }} className={`${chip(on)} min-h-10`}>
      {text}
      {c.defaultWallet === 'benefit' && text !== 'geral' && (
        <span className={`rounded-xs border px-1 font-mono text-[10px] ${on ? 'border-on-structure/70' : 'border-ink/50'}`} title="Sugere a carteira de benefício">
          VR
        </span>
      )}
    </button>
  )
  const dueChips = [
    { label: `hoje · ${dayMonth(today)}`, value: today },
    { label: `amanhã · ${dayMonth(addDays(today, 1))}`, value: addDays(today, 1) },
    { label: `em 7 dias · ${dayMonth(addDays(today, 7))}`, value: addDays(today, 7) },
  ]

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <FormError message={error} />

      {!editing && canWrite && (
        <div role="group" aria-label="Tipo de conta" className="grid grid-cols-3 gap-2">
          {kinds.map(([k, text]) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => { setKind(k); setError(undefined); if (k !== 'single') discardBoleto() }} className={chip(kind === k)}>
              {text}
            </button>
          ))}
        </div>
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
          <div role="group" aria-label="O valor informado é" className="grid grid-cols-2 gap-2">
            <button type="button" aria-pressed={!amountIsTotal} onClick={() => setAmountIsTotal(false)} className={chip(!amountIsTotal)}>de cada parcela</button>
            <button type="button" aria-pressed={amountIsTotal} onClick={() => setAmountIsTotal(true)} className={chip(amountIsTotal)}>total da compra</button>
          </div>
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

      <fieldset className="flex flex-col gap-1.5" disabled={!canWrite}>
        <legend className={otherDate ? 'sr-only' : 'mb-1 text-xs font-medium uppercase tracking-wider text-ink/80'}>{!editing && kind === 'installments' ? '1ª parcela vence' : !editing && kind === 'recurring' ? 'Vence no dia' : 'Vence'}</legend>
        {!otherDate ? (
          <div className="flex flex-wrap gap-2">
            {dueChips.map((c) => (
              <button key={c.value} type="button" aria-pressed={dueDate === c.value} onClick={() => { setDueDate(c.value); clear('dueDate') }} className={`${chip(dueDate === c.value)} flex-auto`}>
                {c.label}
              </button>
            ))}
            <button type="button" onClick={() => setOtherDate(true)} className={`${chip(false)} flex-auto`}>
              outra data
            </button>
          </div>
        ) : (
          <Field
            label="Data de vencimento"
            type="date"
            name="dueDate"
            required
            value={dueDate}
            onChange={(e) => { setDueDate(e.target.value); clear('dueDate') }}
            error={fields.dueDate}
          />
        )}
        {!otherDate && fields.dueDate && <p className="text-xs text-alert">{fields.dueDate}</p>}
      </fieldset>

      <fieldset className="flex flex-col gap-1.5" disabled={!canWrite}>
        <legend className="mb-1 text-xs font-medium uppercase tracking-wider text-ink/80">Categoria</legend>
        <div className="flex flex-wrap gap-2">
          {tree.map(({ category: c }) => pick(c, c.name, topId === c.id))}
          {canWrite && onCreateCategory && !newCat && (
            <button
              type="button"
              onClick={() => setNewCat({ name: '', asChild: false, busy: false })}
              className="flex min-h-10 items-center gap-1 whitespace-nowrap rounded-md border border-dashed border-ink/40 px-3 text-[13px] font-medium text-ink transition-colors hover:bg-ink/5 md:min-h-9"
            >
              <Plus size={15} strokeWidth={1.5} aria-hidden="true" /> nova
            </button>
          )}
        </div>
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
                className="h-11 min-w-0 flex-1 basis-40 rounded-md border border-ink/25 bg-white/40 px-3 text-base text-ink md:h-9 md:text-sm"
              />
              <Button type="button" disabled={newCat.busy || !newCat.name.trim()} onClick={() => void createCategory()} className="md:h-9">
                {newCat.busy ? 'Criando…' : 'Criar categoria'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setNewCat(null)} className="md:h-9">
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
        {/* Só aparece para quem criou subcategorias: escolher uma mãe com filhas abre esta 2ª linha (geral · Gás · Luz…). */}
        {topNode && topNode.children.length > 0 && (
          <div role="group" aria-label={`Detalhe de ${topNode.category.name}`} className="flex flex-wrap gap-2 border-l-2 border-ink/20 pl-3">
            {pick(topNode.category, 'geral', categoryId === topNode.category.id, 'geral')}
            {topNode.children.map((c) => pick(c, c.name, categoryId === c.id))}
          </div>
        )}
        {fields.categoryId && <p className="text-xs text-alert">{fields.categoryId}</p>}
      </fieldset>

      <details className="rounded-md border border-line px-3 py-2" open={Boolean(fields.competence || fields.notes || fields.payeeId || competenceImported)}>
        <summary className="flex min-h-9 cursor-pointer items-center justify-between text-sm font-semibold">
          Mais opções <span className="text-xs font-normal text-ink/75">favorecido · competência · observação</span>
        </summary>
        <div className="mt-3 flex flex-col gap-4 pb-1">
          {!editing && kind === 'recurring' && (
            <Field label="Termina em (opcional)" type="month" name="endMonth" value={endMonth} onChange={(e) => { setEndMonth(e.target.value); clear('endMonth') }} hint="Em branco: continua até você encerrar." error={fields.endMonth} />
          )}
          {(editing || kind === 'single') && payeeOptions.length > 0 && (
            <div className="flex flex-col gap-1">
              <label htmlFor="invoice-payee" className="text-xs font-medium uppercase tracking-wider text-ink/70">Favorecido (opcional)</label>
              <select id="invoice-payee" value={payeeId} disabled={!canWrite} onChange={(e) => pickPayee(e.target.value)}
                className="h-11 rounded-md border border-ink/25 bg-white/40 px-3 text-base text-ink">
                <option value="">nenhum</option>
                {payeeOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {fields.payeeId && <p className="text-xs text-alert">{fields.payeeId}</p>}
            </div>
          )}
          {(editing || kind === 'single') && (
          <Field
            label="Mês de competência"
            type="month"
            name="competence"
            value={competence}
            disabled={!canWrite}
            hint="Em branco: usa o mês do vencimento."
            onChange={(e) => { setCompetence(e.target.value); clear('competence') }}
            error={fields.competence}
          />
          )}
          <Field label="Observação" name="notes" autoComplete="off" value={notes} disabled={!canWrite} onChange={(e) => { setNotes(e.target.value); clear('notes') }} error={fields.notes} />
        </div>
      </details>

      {inSeries && canWrite && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-xs font-medium uppercase tracking-wider text-ink/80">
            {invoice.series?.kind === 'recurrence' ? 'Esta conta é fixa. Alterar' : 'Esta conta é uma parcela. Alterar'}
          </legend>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" aria-pressed={scope === 'this'} onClick={() => setScope('this')} className={chip(scope === 'this')}>só esta</button>
            <button type="button" aria-pressed={scope === 'following'} onClick={() => setScope('following')} className={chip(scope === 'following')}>esta e as seguintes</button>
          </div>
          {scope === 'following' && (
            <p className="text-xs text-ink/75">Vale para as ainda não pagas daqui para frente. Contas pagas e anteriores não mudam, e o vencimento de cada uma é mantido.</p>
          )}
        </fieldset>
      )}

      {canWrite && (
        <div className="flex flex-col gap-1.5">
          <Button type="submit" title="Enter salva" disabled={busy || !description || amount <= 0 || !dueDate || !categoryId || (kind === 'installments' && !editing && !(Number(count) >= 2))}>
            {busy ? 'Salvando…' : editing ? 'Salvar alterações' : kind === 'installments' ? 'Adicionar compra parcelada' : kind === 'recurring' ? 'Adicionar conta fixa' : 'Adicionar conta'}
          </Button>
          {!editing && kind === 'single' && (
            <button
              type="button"
              disabled={busy || !description || amount <= 0 || !dueDate || !categoryId}
              onClick={() => void submit(true)}
              className="h-11 text-sm font-semibold text-accent underline underline-offset-4 disabled:text-ink/40"
            >
              Adicionar e lançar outra
            </button>
          )}
          {editing && onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancelar
            </Button>
          )}
        </div>
      )}
    </form>
  )
}
