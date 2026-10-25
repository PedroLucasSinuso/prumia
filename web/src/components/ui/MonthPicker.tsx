import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

import { currentMonth, monthLabel } from '../../lib/dates'
import { trapTab } from './focus'
import { Popover } from './Popover'
import { buttonCls, controlCls, labelCls } from './styles'

type Props = {
  label: string
  hideLabel?: boolean
  /** "AAAA-MM" (competência) ou '' (vazio). */
  value: string
  onChange: (month: string) => void
  /** Limites inclusivos "AAAA-MM". */
  min?: string
  max?: string
  /** Mostra "Limpar" no calendário (campo opcional). */
  clearable?: boolean
  placeholder?: string
  error?: string
  hint?: string
  disabled?: boolean
  id?: string
  className?: string
}

const SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const ym = (year: number, month0: number) => `${year}-${String(month0 + 1).padStart(2, '0')}`
/** Soma meses a "AAAA-MM". */
function shift(month: string, n: number): string {
  const total = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n
  return ym(Math.floor(total / 12), total % 12)
}

/**
 * Escolha de mês (competência), valor `AAAA-MM`. Um gatilho mostra "outubro de 2026"; o popover traz o ano com setas
 * e os 12 meses numa grade 3×4.
 *
 * - Teclado: ←/→ mês, ↑/↓ três meses (uma linha), PageUp/PageDown ano, Home/End janeiro/dezembro, Enter escolhe,
 *   Esc fecha devolvendo o foco ao gatilho; Tab circula só no popover.
 * - `min`/`max` desabilitam meses; `clearable` permite voltar a "em branco" (competência opcional).
 *
 * Uso: `<MonthPicker label="Competência" value={competence} onChange={setCompetence} clearable hint="Em branco: mês do vencimento." />`.
 */
export function MonthPicker({ label, hideLabel, value, onChange, min, max, clearable, placeholder = 'Escolher mês', error, hint, disabled, id, className = '' }: Props) {
  const auto = useId()
  const btnId = id ?? auto
  const btn = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const close = (restore: boolean) => {
    setOpen(false)
    if (restore) btn.current?.focus()
  }
  const pick = (m: string) => {
    onChange(m)
    close(true)
  }
  const describedBy = [error ? `${btnId}-erro` : null, hint ? `${btnId}-dica` : null].filter(Boolean).join(' ')

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <span id={`${btnId}-rotulo`} className={hideLabel ? 'sr-only' : labelCls}>
        {label}
      </span>
      <button
        ref={btn}
        id={btnId}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={`${btnId}-rotulo ${btnId}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`${controlCls(Boolean(error))} flex items-center justify-between gap-2 text-left`}
      >
        <span className={value ? '' : 'text-muted'}>{value ? monthLabel(`${value}-01`) : placeholder}</span>
        <CalendarDays aria-hidden="true" size={18} strokeWidth={1.5} className="shrink-0 text-muted" />
      </button>
      <Popover open={open} anchorRef={btn} onClose={() => close(false)} role="dialog" aria-label="Escolher mês" trapEscape={false}>
        <Months value={value} min={min} max={max} clearable={clearable} onPick={pick} onEscape={() => close(true)} />
      </Popover>
      {hint && !error && (
        <p id={`${btnId}-dica`} className="text-meta text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${btnId}-erro`} className="text-meta font-medium text-alert-text">
          {error}
        </p>
      )}
    </div>
  )
}

function Months({ value, min, max, clearable, onPick, onEscape }: { value: string; min?: string; max?: string; clearable?: boolean; onPick: (m: string) => void; onEscape: () => void }) {
  const now = currentMonth().slice(0, 7)
  const clamp = (m: string) => (min && m < min ? min : max && m > max ? max : m)
  const [focus, setFocus] = useState(clamp(value || now))
  const root = useRef<HTMLDivElement>(null)
  const moveFocus = useRef(true)
  const year = Number(focus.slice(0, 4))
  const allowed = (m: string) => (!min || m >= min) && (!max || m <= max)

  useEffect(() => {
    if (!moveFocus.current) return
    moveFocus.current = false
    root.current?.querySelector<HTMLElement>(`[data-month="${focus}"]`)?.focus()
  }, [focus])

  const go = (m: string) => {
    moveFocus.current = true
    setFocus(clamp(m))
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      e.nativeEvent.stopImmediatePropagation()
      return onEscape()
    }
    if (trapTab(e, root.current)) return
    if (!(e.target as HTMLElement).hasAttribute('data-month')) return
    const keys: Record<string, string> = {
      ArrowLeft: shift(focus, -1), ArrowRight: shift(focus, 1), ArrowUp: shift(focus, -3), ArrowDown: shift(focus, 3),
      PageUp: shift(focus, -12), PageDown: shift(focus, 12), Home: ym(year, 0), End: ym(year, 11),
    }
    if (!(e.key in keys)) return
    e.preventDefault()
    go(keys[e.key])
  }

  const arrow = buttonCls({ variant: 'icon', size: 'sm' })
  return (
    <div ref={root} onKeyDown={onKeyDown} className="w-[min(18rem,calc(100vw-1rem))] p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <button type="button" aria-label="Ano anterior" disabled={Boolean(min && ym(year - 1, 11) < min)} onClick={() => setFocus(clamp(shift(focus, -12)))} className={arrow}>
          <ChevronLeft aria-hidden="true" size={18} strokeWidth={1.5} />
        </button>
        <div aria-live="polite" className="font-display text-title font-bold tabular-nums text-heading font-stretch-condensed">
          {year}
        </div>
        <button type="button" aria-label="Próximo ano" disabled={Boolean(max && ym(year + 1, 0) > max)} onClick={() => setFocus(clamp(shift(focus, 12)))} className={arrow}>
          <ChevronRight aria-hidden="true" size={18} strokeWidth={1.5} />
        </button>
      </div>
      <div role="group" aria-label={`Meses de ${year}`} className="grid grid-cols-3 gap-1">
        {SHORT.map((name, i) => {
          const m = ym(year, i)
          const on = m === value
          return (
            <button
              key={m}
              type="button"
              data-month={m}
              aria-label={monthLabel(`${m}-01`)}
              aria-pressed={on}
              aria-current={m === now ? 'date' : undefined}
              aria-disabled={!allowed(m) || undefined}
              tabIndex={m === focus ? 0 : -1}
              onClick={() => allowed(m) && onPick(m)}
              className={`flex min-h-11 items-center justify-center rounded-md border text-sm uppercase tracking-wider transition-colors md:min-h-9 ${
                on
                  ? 'border-structure bg-structure font-semibold text-on-structure'
                  : !allowed(m)
                    ? 'cursor-not-allowed border-transparent text-muted opacity-45'
                    : m === now
                      ? 'border-accent font-semibold hover:bg-ink/8 active:bg-ink/12'
                      : 'border-transparent hover:bg-ink/8 active:bg-ink/12'
              }`}
            >
              {name}
            </button>
          )
        })}
      </div>
      <div className="mt-2 flex gap-2 border-t border-line pt-2">
        <button
          type="button"
          disabled={!allowed(now)}
          onClick={() => onPick(now)}
          className={buttonCls({ variant: 'secondary', size: 'sm', className: 'flex-1' })}
        >
          Este mês
        </button>
        {clearable && (
          <button
            type="button"
            onClick={() => onPick('')}
            className={buttonCls({ variant: 'secondary', size: 'sm', className: 'flex-1' })}
          >
            Limpar
          </button>
        )}
      </div>
    </div>
  )
}
