import type { Deduction, DeductionKind, Income, IncomeKind } from '../api/types'

// Regras de receita espelhadas do backend, só para mostrar o líquido enquanto a pessoa digita.
// A fonte da verdade é a API (`netAmountCents`): o app NÃO calcula imposto, só soma o que a pessoa informou.

export const kindLabel: Record<IncomeKind, string> = { salary: 'Salário', benefit: 'Benefício (VR)', other: 'Outra receita' }

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

/** Soma líquida das receitas (previstas + recebidas) e só das recebidas. */
export function incomeTotals(list: Income[]) {
  const expected = list.reduce((s, i) => s + i.netAmountCents, 0)
  const received = list.filter((i) => i.received).reduce((s, i) => s + i.netAmountCents, 0)
  return { expected, received, pending: expected - received }
}
