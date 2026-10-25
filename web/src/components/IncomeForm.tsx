import { useEffect, useRef, useState, type FormEvent } from 'react'

import { ApiError } from '../api/errors'
import { estimateTax, useIncomeDatePreview, useWallets } from '../api/queries'
import type { AmountMode, DateRule, Deduction, Income, IncomeInput, IncomeKind, IncomePatch, Member, SeriesScope, WeekendAdjust } from '../api/types'
import { networkErrorMessage, problemFields, problemMessage } from '../auth/errors'
import { dayMonth, monthLabel, monthName, monthOf, todayISO, weekdayShort } from '../lib/dates'
import { deductionLabel, kindLabel, netOf, offsetOf, offsetSentence, PREVIEW_FETCH, sumDeductions, upcomingDates, type MonthOffset } from '../lib/income'
import { formatCents } from '../lib/money'
import { suggestWalletId } from '../lib/wallets'
import { Button } from './ui/Button'
import { DeductionsEditor } from './DeductionsEditor'
import { Field } from './Field'
import { Combobox } from './ui/Combobox'
import { DatePicker } from './ui/DatePicker'
import { MonthPicker } from './ui/MonthPicker'
import { PanelFooter } from './ui/Panel'
import { Segmented } from './ui/Segmented'
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
  /** "Hoje" (AAAA-MM-DD) para a prévia de datas; só os testes passam (relógio fixo). */
  today?: string
  onDone: () => void
  onCancel?: () => void
  onCreate: (body: IncomeInput) => Promise<unknown>
  onUpdate: (id: string, body: IncomePatch, scope: SeriesScope) => Promise<unknown>
}

type RuleChoice = 'date' | DateRule['rule']

const legend = 'mb-2 p-0 text-meta font-semibold uppercase tracking-wider text-muted'
const group = 'border-t border-line pt-4'
const inner = 'flex flex-col gap-3'

const adjustOptions: Array<{ value: WeekendAdjust; label: string }> = [
  { value: 'forward', label: 'Próximo dia útil' },
  { value: 'backward', label: 'Dia útil anterior' },
  { value: 'none', label: 'Manter a data' },
]

const sameDeductions = (a: Deduction[], b: Deduction[]) => JSON.stringify(a) === JSON.stringify(b)

/**
 * A receita, num formulário só: pessoa e tipo, valor (cheio ou por unidade), quando cai (dia do mês, N-ésimo dia útil ou
 * último dia útil, com a prévia das próximas datas), se repete todo mês e os descontos (opcionais). Não existe mais a
 * diferença entre "fonte" e "lançamento": numa receita que se repete, a edição pergunta se vale só para este mês ou
 * para este e os seguintes. O líquido aparece enquanto a pessoa digita; a fonte da verdade é o servidor.
 */
