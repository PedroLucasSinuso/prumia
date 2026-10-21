import { useState, type FormEvent } from 'react'

import { ApiError } from '../api/errors'
import type { Category, Invoice, InvoiceInput, InvoicePatch } from '../api/types'
import { networkErrorMessage, problemFields, problemMessage } from '../auth/errors'
import { monthOf, todayISO } from '../lib/dates'
import { formatCents } from '../lib/money'
import { Button } from './Button'
import { Field } from './Field'
import { FormError } from './FormError'
import { MoneyInput } from './MoneyInput'
import { Sheet } from './Sheet'

type Props = {
  /** Mês exibido na tela (padrão do vencimento ao criar). */
  month: string
  categories: Category[]
  invoice?: Invoice // presente = editar
  canWrite: boolean
  onClose: () => void
  onCreate: (body: InvoiceInput) => Promise<unknown>
  onUpdate: (id: string, body: InvoicePatch) => Promise<unknown>
  onDelete: (invoice: Invoice) => void
  onUnpay: (invoice: Invoice) => void
}

// Nomes dos campos da API -> o nome que o formulário usa para mostrar o erro.
const fieldMap: Record<string, string> = {
  description: 'description', amountCents: 'amount', dueDate: 'dueDate', categoryId: 'categoryId',
  competenceMonth: 'competence', notes: 'notes',
}

/** Formulário de criar/editar conta, num painel. "Mais opções" guarda competência e observação. */
export function InvoiceSheet({ month, categories, invoice, canWrite, onClose, onCreate, onUpdate, onDelete, onUnpay }: Props) {
  const editing = invoice !== undefined
  const defaultDue = month === monthOf(todayISO()) ? todayISO() : month

  const [description, setDescription] = useState(invoice?.description ?? '')
  const [amount, setAmount] = useState(invoice?.amountCents ?? 0)
  const [dueDate, setDueDate] = useState(invoice?.dueDate ?? defaultDue)
  const [categoryId, setCategoryId] = useState(invoice?.categoryId ?? categories[0]?.id ?? '')
  const [competence, setCompetence] = useState(invoice ? invoice.competenceMonth.slice(0, 7) : '')
  const [notes, setNotes] = useState(invoice?.notes ?? '')
  const [error, setError] = useState<string>()
  const [fields, setFields] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const clear = (f: string) => {
    setFields(({ [f]: _removed, ...rest }) => rest)
    setError(undefined)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
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
      } else {
        await onCreate({
          description, amountCents: amount, dueDate, categoryId,
          ...(competenceMonth ? { competenceMonth } : {}),
          ...(notes.trim() ? { notes } : {}),
        })
      }
      onClose()
    } catch (err) {
      const api = err instanceof ApiError ? err : undefined
      setError(api?.network ? networkErrorMessage : problemMessage(api?.problem))
      const raw = problemFields(api?.problem)
      setFields(Object.fromEntries(Object.entries(raw).map(([k, v]) => [fieldMap[k] ?? k, v])))
    } finally {
      setBusy(false)
    }
  }

  const paid = invoice?.status === 'paid' && invoice.paid
  const inSeries = invoice?.series != null

  return (
    <Sheet title={editing ? 'Detalhes da conta' : 'Nova conta'} onClose={onClose}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <FormError message={error} />
        <Field
          label="Descrição"
          name="description"
          autoFocus={!editing}
          autoComplete="off"
          required
          value={description}
          disabled={!canWrite}
          onChange={(e) => { setDescription(e.target.value); clear('description') }}
          error={fields.description}
        />
        <MoneyInput label="Valor" value={amount} onChange={(c) => { setAmount(c); clear('amount') }} error={fields.amount} />
        <Field
          label="Vencimento"
          type="date"
          name="dueDate"
          required
          value={dueDate}
          disabled={!canWrite}
          onChange={(e) => { setDueDate(e.target.value); clear('dueDate') }}
          error={fields.dueDate}
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="categoria" className="text-xs font-medium uppercase tracking-wider text-graphite/70">
            Categoria
          </label>
          <select
            id="categoria"
            value={categoryId}
            disabled={!canWrite}
            onChange={(e) => { setCategoryId(e.target.value); clear('categoryId') }}
            aria-invalid={fields.categoryId ? true : undefined}
            className={`h-11 rounded-md border bg-white/40 px-3 text-base text-graphite ${fields.categoryId ? 'border-signal' : 'border-graphite/25'}`}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {fields.categoryId && <p className="text-xs text-signal">{fields.categoryId}</p>}
        </div>

        <details className="rounded-md border border-graphite/15 p-3" open={Boolean(fields.competence || fields.notes)}>
          <summary className="cursor-pointer text-sm font-semibold text-graphite">Mais opções</summary>
          <div className="mt-3 flex flex-col gap-4">
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
            <Field
              label="Observação"
              name="notes"
              autoComplete="off"
              value={notes}
              disabled={!canWrite}
              onChange={(e) => { setNotes(e.target.value); clear('notes') }}
              error={fields.notes}
            />
          </div>
        </details>

        {inSeries && (
          <p className="text-xs text-graphite/70">Esta conta faz parte de uma série (parcelas ou conta fixa). Aqui você edita só ela.</p>
        )}

        {paid && invoice.paid && (
          <p className="rounded-md border border-graphite/15 px-3 py-2 text-sm">
            <span className="font-mono text-cobalt">[ ▪ ]</span> Paga em {invoice.paid.paidAt.split('-').reverse().join('/')} ·{' '}
            {invoice.paid.wallet === 'free' ? 'carteira livre' : 'carteira de benefício'} · {formatCents(invoice.paid.amountCents)}
          </p>
        )}

        {canWrite && (
          <div className="flex flex-col gap-2">
            <Button type="submit" disabled={busy || !description || amount <= 0 || !dueDate || !categoryId}>
              {busy ? 'Salvando…' : editing ? 'Salvar alterações' : 'Adicionar conta'}
            </Button>
            {editing && paid && (
              <Button type="button" variant="ghost" onClick={() => onUnpay(invoice)}>
                Desfazer pagamento
              </Button>
            )}
            {editing && (
              <Button type="button" variant="ghost" className="text-signal" onClick={() => onDelete(invoice)}>
                Excluir conta
              </Button>
            )}
          </div>
        )}
      </form>
    </Sheet>
  )
}
