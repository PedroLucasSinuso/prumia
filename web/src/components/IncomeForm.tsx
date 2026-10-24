import { useState, type FormEvent } from 'react'

import { ApiError } from '../api/errors'
import type { Deduction, Income, IncomeInput, IncomeKind, IncomePatch, Member } from '../api/types'
import { networkErrorMessage, problemFields, problemMessage } from '../auth/errors'
import { fullDate, monthOf, todayISO } from '../lib/dates'
import { kindLabel, netOf } from '../lib/income'
import { formatCents } from '../lib/money'
import { Button } from './Button'
import { DeductionsEditor } from './DeductionsEditor'
import { Field } from './Field'
import { FormError } from './FormError'
import { MoneyInput } from './MoneyInput'

type Props = {
  /** Mês exibido ("AAAA-MM-01"): competência de uma receita nova. */
  month: string
  members: Member[]
  /** Pessoa preselecionada ao criar (quem está logado). */
  defaultUserId: string
  income?: Income // presente = editar
  canWrite: boolean
  onDone: () => void
  onCreate: (body: IncomeInput) => Promise<unknown>
  onUpdate: (id: string, body: IncomePatch) => Promise<unknown>
  onDelete: (income: Income) => void
  onReceive: (income: Income) => void
  onUnreceive: (income: Income) => void
}

const kinds: IncomeKind[] = ['salary', 'benefit', 'other']
const chip = (on: boolean) =>
  `flex min-h-11 items-center justify-center rounded-md border px-3 text-[13px] ${on ? 'border-structure bg-structure font-semibold text-on-structure' : 'border-ink/30 font-medium hover:bg-ink/5'}`

/**
 * Receita do mês: criar uma avulsa ou ajustar a prevista/recebida (ex.: a coparticipação varia a cada mês).
 * O líquido aparece enquanto a pessoa digita; a fonte da verdade é o servidor. Editar uma receita gerada por fonte
 * muda só este mês; para mudar os próximos, edite a fonte.
 */
