import type { Deduction, DeductionKind, Income, IncomeKind, Member } from '../api/types'
import { dayMonth, daysBetween } from './dates'
import { formatCents } from './money'

// Regras de receita espelhadas do backend, só para mostrar o líquido e os textos enquanto a pessoa digita.
// A fonte da verdade é a API (`netAmountCents`, `received`, `held`): o app NÃO calcula imposto nem dia útil.

export const kindLabel: Record<IncomeKind, string> = { salary: 'Salário', benefit: 'Benefício (VR)', other: 'Outra receita' }
/** Rótulo curto para colunas e botões. */
export const kindShort: Record<IncomeKind, string> = { salary: 'Salário', benefit: 'Benefício', other: 'Outra' }

export const deductionLabel: Record<DeductionKind, string> = {
  inss: 'INSS',
  irrf: 'IRRF',
  health_plan: 'Plano de saúde',
  health_copay: 'Coparticipação',
  other: 'Outro desconto',
}

export const deductionKinds = Object.keys(deductionLabel) as DeductionKind[]

export const sumDeductions = (ds: Deduction[]): number => ds.reduce((s, d) => s + d.amountCents, 0)

/** Líquido = bruto − soma dos descontos (nunca negativo na tela; o servidor recusa desconto maior que o bruto). */
export const netOf = (grossCents: number, ds: Deduction[]): number => grossCents - sumDeductions(ds)

/** A carteira vem do tipo: benefício (VR) cai na carteira de benefício; o resto, na livre. */
export const walletOfKind = (kind: IncomeKind) => (kind === 'benefit' ? 'benefit' : 'free')

// ------------------------------------------------------------------ estado (derivado no servidor)

/** `received`: a data chegou (recebimento automático) e ninguém disse "não caiu". `held`: "não caiu". Senão, `expected`. */
export type IncomeState = 'received' | 'expected' | 'held'

export const stateOf = (i: Pick<Income, 'received' | 'held'>): IncomeState => (i.held ? 'held' : i.received ? 'received' : 'expected')

/** Marcadores da marca: `[ ▪ ]` recebida, `[ ▫ ]` a receber, `[ ✖ ]` não caiu. */
export const stateMark: Record<IncomeState, string> = { received: '[ ▪ ]', expected: '[ ▫ ]', held: '[ ✖ ]' }
export const stateTone: Record<IncomeState, string> = { received: 'text-accent', expected: 'text-ink/80', held: 'text-alert' }

/** Texto curto do estado: "recebida em 05/10", "cai em 28/10", "não caiu · atrasada 3 dias". */
export function stateText(i: Income, today: string): string {
  const s = stateOf(i)
  if (s === 'received') return `recebida em ${dayMonth(i.receivedAt ?? i.expectedDate)}`
  if (s === 'held') {
    const late = daysBetween(i.expectedDate, today)
    return late > 0 ? `não caiu · atrasada ${late} ${late === 1 ? 'dia' : 'dias'}` : 'não caiu'
  }
  const d = daysBetween(today, i.expectedDate)
  return d === 0 ? 'cai hoje' : d === 1 ? 'cai amanhã' : `cai em ${dayMonth(i.expectedDate)}`
}

// ------------------------------------------------------------------ regras de data e valor em linguagem natural

type Rule = NonNullable<Income['dateRule']>

/** "2º dia útil", "último dia útil", "dia 28, ou o próximo dia útil". */
export function ruleText(rule: Rule | null | undefined): string {
  if (!rule) return 'data escolhida'
  if (rule.rule === 'nth_business_day') return `${rule.n ?? 1}º dia útil`
  if (rule.rule === 'last_business_day') return 'último dia útil'
  const base = `dia ${rule.n ?? 1}`
  if (rule.weekendAdjust === 'none') return `${base}, mesmo em fim de semana ou feriado`
  return rule.weekendAdjust === 'backward' ? `${base}, ou o dia útil anterior` : `${base}, ou o próximo dia útil`
}

/** "21 × R$ 65,00 · dia trabalhado" para receita por unidade; nada para valor cheio. */
export function unitText(i: Pick<Income, 'quantity' | 'unitPriceCents' | 'unitLabel'>): string | undefined {
  if (i.quantity == null || i.unitPriceCents == null) return undefined
  return `${i.quantity} × ${formatCents(i.unitPriceCents)}${i.unitLabel ? ` · ${i.unitLabel}` : ''}`
}

/** "até 12/2026" ou "sem fim" para a repetição. */
export function untilText(until: string | null | undefined): string {
  return until ? `até ${until.slice(5, 7)}/${until.slice(0, 4)}` : 'sem data para acabar'
}

// ------------------------------------------------------------------ totais e seções

/** Soma líquida de tudo (`total`), do que já conta como recebido e do que falta. */
export function incomeTotals(list: Income[]) {
  const expected = list.reduce((s, i) => s + i.netAmountCents, 0)
  const received = list.filter((i) => i.received).reduce((s, i) => s + i.netAmountCents, 0)
  return { expected, received, pending: expected - received }
}

export type PersonTotal = { userId: string; name: string; received: number; pending: number }

/** Recebido e a receber de cada pessoa que tem receita no mês (ordem: a de quem tem mais, depois por nome). */
export function personTotals(list: Income[], members: Member[]): PersonTotal[] {
  const by = new Map<string, PersonTotal>()
  for (const i of list) {
    const cur = by.get(i.userId) ?? { userId: i.userId, name: members.find((m) => m.userId === i.userId)?.name ?? 'Pessoa', received: 0, pending: 0 }
    if (i.received) cur.received += i.netAmountCents
    else cur.pending += i.netAmountCents
    by.set(i.userId, cur)
  }
  return [...by.values()].sort((a, b) => b.received + b.pending - (a.received + a.pending) || a.name.localeCompare(b.name, 'pt-BR'))
}

/** Sobra do mês: receitas líquidas do mês menos as despesas do mês (pagas + a pagar), com os números de /summary. */
export function monthSurplus(summary: { wallets: { free: { expectedIncomeCents: number }; benefit: { expectedIncomeCents: number } }; totalPaidCents: number; totalPendingCents: number }) {
  const income = summary.wallets.free.expectedIncomeCents + summary.wallets.benefit.expectedIncomeCents
  const expenses = summary.totalPaidCents + summary.totalPendingCents
  return { income, expenses, surplus: income - expenses }
}

export type SectionId = 'pending' | 'received' | `person:${string}`
export type IncomeSection = { id: SectionId; title: string; items: Income[]; totalCents: number }

export type GroupBy = 'state' | 'person'

/**
 * As seções da lista. Por situação (padrão): "A receber" (inclui as que não caíram) e "Recebidas". Por pessoa: uma seção
 * para cada pessoa. A lista já vem ordenada por data esperada. Seção vazia some.
 */
export function incomeSections(list: Income[], mode: GroupBy, members: Member[]): IncomeSection[] {
  const make = (id: SectionId, title: string, items: Income[]): IncomeSection => ({ id, title, items, totalCents: items.reduce((s, i) => s + i.netAmountCents, 0) })
  if (mode === 'person') {
    const ids = [...new Set(list.map((i) => i.userId))]
    return ids
      .map((id) => make(`person:${id}`, members.find((m) => m.userId === id)?.name ?? 'Pessoa', list.filter((i) => i.userId === id)))
      .sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'))
  }
  return [make('pending', 'A receber', list.filter((i) => !i.received)), make('received', 'Recebidas', list.filter((i) => i.received))].filter((s) => s.items.length > 0)
}
