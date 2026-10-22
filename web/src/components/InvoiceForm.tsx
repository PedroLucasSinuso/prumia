import { useRef, useState, type FormEvent } from 'react'

import { ApiError } from '../api/errors'
import type { Boleto, BoletoExtraction, Category, Invoice, InvoiceInput, InvoicePatch, PurchaseInput, RecurrenceInput, SeriesScope } from '../api/types'
import { networkErrorMessage, problemFields, problemMessage } from '../auth/errors'
import { addDays, dayMonth, fullDate, monthOf, todayISO } from '../lib/dates'
import { formatCents } from '../lib/money'
import { BoletoBox } from './BoletoBox'
import { BoletoImport } from './BoletoImport'
import { Button } from './Button'
import { Field } from './Field'
import { FormError } from './FormError'
import { MoneyInput } from './MoneyInput'

type Props = {
  /** Mês exibido na tela (define o vencimento padrão ao criar). */
  month: string
  categories: Category[]
  invoice?: Invoice // presente = editar
  canWrite: boolean
  /** Fecha o painel (celular) ou limpa a seleção (computador). */
  onDone: () => void
  onCreate: (body: InvoiceInput) => Promise<unknown>
  onCreatePurchase: (body: PurchaseInput) => Promise<unknown>
  onCreateRecurrence: (body: RecurrenceInput) => Promise<unknown>
  onUpdate: (id: string, body: InvoicePatch, scope: SeriesScope) => Promise<unknown>
  onDelete: (invoice: Invoice, scope: SeriesScope) => void
  onUnpay: (invoice: Invoice) => void
  onPay: (invoice: Invoice) => void
  /** Lê um boleto (só na criação). Sem ela, o botão "Importar boleto" não aparece. */
  onExtractBoleto?: (file: File, password?: string) => Promise<BoletoExtraction>
  /** Abre outra conta (aviso de boleto duplicado). */
  onOpenInvoice?: (id: string) => void
}

// Nomes dos campos da API -> nome que o formulário usa para mostrar o erro.
const fieldMap: Record<string, string> = {
  description: 'description', amountCents: 'amount', dueDate: 'dueDate', categoryId: 'categoryId',
  competenceMonth: 'competence', notes: 'notes', installmentsCount: 'count', totalAmountCents: 'amount',
  installmentAmountCents: 'amount', dayOfMonth: 'dueDate', startMonth: 'dueDate', endMonth: 'endMonth', firstDueDate: 'dueDate',
  'boleto.digitableLine': 'boleto',
}

const walletName = { free: 'carteira livre', benefit: 'carteira de benefício' } as const

type Kind = 'single' | 'installments' | 'recurring'
const kinds: Array<[Kind, string]> = [['single', 'avulsa'], ['installments', 'parcelada'], ['recurring', 'fixa todo mês']]

/** O servidor acrescenta " (n/N)" ao descrever parcelas; ao editar "esta e as seguintes" mandamos só o nome-base. */
const stripInstallmentSuffix = (d: string) => d.replace(/\s*\(\d+\/\d+\)\s*$/, '')

const chip = (on: boolean) =>
  `flex min-h-11 items-center justify-center gap-1.5 rounded-md border px-3 text-[13px] ${
    on ? 'border-teal bg-teal font-semibold text-ivory' : 'border-graphite/30 font-medium text-graphite hover:bg-graphite/5'
  }`

/**
 * Formulário de criar/editar conta. Valor em destaque; vencimento e categoria são BOTÕES visíveis (nada de menu suspenso):
 * menos toques e menos decisões escondidas. "Mais opções" guarda competência e observação.
 */
