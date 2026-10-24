import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'

import { ApiError } from '../api/errors'
import { estimateTax, useIncomeDatePreview } from '../api/queries'
import type { AmountMode, DateRule, Deduction, Income, IncomeInput, IncomeKind, IncomePatch, Member, SeriesScope, WeekendAdjust } from '../api/types'
import { networkErrorMessage, problemFields, problemMessage } from '../auth/errors'
import { dayMonth, monthLabel, weekdayShort } from '../lib/dates'
import { deductionLabel, kindLabel, netOf, sumDeductions } from '../lib/income'
import { formatCents } from '../lib/money'
import { Button } from './Button'
import { DeductionsEditor } from './DeductionsEditor'
import { Field } from './Field'
import { FormError } from './FormError'
import { MoneyInput } from './MoneyInput'

type Props = {
  houseId: string
  /** Mês exibido ("AAAA-MM-01"): competência de uma receita nova. */
  month: string
  members: Member[]
  /** Pessoa preselecionada ao criar (quem está logado). */
  defaultUserId: string
  income?: Income // presente = editar
  /** Abre o escopo já marcado em "este e os seguintes" (vindo de "Receitas que se repetem"). */
  startScope?: SeriesScope
  canWrite: boolean
  onDone: () => void
  onCancel?: () => void
  onCreate: (body: IncomeInput) => Promise<unknown>
  onUpdate: (id: string, body: IncomePatch, scope: SeriesScope) => Promise<unknown>
}

type RuleChoice = 'date' | DateRule['rule']

const kinds: IncomeKind[] = ['salary', 'benefit', 'other']
const chip = (on: boolean) =>
  `flex min-h-11 items-center justify-center rounded-md border px-3 text-[13px] ${on ? 'border-structure bg-structure font-semibold text-on-structure' : 'border-ink/30 font-medium hover:bg-ink/5'}`
const legend = 'mb-2 p-0 text-xs font-semibold uppercase tracking-wider text-ink/80'
const select = 'h-11 w-full rounded-md border border-ink/25 bg-raised/40 px-3 text-base text-ink'
const group = 'border-t border-line pt-4'
const inner = 'flex flex-col gap-3'

const adjustLabel: Record<WeekendAdjust, string> = {
  forward: 'Próximo dia útil (padrão)',
  backward: 'Dia útil anterior',
  none: 'Manter a data',
}

const sameDeductions = (a: Deduction[], b: Deduction[]) => JSON.stringify(a) === JSON.stringify(b)

/**
 * A receita, num formulário só: pessoa e tipo, valor (cheio ou por unidade), quando cai (dia do mês, N-ésimo dia útil ou
 * último dia útil, com a prévia das próximas datas), se repete todo mês e os descontos (opcionais). Não existe mais a
 * diferença entre "fonte" e "lançamento": numa receita que se repete, a edição pergunta se vale só para este mês ou
 * para este e os seguintes. O líquido aparece enquanto a pessoa digita; a fonte da verdade é o servidor.
 */
