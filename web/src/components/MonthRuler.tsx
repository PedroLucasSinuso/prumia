import type { Invoice } from '../api/types'
import { formatCents } from '../lib/money'

type Props = {
  invoices: Invoice[]
  /** Mês exibido ("AAAA-MM-01") e quantos dias ele tem. */
  month: string
  /** Dia de hoje neste mês (1-31), ou undefined se o mês exibido não é o atual. */
  todayDay?: number
  /** Altura das barras em px (celular menor, computador maior). */
  barArea?: number
  className?: string
}

const daysIn = (month: string) => new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()

/**
 * A régua do mês: uma barra por dia. Altura = valor das contas do dia; cor = estado
 * (teal = paga, cobalto = a vencer, coral = atrasada). O "prumo" (linha com losango) marca hoje.
 * Mostra de relance onde o peso das contas cai. Alt textual resume o dia mais pesado.
 */
export function MonthRuler({ invoices, month, todayDay, barArea = 56, className = '' }: Props) {
  const days = daysIn(month)
  const byDay = new Map<number, Invoice[]>()
  for (const inv of invoices) {
    // O dia vem do vencimento; contas de outro mês (competência diferente) não entram na régua deste mês.
    if (inv.dueDate.slice(0, 7) !== month.slice(0, 7)) continue
    const d = Number(inv.dueDate.slice(8, 10))
    byDay.set(d, [...(byDay.get(d) ?? []), inv])
  }
  const sums = [...byDay.entries()].map(([d, list]) => [d, list.reduce((s, i) => s + i.amountCents, 0)] as const)
  const max = Math.max(1, ...sums.map(([, v]) => v))
  const heaviest = sums.reduce<readonly [number, number] | undefined>((a, b) => (!a || b[1] > a[1] ? b : a), undefined)
  const label = heaviest
    ? `Régua do mês. O dia mais pesado é ${String(heaviest[0]).padStart(2, '0')}, com ${formatCents(heaviest[1])}.`
    : 'Régua do mês. Nenhuma conta com vencimento neste mês.'

  return (
    <div className={className}>
      <div role="img" aria-label={label} className="relative flex items-end gap-0.5 md:gap-1" style={{ height: barArea }}>
        {Array.from({ length: days }, (_, i) => {
          const day = i + 1
          const list = byDay.get(day)
          if (!list) return <span key={day} className="min-h-[3px] flex-1 bg-graphite/30" style={{ height: 3 }} />
          const sum = list.reduce((s, x) => s + x.amountCents, 0)
          const overdue = list.some((x) => x.status === 'overdue')
          const allPaid = list.every((x) => x.status === 'paid')
          const tone = overdue ? 'bg-signal' : allPaid ? 'bg-teal' : 'bg-cobalt'
          return <span key={day} className={`flex-1 rounded-t-xs ${tone}`} style={{ height: Math.max(10, Math.round((sum / max) * barArea)) }} />
        })}
        {todayDay !== undefined && (
          <span aria-hidden="true" className="pointer-events-none absolute -top-1.5 bottom-0 border-l-[1.5px] border-graphite" style={{ left: `${((todayDay - 0.5) / days) * 100}%` }}>
            <span className="absolute -left-[5px] -top-0.5 size-[9px] rotate-45 bg-graphite" />
          </span>
        )}
      </div>
      <div aria-hidden="true" className="mt-1 flex justify-between font-mono text-[11px] text-graphite/75">
        <span>01</span>
        <span>10</span>
        <span>20</span>
        <span>{String(days).padStart(2, '0')}</span>
      </div>
    </div>
  )
}
