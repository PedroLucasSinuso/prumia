import type { WalletBalance } from '../api/types'

// Taxas em "basis points" (centésimos de ponto percentual), como o backend: 1490 = 14,90%. Contas aqui são só para exibir
// uma comparação aproximada; nada disso é gravado nem soma dinheiro.

const pct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** 1490 -> "14,90%". */
export const formatBasisPoints = (bp: number) => `${pct.format(bp / 100)}%`

/** Taxa anual equivalente num mês (juros compostos): 1490 a.a. -> ~116 (1,16% a.m.). */
export const monthlyFromAnnual = (bp: number) => Math.round((Math.pow(1 + bp / 10000, 1 / 12) - 1) * 10000)

/**
 * Quanto o investimento rendeu no mês, em basis points: rendimento e atualizações ÷ o valor antes deles (o que veio dos meses
 * anteriores mais os aportes e menos os resgates). `undefined` sem atualização no mês ou sem valor de base.
 */
export function monthReturn(b: WalletBalance): number | undefined {
  const base = b.carryOverCents + b.transfersInCents - b.transfersOutCents
  if (b.adjustmentsCents === 0 || base <= 0) return undefined
  return Math.round((b.adjustmentsCents * 10000) / base)
}
