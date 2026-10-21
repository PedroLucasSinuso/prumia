import type { Invoice } from '../api/types'

/** "3/6" nas parcelas, "fixa" nas contas de todo mês; nada nas avulsas. */
export function seriesTag(invoice: Invoice): string | undefined {
  const s = invoice.series
  if (!s) return undefined
  if (s.kind === 'recurrence') return 'fixa'
  return s.installmentNumber && s.installmentsCount ? `${s.installmentNumber}/${s.installmentsCount}` : undefined
}
