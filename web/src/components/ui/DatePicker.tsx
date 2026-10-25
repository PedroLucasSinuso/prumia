import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

import { addDays, addMonths, addMonthsClamped, clampISO, daysInMonth, fullDate, isValidISO, longDate, maskDate, monthLabel, monthOf, parseMasked, todayISO, weekdayIndex } from '../../lib/dates'
import { trapTab } from './focus'
import { Popover } from './Popover'
import { buttonCls, controlCls, labelCls } from './styles'

type Props = {
  label: string
  hideLabel?: boolean
  /** "AAAA-MM-DD" ou '' (vazio). Sempre string de calendário, sem fuso (mesmo formato do resto do app). */
  value: string
  onChange: (iso: string) => void
  /** Limites inclusivos "AAAA-MM-DD": dias fora ficam desabilitados e a digitação fora deles é recusada. */
  min?: string
  max?: string
  error?: string
  hint?: string
  disabled?: boolean
  required?: boolean
  id?: string
  name?: string
  className?: string
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const WEEK = [
  ['dom', 'domingo'], ['seg', 'segunda-feira'], ['ter', 'terça-feira'], ['qua', 'quarta-feira'],
  ['qui', 'quinta-feira'], ['sex', 'sexta-feira'], ['sáb', 'sábado'],
] as const

/**
 * Campo de data com calendário. Digite `dd/mm/aaaa` (a máscara põe as barras) OU abra o calendário no ícone.
 *
 * - Valor em `AAAA-MM-DD` (string, sem `Date`/fuso), como o resto do app; `''` = sem data.
 * - Calendário em pt-BR, semana começando no domingo, hoje com borda, escolhida preenchida; atalhos "Hoje" e "Amanhã".
 * - Teclado: ←/→ dia, ↑/↓ semana, PageUp/PageDown mês (Shift: ano), Home/End início/fim da semana, Enter escolhe,
 *   Esc fecha e devolve o foco a quem abriu. Tab circula só dentro do calendário (foco preso). ↓ no campo abre.
 * - `min`/`max` desabilitam dias; erro e dica como no `Field`.
 *
 * Uso: `<DatePicker label="Vencimento" value={due} onChange={setDue} min="2026-01-01" error={fields.dueDate} />`.
 */
export function DatePicker({ label, hideLabel, value, onChange, min, max, error, hint, disabled, required, id, name, className = '' }: Props) {
  const auto = useId()
  const inputId = id ?? auto
  const wrap = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(value ? fullDate(value) : '')
  const [seen, setSeen] = useState(value)
  const [local, setLocal] = useState<string>()

  // valor mudou por fora (ex.: o atalho "Amanhã" ou um boleto lido): o texto acompanha
  if (value !== seen) {
    setSeen(value)
    setText(value ? fullDate(value) : '')
    setLocal(undefined)
  }

  const inRange = (iso: string) => (!min || iso >= min) && (!max || iso <= max)

  function typed(raw: string) {
    const masked = maskDate(raw)
    setText(masked)
    setLocal(undefined)
    if (masked.length < 10) return
    const iso = parseMasked(masked)
    if (!iso) return setLocal('Essa data não existe.')
    if (!inRange(iso)) return setLocal(min && iso < min ? `Use uma data a partir de ${fullDate(min)}.` : `Use uma data até ${fullDate(max!)}.`)
    onChange(iso)
  }

  function openCalendar() {
    if (disabled) return
    opener.current = document.activeElement as HTMLElement | null
    setOpen(true)
  }
  function closeCalendar(restore: boolean) {
    setOpen(false)
    if (restore) opener.current?.focus()
  }
  function pick(iso: string) {
    onChange(iso)
    setText(fullDate(iso))
    setLocal(undefined)
    closeCalendar(true)
  }

  const shown = error ?? local
  const describedBy = [shown ? `${inputId}-erro` : null, hint ? `${inputId}-dica` : null].filter(Boolean).join(' ')

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={inputId} className={hideLabel ? 'sr-only' : labelCls}>
        {label}
      </label>
      <div ref={wrap} className="relative">
        <input
          id={inputId}
          name={name}
          inputMode="numeric"
          autoComplete="off"
          placeholder="dd/mm/aaaa"
          maxLength={10}
          value={text}
          disabled={disabled}
          required={required}
          aria-invalid={shown ? true : undefined}
          aria-describedby={describedBy || undefined}
          onChange={(e) => typed(e.target.value)}
          onBlur={() => {
            // texto incompleto ou inválido volta ao valor guardado
            if (!open && parseMasked(text) !== (value || undefined)) {
              setText(value ? fullDate(value) : '')
              setLocal(undefined)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              openCalendar()
            }
          }}
          className={`${controlCls(Boolean(shown))} pr-11 font-mono tabular-nums`}
        />
        <button
          type="button"
          aria-label="Abrir calendário"
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => (open ? closeCalendar(true) : openCalendar())}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 md:w-9"
        >
          <CalendarDays aria-hidden="true" size={18} strokeWidth={1.5} />
        </button>
      </div>
      <Popover open={open} anchorRef={wrap} onClose={() => closeCalendar(false)} role="dialog" aria-label="Escolher data" trapEscape={false}>
        <Calendar value={isValidISO(value) ? value : ''} min={min} max={max} onPick={pick} onEscape={() => closeCalendar(true)} />
      </Popover>
      {hint && !shown && (
        <p id={`${inputId}-dica`} className="text-meta text-muted">
          {hint}
        </p>
      )}
      {shown && (
        <p id={`${inputId}-erro`} className="text-meta font-medium text-alert-text">
          {shown}
        </p>
      )}
    </div>
  )
}