export function IncomeForm({ houseId, month, members, defaultUserId, income, startScope, canWrite, today = todayISO(), onDone, onCancel, onCreate, onUpdate }: Props) {
  const editing = income !== undefined
  const competence = income?.competenceMonth ?? month

  const [userId, setUserId] = useState(income?.userId ?? defaultUserId)
  const [kind, setKind] = useState<IncomeKind>(income?.kind ?? 'salary')
  const [description, setDescription] = useState(income?.description ?? '')
  // Carteira: nova receita já vem com a sugerida (Vale -> Benefício, senão a padrão) até a pessoa escolher outra.
  const walletList = useWallets(houseId).data
  const [walletId, setWalletId] = useState(income?.walletId ?? '')
  const walletTouched = useRef(false)
  const choices = (walletList ?? []).filter((w) => !w.archived || w.id === income?.walletId)
  useEffect(() => {
    if (editing || walletTouched.current || !walletList) return
    setWalletId(suggestWalletId(walletList, kind))
  }, [editing, walletList, kind])

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
  // Mês em que a regra cai: 0 = o da competência; -1 = o anterior (o vale de outubro cai em setembro). Vale novo já vem
  // em "mês anterior" (ver o tipo, abaixo) até a pessoa mexer no campo.
  const [offset, setOffset] = useState<MonthOffset>(offsetOf(income?.dateRule))
  const offsetTouched = useRef(false)

  const [repeats, setRepeats] = useState(!editing)
  const repeatsTouched = useRef(false)
  const [until, setUntil] = useState('')

  const [deductions, setDeductions] = useState<Deduction[]>(income?.deductions ?? [])
  const [dependents, setDependents] = useState('0')
  const [taxNote, setTaxNote] = useState<string>()
  const [taxBusy, setTaxBusy] = useState(false)
  const [notes, setNotes] = useState(income?.notes ?? '')
  const [competenceInput, setCompetenceInput] = useState(competence.slice(0, 7))

  // Receita que se repete: mudar vale para este e os seguintes por padrão (o mês já recebido não muda em lote).
  const canAskScope = editing && income.repeats
  const [scope, setScope] = useState<SeriesScope>(canAskScope ? (startScope ?? 'following') : 'this')
  const [scopeNote, setScopeNote] = useState<string>()
  const following = scope === 'following'
  // Campos que só existem em UM mês (competência, data específica, quantidade): ao mexer neles, o escopo volta sozinho para
  // "Só este mês" e a tela explica (em lote o servidor recusaria com 400).
  const forceThis = (what: string) => {
    if (!canAskScope || scope === 'this') return
    setScope('this')
    setScopeNote(`Você mudou ${what}, que vale só para um mês: o escopo voltou para "Só este mês".`)
  }
  // Voltar para "este e os seguintes" descarta o que era de um mês só.
  const chooseFollowing = () => {
    setScope('following')
    setScopeNote(undefined)
    if (rule === 'date') setRule(income?.dateRule?.rule ?? 'day_of_month')
    setQuantity(income?.quantity != null ? String(income.quantity) : '')
    setCompetenceInput(competence.slice(0, 7))
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
    rule === 'date' || !nValid ? undefined : { rule, ...(rule === 'last_business_day' ? {} : { n: nNumber }), ...(rule === 'day_of_month' ? { weekendAdjust: adjust } : {}), ...(offset === -1 ? { monthOffset: -1 as const } : {}) }
  // A prévia também serve para sugerir a quantidade (dias úteis do mês): sem regra válida usa o último dia útil só para contar.
  const previewRule: DateRule = currentRule ?? { rule: 'last_business_day' }
  // Dias úteis do mês da receita (sugestão de quantidade).
  const monthInfo = useIncomeDatePreview(houseId, previewRule, competence, PREVIEW_FETCH)
  const businessDays = monthInfo.data?.[0]?.businessDays
  // A prévia "Próximas datas" parte de hoje (ou do mês escolhido, se for futuro): nunca abre com uma data que já passou.
  const previewFrom = competence > monthOf(today) ? competence : monthOf(today)
  const preview = useIncomeDatePreview(houseId, previewRule, previewFrom, PREVIEW_FETCH)
  const dates = preview.data ? upcomingDates(preview.data, today) : undefined

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
      const hadTax = deductions.some((d) => d.kind === 'inss' || d.kind === 'irrf')
      const keep = deductions.filter((d) => d.kind !== 'inss' && d.kind !== 'irrf')
      const suggested: Deduction[] = [
        ...(est.inssCents > 0 ? [{ kind: 'inss' as const, name: deductionLabel.inss, amountCents: est.inssCents }] : []),
        ...(est.irrfCents > 0 ? [{ kind: 'irrf' as const, name: deductionLabel.irrf, amountCents: est.irrfCents }] : []),
      ]
      setDeductions([...suggested, ...keep])
      clear('deductions')
      const other = est.tableYear !== Number(competence.slice(0, 4)) ? ` (tabela de ${est.tableYear}, a mais recente que temos)` : ''
      // Sempre diz o que foi preenchido; valor zero não vira desconto, então a nota explica o porquê (não parece falha).
      const inss = est.inssCents > 0 ? `INSS ${formatCents(est.inssCents)}` : 'INSS R$ 0,00 (sem contribuição calculada)'
      const irrf = est.irrfCents > 0 ? `IRRF ${formatCents(est.irrfCents)}` : `IRRF R$ 0,00 (isento nesta faixa${total <= 500000 ? ': até R$ 5.000 pela Lei 15.270/2025' : ', pela tabela'})`
      const replaced = hadTax ? ' Substituiu o INSS e o IRRF que estavam digitados; os outros descontos ficaram.' : ''
      setTaxNote(`${inss} · ${irrf}. Estimativa pela tabela de ${est.tableYear}${other}; confira no seu holerite.${replaced}`)
    } catch (e) {
      // Mostra a causa (rede ou status HTTP), não só "não foi possível".
      const cause =
        e instanceof ApiError
          ? e.network
            ? networkErrorMessage
            : `${e.problem?.detail || problemMessage(e.problem)} (erro ${e.problem?.status ?? '?'})`
          : 'erro inesperado'
      setTaxNote(`Não foi possível calcular agora: ${cause}. Digite os valores do holerite.`)
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
    if (walletId && walletId !== orig.walletId) patch.walletId = walletId
    if (description.trim() !== orig.description) patch.description = description.trim()
    if ((notes.trim() || null) !== (orig.notes ?? null)) patch.notes = notes.trim() === '' ? null : notes
    const amountChanged =
      mode !== orig.amountMode ||
      (mode === 'fixed' ? gross !== orig.grossAmountCents : price !== orig.unitPriceCents || unitLabel.trim() !== (orig.unitLabel ?? '') || (!following && qty !== orig.quantity))
    if (amountChanged) Object.assign(patch, amountFields())
    const o = orig.dateRule
    if (currentRule && (currentRule.rule !== o?.rule || (currentRule.n ?? null) !== (o?.n ?? null) || (currentRule.weekendAdjust ?? 'forward') !== (o?.weekendAdjust ?? 'forward') || offsetOf(currentRule) !== offsetOf(o))) {
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
          ...(walletId ? { walletId } : {}),
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
    <form onSubmit={onSubmit} className="flex min-h-full flex-col gap-4" noValidate>
      <FormError message={error} />

      {/* Quem e o quê */}
      <fieldset className={inner} disabled={dis}>
        <legend className={legend}>Quem e o quê</legend>
        <Combobox
          label="Pessoa" value={userId} onChange={(v) => { if (v) { setUserId(v); clear('userId') } }}
          options={members.map((m) => ({ value: m.userId, label: m.name }))} error={fields.userId}
        />
        <Segmented
          label="Tipo" value={kind}
          onChange={(k) => {
            setKind(k)
            // Vale novo cai no mês anterior (o VR do mês é pago no fim do anterior); mexer no campo antes impede a troca.
            if (!editing && !offsetTouched.current) setOffset(k === 'benefit' ? -1 : 0)
            // INSS e IRRF só valem para salário: ao trocar o tipo, saem da lista.
            if (k !== 'salary') setDeductions((ds) => ds.filter((d) => d.kind !== 'inss' && d.kind !== 'irrf'))
            if (!repeatsTouched.current && !editing) setRepeats(k !== 'other')
          }}
          options={[{ value: 'salary', label: 'Salário' }, { value: 'benefit', label: 'Vale (VR)' }, { value: 'other', label: 'Outra' }]}
        />
        <Combobox
          label="Carteira" value={walletId} onChange={(v) => { if (v) { walletTouched.current = true; setWalletId(v); clear('walletId') } }}
          options={choices.map((w) => ({ value: w.id, label: w.name }))} error={fields.walletId}
        />
        <Field label="Descrição" name="description" autoComplete="off" data-autofocus="" autoFocus={!editing} required value={description}
          placeholder={kind === 'benefit' ? 'Ex.: Vale-refeição' : 'Ex.: Salário'} onChange={(e) => { setDescription(e.target.value); clear('description') }} error={fields.description} />
      </fieldset>

      {/* Valor */}
      <div className={group}>
        <fieldset className={inner} disabled={dis}>
        <legend className={legend}>Valor</legend>
        <Segmented
          label="Como o valor é calculado" hideLabel value={mode} onChange={setMode}
          options={[{ value: 'fixed', label: 'Valor cheio' }, { value: 'per_unit', label: 'Por unidade' }]}
        />
        {mode === 'fixed' ? (
          <MoneyInput hero label="Valor bruto" value={gross} onChange={(c) => { setGross(c); clear('grossAmountCents') }} error={fields.grossAmountCents} />
        ) : (
          <>
            <MoneyInput hero label="Preço por unidade" value={price} onChange={(c) => { setPrice(c); clear('unitPriceCents') }} error={fields.unitPriceCents} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Unidade" name="unitLabel" autoComplete="off" value={unitLabel} placeholder="dia trabalhado, hora, plantão"
                onChange={(e) => { setUnitLabel(e.target.value); clear('unitLabel') }} error={fields.unitLabel} />
              <Field label="Quantidade" name="quantity" type="number" inputMode="numeric" min={1} max={999} value={quantity}
                hint={following ? 'Cada mês tem a sua quantidade; mudar aqui vale só para este mês.' : businessDays != null ? `Sugerida: ${businessDays} dias úteis em ${monthLabel(competence)}.` : undefined}
                onChange={(e) => { qtyTouched.current = true; setQuantity(e.target.value); clear('quantity'); if (e.target.value !== String(income?.quantity ?? '')) forceThis('a quantidade') }} error={fields.quantity} />
            </div>
            <p className="font-mono text-sm tabular-nums text-muted" aria-live="polite">
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
        <Segmented
          label="Regra da data" wrap value={rule}
          onChange={(r) => { setRule(r); clear('dateRule.rule'); clear('dateRule.n'); if (r === 'date') forceThis('uma data específica') }}
          options={[
            { value: 'day_of_month', label: 'Dia do mês' },
            { value: 'nth_business_day', label: 'N-ésimo dia útil' },
            { value: 'last_business_day', label: 'Último dia útil' },
            ...(!repeats || editing ? [{ value: 'date' as const, label: 'Data específica' }] : []),
          ]}
        />
        {(rule === 'day_of_month' || rule === 'nth_business_day') && (
          <Field
            label={rule === 'day_of_month' ? 'Dia' : 'Ordem do dia útil (1 = primeiro)'} name="ruleN" type="number" inputMode="numeric"
            min={1} max={rule === 'day_of_month' ? 31 : 23} value={ruleN} onChange={(e) => { setRuleN(e.target.value); clear('dateRule.n') }}
            hint={rule === 'nth_business_day' ? 'Sábado, domingo e feriados nacionais não contam como dia útil.' : 'Em mês curto, vale o último dia do mês.'}
            error={fields['dateRule.n']}
          />
        )}
        {rule === 'day_of_month' && (
          <Segmented label="Se cair em fim de semana ou feriado" wrap value={adjust} onChange={setAdjust} options={adjustOptions} />
        )}
        {rule !== 'date' && (
          <div className="flex flex-col gap-1.5">
            <Segmented
              label="Mês em que cai" wrap value={String(offset)}
              onChange={(v) => { offsetTouched.current = true; setOffset(v === '-1' ? -1 : 0); clear('dateRule.monthOffset') }}
              options={[{ value: '0', label: 'No mês da competência' }, { value: '-1', label: 'No mês anterior' }]}
            />
            <p className="text-meta text-muted" aria-live="polite">
              {offsetSentence(kind, competence, { rule, n: nValid ? nNumber : undefined }, offset)}
              {offset === -1 ? ' A quantidade e o resumo continuam sendo os de ' + monthName(competence) + '.' : ''}
            </p>
          </div>
        )}
        {rule === 'date' && (
          <DatePicker label="Data" name="expectedDate" required value={exact} onChange={(d) => { setExact(d); clear('expectedDate') }} error={fields.expectedDate} />
        )}
        {currentRule && dates && (
          <div className="rounded-md bg-sunken px-3 py-2 text-ui text-muted" aria-live="polite">
            <span className="text-meta font-medium uppercase tracking-wider text-muted">Próximas datas</span>
            <span className="mt-0.5 block font-mono tabular-nums">
              {dates.upcoming.map((d) => `${dayMonth(d)} (${weekdayShort(d)})`).join(' · ')}
            </span>
            {dates.passedThisMonth && (
              <span className="mt-1 block text-meta text-muted">
                {offset === -1 ? `Competência de ${monthName(monthOf(today))}` : 'Este mês'}: {dayMonth(dates.passedThisMonth)} ({weekdayShort(dates.passedThisMonth)}), já passou: conta como recebida.
              </span>
            )}
          </div>
        )}
        {editing && (
          <MonthPicker label="Mês de competência" value={competenceInput}
            hint="Mude só se a receita pertence a outro mês." onChange={(m) => { setCompetenceInput(m); clear('competenceMonth'); if (m !== competence.slice(0, 7)) forceThis('o mês de competência') }} error={fields.competenceMonth} />
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
            <MonthPicker label="Até (opcional)" clearable value={until} min={month.slice(0, 7)} hint="Sem data, repete até você encerrar."
              onChange={(m) => { setUntil(m); clear('endMonth') }} error={fields.endMonth} />
          )}
          </fieldset>
        </div>
      )}

      {/* Descontos */}
      <div className={group}>
        <DeductionsEditor salary={kind === 'salary'} value={deductions} onChange={(d) => { setDeductions(d); clear('deductions'); setTaxNote(undefined) }} errors={fields} disabled={dis} />
        {kind === 'salary' && canWrite && (
          <div className="flex flex-col gap-2 rounded-md bg-sunken p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-28">
                <Field label="Dependentes" type="number" inputMode="numeric" min={0} max={20} value={dependents} onChange={(e) => setDependents(e.target.value)} />
              </div>
              <Button type="button" variant="secondary" disabled={taxBusy || total <= 0} onClick={() => void suggestTax()}>
                {taxBusy ? 'Calculando…' : 'Sugerir INSS e IRRF'}
              </Button>
            </div>
            <p className="text-meta text-muted" aria-live="polite">
              {taxNote ?? 'Opcional. Preenche os descontos pela tabela do ano; você pode editar. Os descontos nunca são aplicados sozinhos.'}
            </p>
          </div>
        )}
      </div>

      <div className={`rounded-md bg-raised px-3 py-2.5 ${net < 0 ? 'border-l-2 border-alert' : ''}`}>
        <p className="text-meta font-medium uppercase tracking-wider text-muted">líquido{sumDeductions(deductions) > 0 ? ' (valor − descontos)' : ''}</p>
        <p className={`font-mono text-figure font-semibold tabular-nums ${net < 0 ? 'text-alert-text' : 'text-heading'}`}>{formatCents(net)}</p>
        {net < 0 && <p className="text-meta font-medium text-alert-text">Os descontos passam do valor.</p>}
      </div>

      <Field label="Observação" name="notes" autoComplete="off" value={notes} disabled={dis} onChange={(e) => setNotes(e.target.value)} error={fields.notes} />

      {editing && (
        <p className="text-meta text-muted">
          {kindLabel[income.kind]} de <strong>{personName(income.userId)}</strong>
          {income.repeats ? ' · repete todo mês' : ''}
          {income.received ? ' · já recebida' : ''}
        </p>
      )}

      {canAskScope && canWrite && (
        <div className="flex flex-col gap-1.5">
          <Segmented
            label="Aplicar a" wrap value={scope}
            onChange={(v) => (v === 'following' ? chooseFollowing() : setScope('this'))}
            options={[{ value: 'this', label: 'Só este mês' }, { value: 'following', label: 'Este e os seguintes' }]}
          />
          <p className="text-meta text-muted">
            {following
              ? income.received
                ? 'Este mês já foi recebido e não muda; os próximos sim.'
                : 'Vale para os próximos meses que ainda não foram recebidos. Ajustes feitos neles são sobrescritos.'
              : (scopeNote ?? 'Os outros meses não mudam.')}
          </p>
        </div>
      )}

      {canWrite && (
        <PanelFooter>
          <Button type="submit" loading={busy} disabled={!valid}>
            {editing ? 'Salvar alterações' : 'Adicionar receita'}
          </Button>
          {editing && onCancel && (
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancelar
            </Button>
          )}
        </PanelFooter>
      )}
    </form>
  )
}
