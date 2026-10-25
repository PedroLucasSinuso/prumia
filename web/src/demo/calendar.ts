// Datas da demonstração: dias úteis (fins de semana e feriados nacionais FIXOS; os móveis, como Carnaval e Corpus Christi,
// ficam de fora para simplificar) e as regras de data das receitas, como o servidor (internal/calendar).
import { addDays, addMonths, daysInMonth, weekdayIndex } from '../lib/dates'
import type { DateRule } from '../api/types'

const fixed = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25']

export function isBusinessDay(iso: string): boolean {
  const wd = weekdayIndex(iso)
  return wd !== 0 && wd !== 6 && !fixed.includes(iso.slice(5))
}

/** Datas de um mês (AAAA-MM-01) que são dias úteis. */
export function businessDays(month: string): string[] {
  const out: string[] = []
  for (let d = 1; d <= daysInMonth(month); d++) {
    const iso = `${month.slice(0, 8)}${String(d).padStart(2, '0')}`
    if (isBusinessDay(iso)) out.push(iso)
  }
  return out
}

function roll(iso: string, adjust: string | undefined): string {
  if (adjust === 'none') return iso
  let d = iso
  while (!isBusinessDay(d)) d = addDays(d, adjust === 'backward' ? -1 : 1)
  return d
}

/** Data esperada de uma regra na competência `month` (com monthOffset -1, a regra corre no mês anterior). */
export function expectedDate(rule: DateRule, month: string): string {
  const m = addMonths(month, rule.monthOffset ?? 0)
  if (rule.rule === 'last_business_day') {
    const days = businessDays(m)
    return days[days.length - 1]
  }
  if (rule.rule === 'nth_business_day') {
    const days = businessDays(m)
    return days[Math.min((rule.n ?? 1), days.length) - 1]
  }
  const day = Math.min(rule.n ?? 1, daysInMonth(m))
  return roll(`${m.slice(0, 8)}${String(day).padStart(2, '0')}`, rule.weekendAdjust)
}
