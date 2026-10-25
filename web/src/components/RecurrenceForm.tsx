import { useState, type FormEvent } from 'react'

import { ApiError } from '../api/errors'
import type { Recurrence, RecurrencePatch } from '../api/types'
import { networkErrorMessage, problemFields, problemMessage } from '../auth/errors'
import { Button } from './ui/Button'
import { Field } from './Field'
import { FormError } from './FormError'
import { MoneyInput } from './MoneyInput'

type Props = {
  recurrence: Recurrence
  canWrite: boolean
  onSave: (body: RecurrencePatch) => Promise<unknown>
  onDone: () => void
}

/**
 * Edita uma conta fixa. Vale para as ocorrências futuras ainda não pagas; as pagas e as passadas nunca mudam.
 * O fim só pode ser antecipado (o servidor recusa adiar), por isso "Encerrar" é o caminho para parar de cobrar.
 */
export function RecurrenceForm({ recurrence, canWrite, onSave, onDone }: Props) {
  const [description, setDescription] = useState(recurrence.description)
  const [amount, setAmount] = useState(recurrence.amountCents)
  const [day, setDay] = useState(String(recurrence.dayOfMonth))
  const [endMonth, setEndMonth] = useState(recurrence.endMonth?.slice(0, 7) ?? '')
  const [error, setError] = useState<string>()
  const [fields, setFields] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  async function save(e?: FormEvent) {
    e?.preventDefault()
    setBusy(true)
    setError(undefined)
    setFields({})
    try {
      await onSave({
        description, amountCents: amount, dayOfMonth: Number(day),
        ...(endMonth && endMonth !== recurrence.endMonth?.slice(0, 7) ? { endMonth: `${endMonth}-01` } : {}),
      })
      onDone()
    } catch (err) {
      const api = err instanceof ApiError ? err : undefined
      setError(api?.network ? networkErrorMessage : problemMessage(api?.problem))
      setFields(problemFields(api?.problem))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4" noValidate>
      <FormError message={error} />
      <MoneyInput label="Valor" value={amount} onChange={setAmount} error={fields.amountCents} />
      <Field label="Descrição" value={description} disabled={!canWrite} onChange={(e) => setDescription(e.target.value)} error={fields.description} />
      <Field label="Dia do vencimento" type="number" inputMode="numeric" min={1} max={31} value={day} disabled={!canWrite} onChange={(e) => setDay(e.target.value)} error={fields.dayOfMonth} />
      <Field
        label="Termina em"
        type="month"
        value={endMonth}
        disabled={!canWrite}
        onChange={(e) => setEndMonth(e.target.value)}
        hint={recurrence.endMonth ? 'Só dá para antecipar o fim.' : 'Em branco: continua todo mês.'}
        error={fields.endMonth}
      />
      <p className="text-meta text-muted">As mudanças valem para as próximas contas ainda não pagas. As pagas e as passadas ficam como estão.</p>
      {canWrite && (
        <Button type="submit" disabled={busy || !description || amount <= 0 || !(Number(day) >= 1)}>
          {busy ? 'Salvando…' : 'Salvar'}
        </Button>
      )}
    </form>
  )
}