function Calendar({ value, min, max, onPick, onEscape }: { value: string; min?: string; max?: string; onPick: (iso: string) => void; onEscape: () => void }) {
  const today = todayISO()
  const start = clampISO(value || today, min, max)
  const [focus, setFocus] = useState(start)
  const [view, setView] = useState(monthOf(start))
  const root = useRef<HTMLDivElement>(null)
  const moveFocus = useRef(true) // foca o dia ao abrir e quando o teclado o move
  const allowed = (iso: string) => (!min || iso >= min) && (!max || iso <= max)

  useEffect(() => {
    if (!moveFocus.current) return
    moveFocus.current = false
    root.current?.querySelector<HTMLElement>(`[data-day="${focus}"]`)?.focus()
  }, [focus, view])

  function go(next: string) {
    const to = clampISO(next, min, max)
    moveFocus.current = true
    setFocus(to)
    setView(monthOf(to))
  }
  // setas do cabeçalho: mudam o mês mostrado; o foco do teclado continua nelas
  function shiftView(n: number) {
    const v = addMonths(view, n)
    setView(v)
    setFocus(clampISO(addMonthsClamped(focus, n), min, max))
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      e.nativeEvent.stopImmediatePropagation()
      return onEscape()
    }
    if (trapTab(e, root.current)) return
    // as teclas de navegação só valem com o foco num dia
    if (!(e.target as HTMLElement).hasAttribute('data-day')) return
    const keys: Record<string, () => string> = {
      ArrowLeft: () => addDays(focus, -1),
      ArrowRight: () => addDays(focus, 1),
      ArrowUp: () => addDays(focus, -7),
      ArrowDown: () => addDays(focus, 7),
      Home: () => addDays(focus, -weekdayIndex(focus)),
      End: () => addDays(focus, 6 - weekdayIndex(focus)),
      PageUp: () => addMonthsClamped(focus, e.shiftKey ? -12 : -1),
      PageDown: () => addMonthsClamped(focus, e.shiftKey ? 12 : 1),
    }
    const next = keys[e.key]
    if (!next) return
    e.preventDefault()
    go(next())
  }

  const blanks = weekdayIndex(view)
  const days = daysInMonth(view)
  const cells: Array<string | null> = [...Array<null>(blanks).fill(null), ...Array.from({ length: days }, (_, i) => `${view.slice(0, 8)}${String(i + 1).padStart(2, '0')}`)]
  while (cells.length % 7 !== 0) cells.push(null)
  const rows = Array.from({ length: cells.length / 7 }, (_, r) => cells.slice(r * 7, r * 7 + 7))
  const prevOk = !min || monthOf(addDays(view, -1)) >= monthOf(min)
  const nextOk = !max || addMonths(view, 1) <= monthOf(max)
  const tomorrow = addDays(today, 1)
  const arrow = buttonCls({ variant: 'icon', size: 'sm' })

  return (
    <div ref={root} onKeyDown={onKeyDown} className="w-[min(20rem,calc(100vw-1rem))] p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <button type="button" aria-label="Mês anterior" disabled={!prevOk} onClick={() => shiftView(-1)} className={arrow}>
          <ChevronLeft aria-hidden="true" size={18} strokeWidth={1.5} />
        </button>
        <div aria-live="polite" className="font-display text-title font-bold text-heading font-stretch-condensed">
          {cap(monthLabel(view))}
        </div>
        <button type="button" aria-label="Próximo mês" disabled={!nextOk} onClick={() => shiftView(1)} className={arrow}>
          <ChevronRight aria-hidden="true" size={18} strokeWidth={1.5} />
        </button>
      </div>
      <div role="grid" aria-label={monthLabel(view)}>
        <div role="row" className="grid grid-cols-7">
          {WEEK.map(([short, full]) => (
            <div key={short} role="columnheader" aria-label={full} className="flex h-7 items-center justify-center text-caption font-medium uppercase tracking-wider text-muted">
              {short}
            </div>
          ))}
        </div>
        {rows.map((row, r) => (
          <div key={r} role="row" className="grid grid-cols-7">
            {row.map((iso, c) =>
              iso === null ? (
                <div key={c} role="gridcell" />
              ) : (
                <div key={c} role="gridcell" aria-selected={iso === value} className="flex items-center justify-center">
                  <button
                    type="button"
                    data-day={iso}
                    aria-label={longDate(iso)}
                    aria-current={iso === today ? 'date' : undefined}
                    aria-disabled={!allowed(iso) || undefined}
                    tabIndex={iso === focus ? 0 : -1}
                    onClick={() => allowed(iso) && onPick(iso)}
                    className={`flex size-10 items-center justify-center rounded-md border font-mono text-sm tabular-nums transition-colors md:size-9 ${
                      iso === value
                        ? 'border-structure bg-structure font-semibold text-on-structure'
                        : !allowed(iso)
                          ? 'cursor-not-allowed border-transparent text-muted opacity-45'
                          : iso === today
                            ? 'border-accent font-semibold text-ink hover:bg-ink/8 active:bg-ink/12'
                            : 'border-transparent text-ink hover:bg-ink/8 active:bg-ink/12'
                    }`}
                  >
                    {Number(iso.slice(8))}
                  </button>
                </div>
              ),
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2 border-t border-line pt-2">
        {[['Hoje', today], ['Amanhã', tomorrow]].map(([text, iso]) => (
          <button
            key={text}
            type="button"
            disabled={!allowed(iso)}
            onClick={() => onPick(iso)}
            className={buttonCls({ variant: 'secondary', size: 'sm', className: 'flex-1' })}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}
