import { addMonths, currentMonth, monthLabel } from '../lib/dates'
import { useIsDesktop } from '../lib/useIsDesktop'

type Props = { month: string; onChange: (month: string) => void }

const chevron = (d: string) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" aria-hidden="true">
    <path d={d} />
  </svg>
)

/**
 * Navegação entre meses. Celular: setas nas pontas e o mês no centro. Computador: o mês como título grande
 * à esquerda (Archivo condensada) e as setas juntas à direita. O mês é sempre "AAAA-MM-01" (competência).
 */
export function MonthSelector({ month, onChange }: Props) {
  const desktop = useIsDesktop()
  const isCurrent = month === currentMonth()
  const label = monthLabel(month) // "outubro de 2026"
  const [rawName, year] = label.split(' de ')
  const name = rawName.charAt(0).toUpperCase() + rawName.slice(1) // "outubro" -> "Outubro" (o título visível; o aria-label fica em minúsculas)
  const arrow = 'flex size-11 items-center justify-center rounded-md text-structure hover:bg-ink/5'
  const prev = (
    <button aria-label="Mês anterior" className={`${arrow} ${desktop ? 'border border-ink/30' : ''}`} onClick={() => onChange(addMonths(month, -1))}>
      {chevron('M15 5 L8 12 L15 19')}
    </button>
  )
  const next = (
    <button aria-label="Próximo mês" className={`${arrow} ${desktop ? 'border border-ink/30' : ''}`} onClick={() => onChange(addMonths(month, 1))}>
      {chevron('M9 5 L16 12 L9 19')}
    </button>
  )
  const title = (
    <div className={desktop ? '' : 'flex flex-1 flex-col items-center'}>
      <h1 aria-live="polite" aria-label={label} className="font-display font-bold leading-none tracking-tight text-structure font-stretch-condensed text-[30px] md:text-6xl">
        {name} <span className="font-semibold text-accent">{year}</span>
      </h1>
      {!isCurrent && (
        <button className="mt-1 text-xs font-semibold text-accent underline underline-offset-2" onClick={() => onChange(currentMonth())}>
          ir para o mês atual
        </button>
      )}
    </div>
  )
  return desktop ? (
    <div className="flex items-end gap-6">
      {title}
      <div className="flex gap-2">
        {prev}
        {next}
      </div>
    </div>
  ) : (
    <div className="flex items-center justify-between gap-2">
      {prev}
      {title}
      {next}
    </div>
  )
}
