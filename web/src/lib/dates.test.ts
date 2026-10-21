import { describe, expect, it } from 'vitest'

import { addMonths, currentMonth, dayMonth, monthFromParam, monthLabel, monthOf, monthToParam, todayISO } from './dates'

describe('datas de calendário', () => {
  it('todayISO usa o dia local (e não UTC)', () => {
    expect(todayISO(new Date(2026, 9, 18, 23, 59))).toBe('2026-10-18')
    expect(todayISO(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05')
  })
  it('monthOf e currentMonth', () => {
    expect(monthOf('2026-10-18')).toBe('2026-10-01')
    expect(currentMonth(new Date(2026, 11, 31))).toBe('2026-12-01')
  })
  it.each([
    ['2026-10-01', 1, '2026-11-01'],
    ['2026-12-01', 1, '2027-01-01'],
    ['2026-01-01', -1, '2025-12-01'],
    ['2026-10-01', 15, '2028-01-01'],
    ['2026-03-01', -14, '2025-01-01'],
  ])('addMonths(%s, %i) = %s', (m, n, want) => {
    expect(addMonths(m, n)).toBe(want)
  })
  it('rótulos em português', () => {
    expect(monthLabel('2026-10-01')).toBe('outubro de 2026')
    expect(monthLabel('2027-03-01')).toBe('março de 2027')
    expect(dayMonth('2026-10-20')).toBe('20/10')
  })
  it('mês na URL', () => {
    expect(monthFromParam('2026-10')).toBe('2026-10-01')
    expect(monthFromParam('2026-13')).toBeUndefined()
    expect(monthFromParam('abc')).toBeUndefined()
    expect(monthFromParam(null)).toBeUndefined()
    expect(monthToParam('2026-10-01')).toBe('2026-10')
  })
})
