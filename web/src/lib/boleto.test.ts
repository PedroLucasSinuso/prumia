import { describe, expect, it } from 'vitest'

import { formatDigitableLine, onlyDigits } from './boleto'

describe('linha digitável', () => {
  it('agrupa o boleto bancário (47 dígitos)', () => {
    const line = '00190' + '00009' + '01234' + '567890' + '12345' + '678901' + '2' + '12340000010000'
    expect(formatDigitableLine(line)).toBe('00190.00009 01234.567890 12345.678901 2 12340000010000')
  })

  it('agrupa a conta de consumo (48 dígitos, começa com 8)', () => {
    const line = '836200000011' + '234500481002' + '012345678901' + '234567890123'
    expect(formatDigitableLine(line)).toBe('83620000001-1 23450048100-2 01234567890-1 23456789012-3')
  })

  it('ignora pontos e espaços que já vierem; copiar usa só dígitos', () => {
    expect(onlyDigits('00190.00009 01234')).toBe('001900000901234')
    expect(formatDigitableLine('1234567')).toBe('12345 67')
  })
})
