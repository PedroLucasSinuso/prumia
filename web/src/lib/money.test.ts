import { describe, expect, it } from 'vitest'

import { digitsToCents, formatCents } from './money'

describe('formatCents', () => {
  it.each([
    [0, 'R$ 0,00'],
    [5, 'R$ 0,05'],
    [66000, 'R$ 660,00'],
    [123456, 'R$ 1.234,56'],
    [100000000, 'R$ 1.000.000,00'],
    [-1000, '-R$ 10,00'],
  ])('%i centavos => %s', (cents, esperado) => {
    expect(formatCents(cents)).toBe(esperado)
  })
})

describe('digitsToCents', () => {
  it.each([
    ['', 0],
    ['abc', 0],
    ['1', 1],
    ['15', 15],
    ['R$ 1.500,00', 150000],
    ['R$ 15.000,001', 15000001],
    ['9999999999999999', 999999999999],
  ])('%j => %i', (text, cents) => {
    expect(digitsToCents(text)).toBe(cents)
  })
})
