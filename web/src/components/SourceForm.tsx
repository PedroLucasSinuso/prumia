import { useState, type FormEvent } from 'react'

import { ApiError } from '../api/errors'
import type { Deduction, IncomeKind, IncomeSource, IncomeSourceInput, IncomeSourcePatch, Member } from '../api/types'
import { networkErrorMessage, problemFields, problemMessage } from '../auth/errors'
import { currentMonth } from '../lib/dates'
import { kindLabel, netOf } from '../lib/income'
import { formatCents } from '../lib/money'
import { Button } from './Button'
import { DeductionsEditor } from './DeductionsEditor'
import { Field } from './Field'
import { FormError } from './FormError'
import { MoneyInput } from './MoneyInput'

type Props = {
  /** Mês exibido: começo padrão da fonte e mês a partir do qual reaplicar. */
  month: string
  members: Member[]
  defaultUserId: string
  source?: IncomeSource // presente = editar
  /** Tipo sugerido ao criar (ex.: o atalho "Cadastrar salário"). */
  defaultKind?: IncomeKind
  canWrite: boolean
  onDone: () => void
  onCreate: (body: IncomeSourceInput) => Promise<unknown>
  onUpdate: (id: string, body: IncomeSourcePatch, applyFrom?: string) => Promise<unknown>
}

const kinds: IncomeKind[] = ['salary', 'benefit', 'other']
const chip = (on: boolean) =>
  `flex min-h-11 items-center justify-center rounded-md border px-3 text-[13px] ${on ? 'border-structure bg-structure font-semibold text-on-structure' : 'border-ink/30 font-medium hover:bg-ink/5'}`

/**
 * A fonte é o "molde" mensal (salário, VR): bruto, dia do mês e descontos. Cadastre uma vez e o app prevê os meses seguintes,
 * sem relançar todo mês. Cada mês previsto continua editável (a coparticipação muda, por exemplo).
 */
