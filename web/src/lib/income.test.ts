import { describe, expect, it } from 'vitest'

import { income, members } from '../test/utils'
import { incomeSections, incomeTotals, monthSurplus, netOf, personTotals, ruleText, stateOf, stateText, sumDeductions, unitText, untilText } from './income'

const d = (amountCents: number) => ({ kind: 'inss' as const, name: 'INSS', amountCents })

describe('regras de receita', () => {
  it('líquido é bruto menos a soma dos descontos', () => {
    expect(netOf(500000, [d(55000), d(40000)])).toBe(405000)
    expect(sumDeductions([])).toBe(0)
    expect(netOf(100000, [])).toBe(100000)
  })
  it('totais: recebido = só o que conta como recebido, a receber = o resto', () => {
    const list = [income({ id: '1', description: 'a', netAmountCents: 400000, received: true }), income({ id: '2', description: 'b', netAmountCents: 60000 })]
    expect(incomeTotals(list)).toEqual({ expected: 460000, received: 400000, pending: 60000 })
  })
})

describe('estado derivado e textos', () => {
  it('"não caiu" vence o recebimento automático', () => {
    expect(stateOf({ received: true, held: false })).toBe('received')
    expect(stateOf({ received: false, held: false })).toBe('expected')
    expect(stateOf({ received: false, held: true })).toBe('held')
  })
  it('descreve o estado em palavras', () => {
    const base = { id: 'a', description: 'Salário', expectedDate: '2026-10-05' }
    expect(stateText(income({ ...base, received: true, receivedAt: '2026-10-05' }), '2026-10-20')).toBe('recebida em 05/10')
    expect(stateText(income({ ...base, expectedDate: '2026-10-28' }), '2026-10-20')).toBe('cai em 28/10')
    expect(stateText(income({ ...base, expectedDate: '2026-10-21' }), '2026-10-20')).toBe('cai amanhã')
    expect(stateText(income({ ...base, expectedDate: '2026-10-20' }), '2026-10-20')).toBe('cai hoje')
    expect(stateText(income({ ...base, held: true }), '2026-10-20')).toBe('não caiu · atrasada 15 dias')
    expect(stateText(income({ ...base, held: true, expectedDate: '2026-10-20' }), '2026-10-20')).toBe('não caiu')
  })
  it('regra de data em linguagem natural', () => {
    expect(ruleText({ rule: 'nth_business_day', n: 2 })).toBe('2º dia útil')
    expect(ruleText({ rule: 'last_business_day' })).toBe('último dia útil')
    expect(ruleText({ rule: 'day_of_month', n: 28, weekendAdjust: 'forward' })).toBe('dia 28, ou o próximo dia útil')
    expect(ruleText({ rule: 'day_of_month', n: 28, weekendAdjust: 'backward' })).toBe('dia 28, ou o dia útil anterior')
    expect(ruleText({ rule: 'day_of_month', n: 28, weekendAdjust: 'none' })).toBe('dia 28, mesmo em fim de semana ou feriado')
    expect(ruleText(null)).toBe('data escolhida')
  })
  it('valor por unidade e fim da repetição', () => {
    expect(unitText({ quantity: 21, unitPriceCents: 6500, unitLabel: 'dia trabalhado' })).toBe('21 × R$ 65,00 · dia trabalhado')
    expect(unitText({})).toBeUndefined()
    expect(untilText('2026-12-01')).toBe('até 12/2026')
    expect(untilText(null)).toBe('sem data para acabar')
  })
})

describe('totais por pessoa, seções e sobra', () => {
  const list = [
    income({ id: '1', description: 'Salário Pedro', userId: 'u1', netAmountCents: 400000, received: true, expectedDate: '2026-10-02' }),
    income({ id: '2', description: 'VR Pedro', userId: 'u1', netAmountCents: 60000, expectedDate: '2026-10-28' }),
    income({ id: '3', description: 'Salário Ana', userId: 'u2', netAmountCents: 300000, held: true, expectedDate: '2026-10-05' }),
  ]
  it('soma recebido e a receber de cada pessoa', () => {
    expect(personTotals(list, members)).toEqual([
      { userId: 'u1', name: 'Pedro', received: 400000, pending: 60000 },
      { userId: 'u2', name: 'Ana', received: 0, pending: 300000 },
    ])
  })
  it('separa em "A receber" (inclui as que não caíram) e "Recebidas"', () => {
    const s = incomeSections(list, 'state', members)
    expect(s.map((x) => [x.id, x.items.map((i) => i.id), x.totalCents])).toEqual([
      ['pending', ['2', '3'], 360000],
      ['received', ['1'], 400000],
    ])
  })
  it('agrupa por pessoa em ordem alfabética e some com seção vazia', () => {
    const s = incomeSections(list, 'person', members)
    expect(s.map((x) => [x.title, x.items.length])).toEqual([['Ana', 1], ['Pedro', 2]])
    expect(incomeSections([], 'state', members)).toEqual([])
  })
  it('sobra do mês = receitas líquidas − despesas (pagas + a pagar)', () => {
    const wallet = (expectedIncomeCents: number) => ({ expectedIncomeCents })
    expect(monthSurplus({ wallets: [wallet(700000), wallet(60000)], totalPaidCents: 250000, totalPendingCents: 300000 })).toEqual({
      income: 760000, expenses: 550000, surplus: 210000,
    })
    expect(monthSurplus({ wallets: [wallet(0), wallet(0)], totalPaidCents: 10000, totalPendingCents: 0 }).surplus).toBe(-10000)
  })
})
