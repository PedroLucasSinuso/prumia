import type { Income, Member } from '../api/types'
import { dayMonth, weekdayShort } from '../lib/dates'
import { formatCents } from '../lib/money'
import { kindLabel, sumDeductions } from '../lib/income'

type Props = {
  incomes: Income[]
  members: Member[]
  selectedId?: string
  canWrite: boolean
  busy: boolean
  onToggleReceived: (income: Income) => void
  onOpen: (income: Income) => void
}

/**
 * As entradas do mês, na mesma linha de prumo das contas. O nó é cobalto (entrada, não saída): oco = previsto,
 * preenchido = recebido. Tocar no nó marca como recebido (e desfaz).
 */
export function IncomeList({ incomes, members, selectedId, canWrite, busy, onToggleReceived, onOpen }: Props) {
  const person = (id: string) => members.find((m) => m.userId === id)?.name ?? 'Pessoa'
  return (
    <ol className="relative">
      <span aria-hidden="true" className="absolute bottom-0 left-[73px] top-0 w-0.5 bg-graphite/20 md:left-[85px]" />
      {incomes.map((i) => {
        const discounts = sumDeductions(i.deductions)
        const meta = [
          person(i.userId),
          kindLabel[i.kind],
          discounts > 0 ? `bruto ${formatCents(i.grossAmountCents)} · descontos ${formatCents(discounts)}` : null,
          i.received ? 'recebida' : 'prevista',
        ].filter(Boolean).join(' · ')
        return (
          <li
            key={i.id}
            className={`grid min-h-15 grid-cols-[40px_44px_1fr] items-center border-l-4 px-3 md:grid-cols-[56px_44px_1fr] ${i.id === selectedId ? 'border-teal bg-teal/7' : 'border-transparent'}`}
          >
            <span className="flex flex-col items-end pr-2 leading-tight md:pr-2.5">
              <span className="font-mono text-[15px] font-semibold tabular-nums">{i.expectedDate.slice(8, 10)}</span>
              <span className="text-[11px] text-graphite/75">{weekdayShort(i.expectedDate)}</span>
            </span>
            <button
              aria-label={i.received ? `Desfazer recebimento de ${i.description}` : `Marcar ${i.description} como recebida`}
              disabled={!canWrite || busy}
              onClick={() => onToggleReceived(i)}
              className="flex h-14 w-11 items-center justify-center disabled:cursor-default"
            >
              <span className={`flex size-5 items-center justify-center rounded-sm border-2 border-cobalt outline-4 outline-ivory ${i.received ? 'bg-cobalt' : ''}`}>
                {i.received && <span className="size-2 rounded-[1px] bg-ivory" />}
              </span>
            </button>
            <button aria-label={`Detalhes de ${i.description}`} onClick={() => onOpen(i)} className="flex min-h-14 min-w-0 items-center justify-between gap-3 py-2 pl-1 text-left">
              <span className="min-w-0">
                <span className={`block truncate text-[15px] font-medium ${i.received ? '' : 'text-graphite/85'}`}>{i.description}</span>
                <span className="block truncate text-xs text-graphite/80">{meta} · dia {dayMonth(i.expectedDate)}</span>
              </span>
              <span className={`shrink-0 font-mono text-[15px] font-semibold tabular-nums ${i.received ? 'text-cobalt' : 'text-graphite/85'}`}>{formatCents(i.netAmountCents)}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