export function IncomeForm({ houseId, month, members, defaultUserId, income, startScope, canWrite, onDone, onCancel, onCreate, onUpdate }: Props) {
  const editing = income !== undefined
  const competence = income?.competenceMonth ?? month

  const [userId, setUserId] = useState(income?.userId ?? defaultUserId)
  const [kind, setKind] = useState<IncomeKind>(income?.kind ?? 'salary')
  const [description, setDescription] = useState(income?.description ?? '')

  const [mode, setMode] = useState<AmountMode>(income?.amountMode ?? 'fixed')
  const [gross, setGross] = useState(income?.grossAmountCents ?? 0)
  const [price, setPrice] = useState(income?.unitPriceCents ?? 0)
  const [unitLabel, setUnitLabel] = useState(income?.unitLabel ?? 'dia trabalhado')
  const [quantity, setQuantity] = useState(income?.quantity != null ? String(income.quantity) : '')
  const qtyTouched = useRef(editing)

  const [rule, setRule] = useState<RuleChoice>(income ? (income.dateRule?.rule ?? 'date') : 'day_of_month')
  const [ruleN, setRuleN] = useState(String(income?.dateRule?.n ?? 5))
  const [adjust, setAdjust] = useState<WeekendAdjust>(income?.dateRule?.weekendAdjust ?? 'forward')
  const [exact, setExact] = useState(income?.expectedDate ?? '')

  const [repeats, setRepeats] = useState(!editing)
  const repeatsTouched = useRef(false)
  const [until, setUntil] = useState('')

  const [deductions, setDeductions] = useState<Deduction[]>(income?.deductions ?? [])
  const [dependents, setDependents] = useState('0')
  const [taxNote, setTaxNote] = useState<string>()
  const [taxBusy, setTaxBusy] = useState(false)
  const [notes, setNotes] = useState(income?.notes ?? '')
  const [competenceInput, setCompetenceInput] = useState(competence.slice(0, 7))

  const canAskScope = editing && income.repeats && !income.received
  const [scope, setScope] = useState<SeriesScope>(canAskScope ? (startScope ?? 'this') : 'this')
  const following = scope === 'following'
  // "Uma data específica" só existe para um mês: em lote, volta para a regra que a receita já tinha.
  const chooseFollowing = () => {
    setScope('following')
    if (rule === 'date') setRule(income?.dateRule?.rule ?? 'day_of_month')
  }

  const [error, setError] = useState<string>()
  const [fields, setFields] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const clear = (f: string) => {
    setFields(({ [f]: _removed, ...rest }) => rest)
    setError(undefined)
  }

  // Regra de data em edição (só vale quando a escolha é uma regra e o N é válido).
  const nNumber = Number(ruleN)
  const nValid = rule === 'day_of_month' ? Number.isInteger(nNumber) && nNumber >= 1 && nNumber <= 31 : rule === 'nth_business_day' ? Number.isInteger(nNumber) && nNumber >= 1 && nNumber <= 23 : true
  const currentRule: DateRule | undefined =
    rule === 'date' || !nValid ? undefined : { rule, ...(rule === 'last_business_day' ? {} : { n: nNumber }), ...(rule === 'day_of_month' ? { weekendAdjust: adjust } : {}) }
  // A prévia também serve para sugerir a quantidade (dias úteis do mês): sem regra válida usa o último dia útil só para contar.
  const previewRule: DateRule = currentRule ?? { rule: 'last_business_day' }
  const preview = useIncomeDatePreview(houseId, previewRule, competence, 3)
  const businessDays = preview.data?.[0]?.businessDays

  // Receita nova por unidade: sugere a quantidade = dias úteis do mês, até a pessoa mexer no campo.
  useEffect(() => {
    if (mode === 'per_unit' && !qtyTouched.current && businessDays != null) setQuantity(String(businessDays))
  }, [mode, businessDays])

  const qty = Number(quantity)
  const qtyValid = Number.isInteger(qty) && qty >= 1 && qty <= 999
  const total = mode === 'per_unit' ? (qtyValid ? price * qty : 0) : gross
  const net = netOf(total, deductions)

  async function suggestTax() {
    setTaxBusy(true)
    setTaxNote(undefined)
    try {
      const est = await estimateTax(houseId, competence, total, Math.max(0, Math.min(20, Number(dependents) || 0)))
      const keep = deductions.filter((d) => d.kind !== 'inss' && d.kind !== 'irrf')
      const suggested: Deduction[] = [
        ...(est.inssCents > 0 ? [{ kind: 'inss' as const, name: deductionLabel.inss, amountCents: est.inssCents }] : []),
        ...(est.irrfCents > 0 ? [{ kind: 'irrf' as const, name: deductionLabel.irrf, amountCents: est.irrfCents }] : []),
      ]
      setDeductions([...suggested, ...keep])
      clear('deductions')
      const other = est.tableYear !== Number(competence.slice(0, 4)) ? ` (tabela de ${est.tableYear}, a mais recente que temos)` : ''
      setTaxNote(`Estimativa pela tabela de ${est.tableYear}${other}; confira no seu holerite.`)
    } catch {
      setTaxNote('Não foi possível calcular agora. Digite os valores do holerite.')
    } finally {
      setTaxBusy(false)
    }
  }

  const amountFields = (): Partial<IncomePatch> =>
    mode === 'per_unit'
      ? { amountMode: 'per_unit', unitPriceCents: price, unitLabel: unitLabel.trim(), ...(following ? {} : { quantity: qty }) }
      : { amountMode: 'fixed', grossAmountCents: gross }

  function buildPatch(): IncomePatch {
    if (!income) return {}
    const orig = income
    const patch: IncomePatch = {}
    if (userId !== orig.userId) patch.userId = userId
    if (kind !== orig.kind) patch.kind = kind
    if (description.trim() !== orig.description) patch.description = description.trim()
    if ((notes.trim() || null) !== (orig.notes ?? null)) patch.notes = notes.trim() === '' ? null : notes
    const amountChanged =
      mode !== orig.amountMode ||
      (mode === 'fixed' ? gross !== orig.grossAmountCents : price !== orig.unitPriceCents || unitLabel.trim() !== (orig.unitLabel ?? '') || (!following && qty !== orig.quantity))
    if (amountChanged) Object.assign(patch, amountFields())
    const o = orig.dateRule
    if (currentRule && (currentRule.rule !== o?.rule || (currentRule.n ?? null) !== (o?.n ?? null) || (currentRule.weekendAdjust ?? 'forward') !== (o?.weekendAdjust ?? 'forward'))) {
      patch.dateRule = currentRule
    } else if (rule === 'date' && !following && exact !== orig.expectedDate) {
      patch.expectedDate = exact
    }
    if (!following && competenceInput !== competence.slice(0, 7)) patch.competenceMonth = `${competenceInput}-01`
    if (!sameDeductions(deductions, orig.deductions)) patch.deductions = deductions
    return patch
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    setFields({})
    try {
      if (editing) {
        const patch = buildPatch()
        if (Object.keys(patch).length > 0) await onUpdate(income.id, patch, scope)
      } else {
        await onCreate({
          userId, kind, description: description.trim(), competenceMonth: month, ...amountFields(),
          ...(currentRule ? { dateRule: currentRule } : { expectedDate: exact }),
          ...(repeats ? { repeats: true, ...(until ? { repeatsUntil: `${until}-01` } : {}) } : {}),
          ...(deductions.length > 0 ? { deductions } : {}),
          ...(notes.trim() ? { notes } : {}),
        } as IncomeInput)
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

  const ruleOk = rule === 'date' ? exact !== '' && !(repeats && !editing) : nValid
  const amountOk = mode === 'per_unit' ? price > 0 && qtyValid && unitLabel.trim() !== '' : gross > 0
  const valid = description.trim() !== '' && amountOk && net >= 0 && ruleOk
  const personName = (id: string) => members.find((m) => m.userId === id)?.name ?? 'pessoa'
  const dis = !canWrite

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <FormError message={error} />

      {/* Quem e o quê */}
      <fieldset className={inner} disabled={dis}>
        <legend className={legend}>Quem e o quê</legend>
        <div className="flex flex-col gap-1">
          <label htmlFor="pessoa" className="text-xs font-medium uppercase tracking-wider text-ink/70">Pessoa</label>
          <select id="pessoa" value={userId} onChange={(e) => { setUserId(e.target.value); clear('userId') }} className={select}>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>{m.name}</option>
            ))}
          </select>
          {fields.userId && <p className="text-xs text-alert">{fields.userId}</p>}
        </div>
        <div role="group" aria-label="Tipo" className="grid grid-cols-3 gap-2">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => {
                setKind(k)
                if (!repeatsTouched.current && !editing) setRepeats(k !== 'other')
              }}
              className={chip(kind === k)}
            >
              {k === 'benefit' ? 'Vale (VR)' : k === 'salary' ? 'Salário' : 'Outra'}
            </button>
          ))}
        </div>
        <p className="text-xs text-ink/75">{kind === 'benefit' ? 'Entra na carteira de benefício.' : 'Entra na carteira livre.'}</p>
        <Field label="Descrição" name="description" autoComplete="off" data-autofocus="" autoFocus={!editing} required value={description}
          placeholder={kind === 'benefit' ? 'Ex.: Vale-refeição' : 'Ex.: Salário'} onChange={(e) => { setDescription(e.target.value); clear('description') }} error={fields.description} />
      </fieldset>

      {/* Valor */}
      <div className={group}>
        <fieldset className={inner} disabled={dis}>
        <legend className={legend}>Valor</legend>
        <div role="group" aria-label="Como o valor é calculado" className="grid grid-cols-2 gap-2">
          <button type="button" aria-pressed={mode === 'fixed'} onClick={() => setMode('fixed')} className={chip(mode === 'fixed')}>Valor cheio</button>
          <button type="button" aria-pressed={mode === 'per_unit'} onClick={() => setMode('per_unit')} className={chip(mode === 'per_unit')}>Por unidade</button>
        </div>
        {mode === 'fixed' ? (
          <MoneyInput hero label="Valor bruto" value={gross} onChange={(c) => { setGross(c); clear('grossAmountCents') }} error={fields.grossAmountCents} />
        ) : (
          <>
            <MoneyInput hero label="Preço por unidade" value={price} onChange={(c) => { setPrice(c); clear('unitPriceCents') }} error={fields.unitPriceCents} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Unidade" name="unitLabel" autoComplete="off" value={unitLabel} placeholder="dia trabalhado, hora, plantão"
                onChange={(e) => { setUnitLabel(e.target.value); clear('unitLabel') }} error={fields.unitLabel} />
              <Field label="Quantidade" name="quantity" type="number" inputMode="numeric" min={1} max={999} value={quantity}
                disabled={following}
                hint={following ? 'Cada mês tem a sua quantidade.' : businessDays != null ? `Sugerida: ${businessDays} dias úteis em ${monthLabel(competence)}.` : undefined}
                onChange={(e) => { qtyTouched.current = true; setQuantity(e.target.value); clear('quantity') }} error={fields.quantity} />
            </div>
            <p className="font-mono text-sm tabular-nums text-ink/85" aria-live="polite">
              {qtyValid ? `${qty} × ${formatCents(price)} = ${formatCents(total)}` : 'Informe a quantidade.'}
            </p>
          </>
        )}
      </fieldset>
      </div>

      {/* Quando cai */}
      <div className={group}>
        <fieldset className={inner} disabled={dis}>
        <legend className={legend}>Quando cai</legend>
        <div className="flex flex-col gap-1">
          <label htmlFor="regra" className="text-xs font-medium uppercase tracking-wider text-ink/70">Regra da data</label>
          <select id="regra" value={rule} onChange={(e) => { setRule(e.target.value as RuleChoice); clear('dateRule.rule'); clear('dateRule.n') }} className={select}>
            <option value="day_of_month">Dia do mês</option>
            <option value="nth_business_day">N-ésimo dia útil do mês</option>
            <option value="last_business_day">Último dia útil do mês</option>
            {(!repeats || editing) && !following && <option value="date">Uma data específica</option>}
          </select>
        </div>
        {(rule === 'day_of_month' || rule === 'nth_business_day') && (
          <Field
            label={rule === 'day_of_month' ? 'Dia' : 'Ordem do dia útil (1 = primeiro)'} name="ruleN" type="number" inputMode="numeric"
            min={1} max={rule === 'day_of_month' ? 31 : 23} value={ruleN} onChange={(e) => { setRuleN(e.target.value); clear('dateRule.n') }}
            hint={rule === 'nth_business_day' ? 'Sábado, domingo e feriados nacionais não contam como dia útil.' : 'Em mês curto, vale o último dia do mês.'}
            error={fields['dateRule.n']}
          />
        )}
        {rule === 'day_of_month' && (
          <div className="flex flex-col gap-1">
            <label htmlFor="ajuste" className="text-xs font-medium uppercase tracking-wider text-ink/70">Se cair em fim de semana ou feriado</label>
            <select id="ajuste" value={adjust} onChange={(e) => setAdjust(e.target.value as WeekendAdjust)} className={select}>
              {(Object.keys(adjustLabel) as WeekendAdjust[]).map((a) => (
                <option key={a} value={a}>{adjustLabel[a]}</option>
              ))}
            </select>
          </div>
        )}
        {rule === 'date' && (
          <Field label="Data" type="date" name="expectedDate" required value={exact} onChange={(e) => { setExact(e.target.value); clear('expectedDate') }} error={fields.expectedDate} />
        )}
        {currentRule && preview.data && (
          <p className="rounded-md border border-line px-3 py-2 text-[13px] text-ink/85" aria-live="polite">
            <span className="text-xs font-medium uppercase tracking-wider text-ink/70">Próximas datas</span>
            <span className="mt-0.5 block font-mono tabular-nums">
              {preview.data.map((p) => `${dayMonth(p.expectedDate)} (${weekdayShort(p.expectedDate)})`).join(' · ')}
            </span>
          </p>
        )}
        {editing && !following && (
          <Field label="Mês de competência" type="month" name="competenceMonth" value={competenceInput}
            hint="Mude só se a receita pertence a outro mês." onChange={(e) => { setCompetenceInput(e.target.value); clear('competenceMonth') }} error={fields.competenceMonth} />
        )}
      </fieldset>
      </div>

      {/* Repetição */}
      {!editing && (
        <div className={group}>
          <fieldset className={inner} disabled={dis}>
          <legend className={legend}>Repetição</legend>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={repeats}
              onChange={(e) => {
                repeatsTouched.current = true
                setRepeats(e.target.checked)
                if (e.target.checked && rule === 'date') setRule('day_of_month')
              }}
              className="size-5 accent-structure"
            />
            Repete todo mês
          </label>
          {repeats && (
            <Field label="Até (opcional)" type="month" name="repeatsUntil" value={until} min={month.slice(0, 7)} hint="Sem data, repete até você encerrar."
              onChange={(e) => { setUntil(e.target.value); clear('endMonth') }} error={fields.endMonth} />
          )}
          </fieldset>
        </div>
      )}

      {/* Descontos */}
      <div className={group}>
        <DeductionsEditor value={deductions} onChange={(d) => { setDeductions(d); clear('deductions'); setTaxNote(undefined) }} errors={fields} disabled={dis} />
        {kind === 'salary' && canWrite && (
          <div className="flex flex-col gap-2 rounded-md border border-line p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-28">
                <Field label="Dependentes" type="number" inputMode="numeric" min={0} max={20} value={dependents} onChange={(e) => setDependents(e.target.value)} />
              </div>
              <Button type="button" variant="ghost" disabled={taxBusy || total <= 0} onClick={() => void suggestTax()}>
                {taxBusy ? 'Calculando…' : 'Sugerir INSS e IRRF'}
              </Button>
            </div>
            <p className="text-xs text-ink/75" aria-live="polite">
              {taxNote ?? 'Opcional. Preenche os descontos pela tabela do ano; você pode editar. Os descontos nunca são aplicados sozinhos.'}
            </p>
          </div>
        )}
      </div>

      <div className={`rounded-md border-2 px-3 py-2.5 ${net < 0 ? 'border-alert' : 'border-structure'}`}>
        <p className="text-xs font-medium uppercase tracking-wider text-ink/80">líquido{sumDeductions(deductions) > 0 ? ' (valor − descontos)' : ''}</p>
        <p className="font-mono text-[34px] font-semibold leading-tight tabular-nums text-heading">{formatCents(net)}</p>
        {net < 0 && <p className="text-xs text-alert">Os descontos passam do valor.</p>}
      </div>

      <Field label="Observação" name="notes" autoComplete="off" value={notes} disabled={dis} onChange={(e) => setNotes(e.target.value)} error={fields.notes} />

      {editing && (
        <p className="text-xs text-ink/75">
          {kindLabel[income.kind]} de <strong>{personName(income.userId)}</strong>
          {income.repeats ? ' · repete todo mês' : ''}
          {income.repeats && income.received ? ' · já recebida: a edição vale só para este mês' : ''}
        </p>
      )}

      {canAskScope && canWrite && (
        <fieldset className="flex flex-col gap-1 rounded-md border border-line p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-ink/80">Aplicar a</legend>
          <ScopeOption checked={scope === 'this'} onChange={() => setScope('this')} label="Só este mês" hint="Os outros meses não mudam." />
          <ScopeOption
            checked={scope === 'following'}
            onChange={chooseFollowing}
            label="Este e os seguintes"
            hint="Vale para os próximos meses que ainda não foram recebidos. Ajustes feitos neles são sobrescritos."
          />
        </fieldset>
      )}

      {canWrite && (
        <div className="flex flex-col gap-1.5">
          <Button type="submit" disabled={busy || !valid}>
            {busy ? 'Salvando…' : editing ? 'Salvar alterações' : 'Adicionar receita'}
          </Button>
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

function ScopeOption({ checked, onChange, label, hint }: { checked: boolean; onChange: () => void; label: string; hint: ReactNode }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1 text-sm">
      <input type="radio" name="escopo" checked={checked} onChange={onChange} className="mt-1 size-4 accent-structure" />
      <span>
        <span className="font-medium">{label}</span>
        <span className="block text-xs text-ink/75">{hint}</span>
      </span>
    </label>
  )
}
