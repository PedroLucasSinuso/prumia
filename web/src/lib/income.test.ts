import { describe, expect, it } from 'vitest'

import type { Income } from '../api/types'
import { incomeTotals, netOf, sumDeductions, walletOfKind } from './income'

const d = (amountCents: number) => ({ kind: 'inss' as const, name: 'INSS', amountCents })

describe('regras de receita', () => {
  it('líquido é bruto menos a soma dos descontos', () => {
    expect(netOf(500000, [d(55000), d(40000)])).toBe(405000)
    expect(sumDeductions([])).toBe(0)
    expect(netOf(100000, [])).toBe(100000)
  })
  it('a carteira vem do tipo', () => {
    expect(walletOfKind('benefit')).toBe('benefit')
    expect(walletOfKind('salary')).toBe('free')
    expect(walletOfKind('other')).toBe('free')
  })
  it('totais: previsto = tudo, recebido = só o que foi recebido', () => {
    const mk = (id: string, netAmountCents: number, received: boolean): Income => ({
      id, userId: 'u', kind: 'salary', description: 's', wallet: 'free', competenceMonth: '2026-10-01',
      expectedDate: '2026-10-05', grossAmountCents: 0, deductions: [], netAmountCents, received,
    })
    const list = [mk('1', 400000, true), mk('2', 60000, false)]
    expect(incomeTotals(list)).toEqual({ expected: 460000, received: 400000, pending: 60000 })
  })
})