export function IncomeForm({ month, members, defaultUserId, income, canWrite, onDone, onCreate, onUpdate, onDelete, onReceive, onUnreceive }: Props) {
  const editing = income !== undefined
  const today = todayISO()
  const [userId, setUserId] = useState(income?.userId ?? defaultUserId)
  const [kind, setKind] = useState<IncomeKind>(income?.kind ?? 'salary')
  const [description, setDescription] = useState(income?.description ?? '')
  const [gross, setGross] = useState(income?.grossAmountCents ?? 0)
  const [expected, setExpected] = useState(income?.expectedDate ?? (month === monthOf(today) ? today : month))
  const [deductions, setDeductions] = useState<Deduction[]>(income?.deductions ?? [])
  const [notes, setNotes] = useState(income?.notes ?? '')
  const [error, setError] = useState<string>()
  const [fields, setFields] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const net = netOf(gross, deductions)
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
      if (editing) {
        await onUpdate(income.id, { description, expectedDate: expected, grossAmountCents: gross, deductions, notes: notes.trim() === '' ? null : notes })
      } else {
        await onCreate({
          userId, kind, description, competenceMonth: month, expectedDate: expected, grossAmountCents: gross, deductions,
          ...(notes.trim() ? { notes } : {}),
        })
      }
      onDone()
    } catch (err) {
      const api = err instanceof ApiError ? err : undefined
      setError(api?.network ? networkErrorMessage : problemMessage(api?.problem))
      setFields(problemFields(api?.problem))
    } finally {
      setBusy(false)
    }
  }

  const personName = (id: string) => members.find((m) => m.userId === id)?.name ?? 'pessoa'
  const valid = description.trim() !== '' && gross > 0 && net >= 0 && expected !== ''

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <FormError message={error} />

      {!editing ? (
        <>
          <fieldset className="flex flex-col gap-1.5" disabled={!canWrite}>
            <legend className="mb-1 text-xs font-medium uppercase tracking-wider text-ink/80">Tipo</legend>
            <div className="grid grid-cols-3 gap-2">
              {kinds.map((k) => (
                <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={chip(kind === k)}>
                  {k === 'benefit' ? 'Vale (VR)' : k === 'salary' ? 'Salário' : 'Outra'}
                </button>
              ))}
            </div>
            <p className="text-xs text-ink/75">{kind === 'benefit' ? 'Entra na carteira de benefício.' : 'Entra na carteira livre.'}</p>
          </fieldset>
          <div className="flex flex-col gap-1">
            <label htmlFor="pessoa" className="text-xs font-medium uppercase tracking-wider text-ink/80">De quem é</label>
            <select id="pessoa" value={userId} disabled={!canWrite} onChange={(e) => setUserId(e.target.value)} className="h-11 rounded-md border border-ink/25 bg-raised/40 px-3 text-base">
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
            {fields.userId && <p className="text-xs text-alert">{fields.userId}</p>}
          </div>
        </>
      ) : (
        <p className="text-sm text-ink/85">
          {kindLabel[income.kind]} de <strong>{personName(income.userId)}</strong> · carteira {income.wallet === 'free' ? 'livre' : 'de benefício'}
          {income.sourceId ? ' · gerada por uma fonte (editar aqui muda só este mês)' : ''}
        </p>
      )}

      <Field label="Descrição" name="description" autoComplete="off" autoFocus={!editing} required value={description} disabled={!canWrite}
        onChange={(e) => { setDescription(e.target.value); clear('description') }} error={fields.description} />

      <MoneyInput hero label="Valor bruto" value={gross} onChange={(c) => { setGross(c); clear('grossAmountCents') }} error={fields.grossAmountCents} />

      <Field label="Data prevista" type="date" name="expectedDate" required value={expected} disabled={!canWrite}
        onChange={(e) => { setExpected(e.target.value); clear('expectedDate') }} error={fields.expectedDate} />

      <DeductionsEditor value={deductions} onChange={(d) => { setDeductions(d); clear('deductions') }} errors={fields} disabled={!canWrite} />

      <div className={`rounded-md border-2 px-3 py-2.5 ${net < 0 ? 'border-alert' : 'border-structure'}`}>
        <p className="text-xs font-medium uppercase tracking-wider text-ink/80">líquido (bruto − descontos)</p>
        <p className="font-mono text-[34px] font-semibold leading-tight tabular-nums text-heading">{formatCents(net)}</p>
        {net < 0 && <p className="text-xs text-alert">Os descontos passam do valor bruto.</p>}
      </div>

      <Field label="Observação" name="notes" autoComplete="off" value={notes} disabled={!canWrite} onChange={(e) => setNotes(e.target.value)} error={fields.notes} />

      {editing && income.received && income.receivedAt && (
        <p className="rounded-md border border-line px-3 py-2 text-sm">
          <span className="font-mono text-accent">[ ▪ ]</span> Recebida em {fullDate(income.receivedAt)}
        </p>
      )}

      {canWrite && (
        <div className="flex flex-col gap-1.5">
          {editing && !income.received && (
            <Button type="button" onClick={() => onReceive(income)}>
              Marcar como recebida
            </Button>
          )}
          <Button type="submit" variant={editing && !income.received ? 'ghost' : 'primary'} disabled={busy || !valid}>
            {busy ? 'Salvando…' : editing ? 'Salvar alterações' : 'Adicionar receita'}
          </Button>
          {editing && income.received && (
            <Button type="button" variant="ghost" onClick={() => onUnreceive(income)}>
              Desfazer recebimento
            </Button>
          )}
          {editing && (
            <button type="button" onClick={() => onDelete(income)} className="h-11 text-sm font-semibold underline underline-offset-4">
              Excluir receita
            </button>
          )}
        </div>
      )}
    </form>
  )
}