export function InvoiceForm({ month, categories, invoice, canWrite, onDone, onCreate, onCreatePurchase, onCreateRecurrence, onUpdate, onDelete, onUnpay, onPay, onExtractBoleto, onOpenInvoice }: Props) {
  const editing = invoice !== undefined
  const today = todayISO()
  const inCurrentMonth = month === monthOf(today)
  const defaultDue = inCurrentMonth ? today : month

  const [description, setDescription] = useState(invoice?.description ?? '')
  const [amount, setAmount] = useState(invoice?.amountCents ?? 0)
  const [dueDate, setDueDate] = useState(invoice?.dueDate ?? defaultDue)
  const [otherDate, setOtherDate] = useState(editing || !inCurrentMonth)
  const [categoryId, setCategoryId] = useState(invoice?.categoryId ?? categories[0]?.id ?? '')
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
  const [importKey, setImportKey] = useState(0)
  // Competência lida do boleto: abre a seção "mais opções" para a pessoa ver e conferir o que foi preenchido.
  const [competenceImported, setCompetenceImported] = useState(false)
  const descRef = useRef<HTMLInputElement>(null)

  const clear = (f: string) => {
    setFields(({ [f]: _removed, ...rest }) => rest)
    setError(undefined)
  }

  // Pré-preenche com o que o boleto diz; a descrição só se ainda estiver vazia. A pessoa sempre revisa antes de salvar.
  // Ao salvar vão só a linha e o beneficiário: o servidor recalcula valor e vencimento do documento a partir da linha.
  function applyBoleto({ boleto: b }: BoletoExtraction) {
    setBoleto({ digitableLine: b.digitableLine, beneficiaryName: b.beneficiaryName })
    if (b.documentAmountCents) { setAmount(b.documentAmountCents); clear('amount') }
    if (b.documentDueDate) { setDueDate(b.documentDueDate); setOtherDate(true); clear('dueDate') }
    if (b.documentCompetenceMonth) { setCompetence(b.documentCompetenceMonth.slice(0, 7)); setCompetenceImported(true); clear('competence') }
    if (!description.trim() && b.beneficiaryName) { setDescription(b.beneficiaryName); clear('description') }
  }

  // Boleto só vale para conta avulsa: trocar o tipo descarta a leitura (os campos já preenchidos ficam).
  function discardBoleto() {
    setBoleto(undefined)
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
            amountCents: amount, categoryId,
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
          ...(competenceMonth ? { competenceMonth } : {}),
          ...(notes.trim() ? { notes } : {}),
          ...(boleto ? { boleto } : {}),
        })
        if (addAnother) {
          // mantém categoria e vencimento (lançar várias contas parecidas) e volta ao começo
          setDescription('')
          setAmount(0)
          setNotes('')
          discardBoleto()
          descRef.current?.focus()
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

  const paid = invoice?.status === 'paid' && invoice.paid
  const inSeries = invoice?.series != null
  const selectedCat = categories.find((c) => c.id === categoryId)
  const payWallet = selectedCat?.defaultWallet ?? 'free'
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
          onDiscard={() => { setBoleto(undefined); clear('boleto') }}
          onManual={() => descRef.current?.focus()}
          onOpenInvoice={onOpenInvoice}
        />
      )}
      {fields.boleto && (
        <p className="text-xs text-signal">A linha digitável deste boleto é inválida. Importe de novo ou preencha manualmente.</p>
      )}

      <MoneyInput hero label={kind === 'installments' ? (amountIsTotal ? 'Valor total da compra' : 'Valor de cada parcela') : 'Valor'} value={amount} onChange={(c) => { setAmount(c); clear('amount') }} error={fields.amount} />

      {!editing && kind === 'installments' && (
        <div className="flex flex-col gap-3">
          <Field label="Parcelas" name="count" type="number" inputMode="numeric" min={2} max={120} value={count} onChange={(e) => { setCount(e.target.value); clear('count') }} error={fields.count} />
          <div role="group" aria-label="O valor informado é" className="grid grid-cols-2 gap-2">
            <button type="button" aria-pressed={!amountIsTotal} onClick={() => setAmountIsTotal(false)} className={chip(!amountIsTotal)}>de cada parcela</button>
            <button type="button" aria-pressed={amountIsTotal} onClick={() => setAmountIsTotal(true)} className={chip(amountIsTotal)}>total da compra</button>
          </div>
          {amount > 0 && Number(count) >= 2 && (
            <p className="rounded-md border border-graphite/15 px-3 py-2 text-sm" aria-live="polite">
              {amountIsTotal
                ? `${count}x de ${formatCents(Math.floor(amount / Number(count)))} (total ${formatCents(amount)}; sobra de centavos na última)`
                : `${count}x de ${formatCents(amount)} = ${formatCents(amount * Number(count))}`}
              . O app cria todas as parcelas, uma por mês.
            </p>
          )}
        </div>
      )}
      {!editing && kind === 'recurring' && (
        <p className="rounded-md border border-graphite/15 px-3 py-2 text-sm">
          {amount > 0 ? `${formatCents(amount)} ` : ''}todo dia {dueDate.slice(8, 10)}, a partir deste mês. O app cria os próximos 12 meses e continua criando sozinho.
        </p>
      )}

      <Field
        ref={descRef}
        label="O que é"
        name="description"
        autoFocus={!editing}
        autoComplete="off"
        required
        value={description}
        disabled={!canWrite}
        onChange={(e) => { setDescription(e.target.value); clear('description') }}
        error={fields.description}
      />

      <fieldset className="flex flex-col gap-1.5" disabled={!canWrite}>
        <legend className={otherDate ? 'sr-only' : 'mb-1 text-xs font-medium uppercase tracking-wider text-graphite/80'}>{!editing && kind === 'installments' ? '1ª parcela vence' : !editing && kind === 'recurring' ? 'Vence no dia' : 'Vence'}</legend>
        {!otherDate ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {dueChips.map((c) => (
              <button key={c.value} type="button" aria-pressed={dueDate === c.value} onClick={() => { setDueDate(c.value); clear('dueDate') }} className={chip(dueDate === c.value)}>
                {c.label}
              </button>
            ))}
            <button type="button" onClick={() => setOtherDate(true)} className={chip(false)}>
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
        {!otherDate && fields.dueDate && <p className="text-xs text-signal">{fields.dueDate}</p>}
      </fieldset>

      <fieldset className="flex flex-col gap-1.5" disabled={!canWrite}>
        <legend className="mb-1 text-xs font-medium uppercase tracking-wider text-graphite/80">Categoria</legend>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <button key={c.id} type="button" aria-pressed={categoryId === c.id} onClick={() => { setCategoryId(c.id); clear('categoryId') }} className={`${chip(categoryId === c.id)} min-h-10`}>
              {c.name}
              {c.defaultWallet === 'benefit' && (
                <span className={`rounded-xs border px-1 font-mono text-[10px] ${categoryId === c.id ? 'border-ivory/70' : 'border-graphite/50'}`} title="Sugere a carteira de benefício">
                  VR
                </span>
              )}
            </button>
          ))}
        </div>
        {fields.categoryId && <p className="text-xs text-signal">{fields.categoryId}</p>}
      </fieldset>

      <details className="rounded-md border border-graphite/15 px-3 py-2" open={Boolean(fields.competence || fields.notes || competenceImported)}>
        <summary className="flex min-h-9 cursor-pointer items-center justify-between text-sm font-semibold">
          Mais opções <span className="text-xs font-normal text-graphite/75">competência · observação</span>
        </summary>
        <div className="mt-3 flex flex-col gap-4 pb-1">
          {!editing && kind === 'recurring' && (
            <Field label="Termina em (opcional)" type="month" name="endMonth" value={endMonth} onChange={(e) => { setEndMonth(e.target.value); clear('endMonth') }} hint="Em branco: continua até você encerrar." error={fields.endMonth} />
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

      {editing && invoice.boleto && (
        <section aria-label="Boleto" className="rounded-md border border-graphite/15 px-3 py-3">
          <BoletoBox boleto={invoice.boleto} />
        </section>
      )}

      {inSeries && canWrite && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-xs font-medium uppercase tracking-wider text-graphite/80">
            {invoice.series?.kind === 'recurrence' ? 'Esta conta é fixa. Alterar' : 'Esta conta é uma parcela. Alterar'}
          </legend>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" aria-pressed={scope === 'this'} onClick={() => setScope('this')} className={chip(scope === 'this')}>só esta</button>
            <button type="button" aria-pressed={scope === 'following'} onClick={() => setScope('following')} className={chip(scope === 'following')}>esta e as seguintes</button>
          </div>
          {scope === 'following' && (
            <p className="text-xs text-graphite/75">Vale para as ainda não pagas daqui para frente. Contas pagas e anteriores não mudam, e o vencimento de cada uma é mantido.</p>
          )}
        </fieldset>
      )}

      {paid && invoice.paid && (
        <p className="rounded-md border border-graphite/15 px-3 py-2 text-sm">
          <span className="font-mono text-cobalt">[ ▪ ]</span> Paga em {fullDate(invoice.paid.paidAt)} · {walletName[invoice.paid.wallet]} · {formatCents(invoice.paid.amountCents)}
        </p>
      )}

      {canWrite && (
        <div className="flex flex-col gap-1.5">
          {editing && !paid && (
            <Button type="button" onClick={() => onPay(invoice)}>
              Marcar como paga · {walletName[payWallet]}
            </Button>
          )}
          <Button type="submit" variant={editing && !paid ? 'ghost' : 'primary'} disabled={busy || !description || amount <= 0 || !dueDate || !categoryId || (kind === 'installments' && !editing && !(Number(count) >= 2))}>
            {busy ? 'Salvando…' : editing ? 'Salvar alterações' : kind === 'installments' ? 'Adicionar compra parcelada' : kind === 'recurring' ? 'Adicionar conta fixa' : 'Adicionar conta'}
          </Button>
          {!editing && kind === 'single' && (
            <button
              type="button"
              disabled={busy || !description || amount <= 0 || !dueDate || !categoryId}
              onClick={() => void submit(true)}
              className="h-11 text-sm font-semibold text-cobalt underline underline-offset-4 disabled:text-graphite/40"
            >
              Adicionar e lançar outra
            </button>
          )}
          {editing && paid && (
            <Button type="button" variant="ghost" onClick={() => onUnpay(invoice)}>
              Desfazer pagamento
            </Button>
          )}
          {editing && (
            <>
              <button type="button" onClick={() => onDelete(invoice, 'this')} className="h-11 text-sm font-semibold text-graphite underline underline-offset-4">
                {inSeries ? 'Excluir só esta' : 'Excluir conta'}
              </button>
              {inSeries && (
                <button type="button" onClick={() => onDelete(invoice, 'following')} className="h-11 text-sm font-semibold text-graphite underline underline-offset-4">
                  Excluir esta e as seguintes
                </button>
              )}
            </>
          )}
        </div>
      )}
    </form>
  )
}
