import { addMonths, currentMonth, monthLabel } from '../lib/dates'

type Props = { month: string; onChange: (month: string) => void }

/** Navegação entre meses: anterior, próximo e "hoje". O mês é sempre "AAAA-MM-01" (competência). */
export function MonthSelector({ month, onChange }: Props) {
  const isCurrent = month === currentMonth()
  const arrow = 'h-11 w-11 rounded-md border border-graphite/25 text-lg text-graphite hover:bg-graphite/5'
  return (
    <div className="flex items-center justify-between gap-2">
      <button aria-label="Mês anterior" className={arrow} onClick={() => onChange(addMonths(month, -1))}>
        ‹
      </button>
      <div className="flex flex-1 flex-col items-center">
        <h1 aria-live="polite" className="text-xl font-bold tracking-tight first-letter:uppercase">
          {monthLabel(month)}
        </h1>
        {!isCurrent && (
          <button className="text-xs font-semibold text-cobalt underline underline-offset-2" onClick={() => onChange(currentMonth())}>
            ir para o mês atual
          </button>
        )}
      </div>
      <button aria-label="Próximo mês" className={arrow} onClick={() => onChange(addMonths(month, 1))}>
        ›
      </button>
    </div>
  )
}