export function SourceForm({ month, members, defaultUserId, source, defaultKind = 'salary', canWrite, onDone, onCreate, onUpdate }: Props) {
  const editing = source !== undefined
  const [userId, setUserId] = useState(source?.userId ?? defaultUserId)
  const [kind, setKind] = useState<IncomeKind>(source?.kind ?? defaultKind)
  const [name, setName] = useState(source?.name ?? '')
  const [gross, setGross] = useState(source?.grossAmountCents ?? 0)
  const [day, setDay] = useState(String(source?.dayOfMonth ?? 5))
  const [start, setStart] = useState((source?.startMonth ?? month).slice(0, 7))
  const [end, setEnd] = useState(source?.endMonth ? source.endMonth.slice(0, 7) : '')
  const [deductions, setDeductions] = useState<Deduction[]>(source?.deductions ?? [])
  const [notes, setNotes] = useState(source?.notes ?? '')
  const [reapply, setReapply] = useState(false)
  const [applyFrom, setApplyFrom] = useState(currentMonth().slice(0, 7))
  const [error, setError] = useState<string>()
  const [fields, setFields] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const net = netOf(gross, deductions)
  const clear = (f: string) => {
    setFields(({ [f]: _removed, ...rest }) => rest)
    setError(undefined)
  }
  const dayNumber = Number(day)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    setFields({})
    try {
      if (editing) {
        await onUpdate(
          source.id,
          { name, grossAmountCents: gross, dayOfMonth: dayNumber, deductions, endMonth: end ? `${end}-01` : null, notes: notes.trim() === '' ? null : notes },
          reapply ? `${applyFrom}-01` : undefined,
        )
      } else {
        await onCreate({
          userId, kind, name, grossAmountCents: gross, dayOfMonth: dayNumber, startMonth: `${start}-01`, deductions,
          ...(end ? { endMonth: `${end}-01` } : {}),
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

  const valid = name.trim() !== '' && gross > 0 && net >= 0 && dayNumber >= 1 && dayNumber <= 31 && start !== ''

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
          </fieldset>
          <div className="flex flex-col gap-1">
            <label htmlFor="fonte-pessoa" className="text-xs font-medium uppercase tracking-wider text-ink/80">De quem é</label>
            <select id="fonte-pessoa" value={userId} disabled={!canWrite} onChange={(e) => setUserId(e.target.value)} className="h-11 rounded-md border border-ink/25 bg-raised/40 px-3 text-base">
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </>
      ) : (
        <p className="text-sm text-ink/85">
          {kindLabel[source.kind]} · carteira {source.wallet === 'free' ? 'livre' : 'de benefício'}
          {source.generatedThrough ? ` · previsão gerada até ${source.generatedThrough.slice(5, 7)}/${source.generatedThrough.slice(0, 4)}` : ''}
        </p>
      )}

      <Field label="Nome" name="name" placeholder="Ex.: Salário Pedro" autoComplete="off" autoFocus={!editing} required value={name} disabled={!canWrite}
        onChange={(e) => { setName(e.target.value); clear('name') }} error={fields.name} />

      <MoneyInput hero label="Valor bruto mensal" value={gross} onChange={(c) => { setGross(c); clear('grossAmountCents') }} error={fields.grossAmountCents} />

      <div className="grid grid-cols-2 gap-3">
        <Field label="Cai no dia" type="number" inputMode="numeric" min={1} max={31} name="dayOfMonth" value={day} disabled={!canWrite}
          hint="Mês curto: usa o último dia." onChange={(e) => { setDay(e.target.value); clear('dayOfMonth') }} error={fields.dayOfMonth} />
        <Field label="Começa em" type="month" name="startMonth" value={start} disabled={!canWrite || editing}
          onChange={(e) => { setStart(e.target.value); clear('startMonth') }} error={fields.startMonth} />
      </div>
      <Field label="Termina em (opcional)" type="month" name="endMonth" value={end} disabled={!canWrite} hint="Só dá para antecipar o fim; os meses depois dele deixam de ser previstos."
        onChange={(e) => { setEnd(e.target.value); clear('endMonth') }} error={fields.endMonth} />

      <DeductionsEditor value={deductions} onChange={(d) => { setDeductions(d); clear('deductions') }} errors={fields} disabled={!canWrite} />

      <div className={`rounded-md border-2 px-3 py-2.5 ${net < 0 ? 'border-alert' : 'border-structure'}`}>
        <p className="text-xs font-medium uppercase tracking-wider text-ink/80">líquido previsto por mês</p>
        <p className="font-mono text-[34px] font-semibold leading-tight tabular-nums text-heading">{formatCents(net)}</p>
        {net < 0 && <p className="text-xs text-alert">Os descontos passam do valor bruto.</p>}
      </div>

      <Field label="Observação" name="notes" autoComplete="off" value={notes} disabled={!canWrite} onChange={(e) => setNotes(e.target.value)} error={fields.notes} />

      {editing && canWrite && (
        <div className="rounded-md border border-ink/20 p-3">
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
            <input type="checkbox" checked={reapply} onChange={(e) => setReapply(e.target.checked)} className="mt-1 size-5 accent-structure" />
            <span>
              <strong>Reaplicar este molde aos meses previstos</strong>
              <span className="block text-xs text-ink/75">
                Atualiza valor, descontos e dia dos meses que ainda não foram recebidos. Meses recebidos não mudam.
              </span>
            </span>
          </label>
          {reapply && (
            <div className="mt-2 flex flex-col gap-2">
              <Field label="A partir de" type="month" name="applyFrom" value={applyFrom} onChange={(e) => setApplyFrom(e.target.value)} />
              <p role="note" className="rounded-md bg-alert/10 px-3 py-2 text-xs">
                <span className="font-mono text-alert">[ ✖ ]</span> Atenção: isso <strong>sobrescreve os ajustes que você fez nesses meses</strong>
                (por exemplo, uma coparticipação diferente).
              </p>
            </div>
          )}
        </div>
      )}

      {canWrite && (
        <Button type="submit" disabled={busy || !valid}>
          {busy ? 'Salvando…' : editing ? (reapply ? 'Salvar e reaplicar' : 'Salvar fonte') : 'Cadastrar fonte'}
        </Button>
      )}
    </form>
  )
}
