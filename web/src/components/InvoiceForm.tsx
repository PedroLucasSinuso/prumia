import { useRef, useState, type FormEvent } from 'react'

import { ApiError } from '../api/errors'
import type { Category, Invoice, InvoiceInput, InvoicePatch } from '../api/types'
import { networkErrorMessage, problemFields, problemMessage } from '../auth/errors'
import { addDays, dayMonth, fullDate, monthOf, todayISO } from '../lib/dates'
import { formatCents } from '../lib/money'
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
  onUpdate: (id: string, body: InvoicePatch) => Promise<unknown>
  onDelete: (invoice: Invoice) => void
  onUnpay: (invoice: Invoice) => void
  onPay: (invoice: Invoice) => void
}

// Nomes dos campos da API -> nome que o formulário usa para mostrar o erro.
const fieldMap: Record<string, string> = {
  description: 'description', amountCents: 'amount', dueDate: 'dueDate', categoryId: 'categoryId',
  competenceMonth: 'competence', notes: 'notes',
}

const walletName = { free: 'carteira livre', benefit: 'carteira de benefício' } as const

const chip = (on: boolean) =>
  `flex min-h-11 items-center justify-center gap-1.5 rounded-md border px-3 text-[13px] ${
    on ? 'border-teal bg-teal font-semibold text-ivory' : 'border-graphite/30 font-medium text-graphite hover:bg-graphite/5'
  }`

/**
 * Formulário de criar/editar conta. Valor em destaque; vencimento e categoria são BOTÕES visíveis (nada de menu suspenso):
 * menos toques e menos decisões escondidas. "Mais opções" guarda competência e observação.
 */
export function InvoiceForm({ month, categories, invoice, canWrite, onDone, onCreate, onUpdate, onDelete, onUnpay, onPay }: Props) {
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
  const [error, setError] = useState<string>()
  const [fields, setFields] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const descRef = useRef<HTMLInputElement>(null)

  const clear = (f: string) => {
    setFields(({ [f]: _removed, ...rest }) => rest)
    setError(undefined)
  }

  async function submit(addAnother: boolean) {
    setBusy(true)
    setError(undefined)
    setFields({})
    try {
      const competenceMonth = competence ? `${competence}-01` : undefined
      if (editing) {
        await onUpdate(invoice.id, {
          description, amountCents: amount, dueDate, categoryId,
          ...(competenceMonth ? { competenceMonth } : {}),
          notes: notes.trim() === '' ? null : notes,
        } as InvoicePatch)
        onDone()
      } else {
        await onCreate({
          description, amountCents: amount, dueDate, categoryId,
          ...(competenceMonth ? { competenceMonth } : {}),
          ...(notes.trim() ? { notes } : {}),
        })
        if (addAnother) {
          // mantém categoria e vencimento (lançar várias contas parecidas) e volta ao começo
          setDescription('')
          setAmount(0)
          setNotes('')
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

      <MoneyInput hero label="Valor" value={amount} onChange={(c) => { setAmount(c); clear('amount') }} error={fields.amount} />

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
        <legend className={otherDate ? 'sr-only' : 'mb-1 text-xs font-medium uppercase tracking-wider text-graphite/80'}>Vence</legend>
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

      <details className="rounded-md border border-graphite/15 px-3 py-2" open={Boolean(fields.competence || fields.notes)}>
        <summary className="flex min-h-9 cursor-pointer items-center justify-between text-sm font-semibold">
          Mais opções <span className="text-xs font-normal text-graphite/75">competência · observação</span>
        </summary>
        <div className="mt-3 flex flex-col gap-4 pb-1">
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
          <Field label="Observação" name="notes" autoComplete="off" value={notes} disabled={!canWrite} onChange={(e) => { setNotes(e.target.value); clear('notes') }} error={fields.notes} />
        </div>
      </details>

      {inSeries && <p className="text-xs text-graphite/75">Esta conta faz parte de uma série (parcelas ou conta fixa). Aqui você edita só ela.</p>}

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
          <Button type="submit" variant={editing && !paid ? 'ghost' : 'primary'} disabled={busy || !description || amount <= 0 || !dueDate || !categoryId}>
            {busy ? 'Salvando…' : editing ? 'Salvar alterações' : 'Adicionar conta'}
          </Button>
          {!editing && (
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
            <button type="button" onClick={() => onDelete(invoice)} className="h-11 text-sm font-semibold text-graphite underline underline-offset-4">
              Excluir conta
            </button>
          )}
        </div>
      )}
    </form>
  )
}
