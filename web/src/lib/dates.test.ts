import { describe, expect, it } from 'vitest'

import { addDays, addMonths, currentMonth, dayMonth, daysBetween, fullDate, monthFromParam, monthLabel, monthOf, monthToParam, todayISO, weekdayShort } from './dates'

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

describe('dias', () => {
  it('dia da semana', () => {
    expect(weekdayShort('2026-10-20')).toBe('ter')
    expect(weekdayShort('2026-10-18')).toBe('dom')
    expect(weekdayShort('2028-02-29')).toBe('ter')
  })
  it.each([
    ['2026-10-15', '2026-10-20', 5],
    ['2026-10-20', '2026-10-15', -5],
    ['2026-10-31', '2026-11-01', 1],
    ['2026-03-28', '2026-03-30', 2], // virada de horário de verão não pode contar um dia a mais
    ['2026-12-31', '2027-01-01', 1],
    ['2026-10-20', '2026-10-20', 0],
  ])('daysBetween(%s, %s) = %i', (a, b, n) => {
    expect(daysBetween(a, b)).toBe(n)
  })
  it.each([
    ['2026-10-31', 1, '2026-11-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2026-03-01', -1, '2026-02-28'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2026-10-20', 7, '2026-10-27'],
  ])('addDays(%s, %i) = %s', (iso, n, want) => {
    expect(addDays(iso, n)).toBe(want)
  })
  it('data completa', () => {
    expect(fullDate('2026-10-20')).toBe('20/10/2026')
  })
})
