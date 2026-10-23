import { describe, expect, it } from 'vitest'

import type { Category, CategoryHistory } from '../api/types'
import { TONES, average, categoryStack, commitments, formatCompact, householdStack, lastChange, monthShort, niceMax } from './history'

const cat = (id: string, name: string, parentId?: string): Category => ({ id, name, parentId, isEssential: false, sortOrder: 0, archived: false })
const months = ['2026-09-01', '2026-10-01']
const series = (categoryId: string, a: number, b: number, paid = 0, s = 0) => ({
  categoryId,
  points: [
    { month: months[0]!, totalCents: a, paidCents: Math.min(a, paid), seriesCents: s },
    { month: months[1]!, totalCents: b, paidCents: Math.min(b, paid), seriesCents: s },
  ],
})

describe('histórico (gráficos do resumo)', () => {
  it('rótulo curto do mês', () => {
    expect(monthShort('2026-10-01')).toBe('out/26')
    expect(monthShort('2027-01-01')).toBe('jan/27')
  })

  it('principal empilha as filhas (maior primeiro), com a própria como "(geral)" e cor fixa por posição', () => {
    const cats = [cat('m', 'Moradia'), cat('g', 'Gás', 'm'), cat('l', 'Luz', 'm'), cat('x', 'Outra')]
    const h: CategoryHistory = { months, series: [series('l', 100, 100), series('g', 500, 500), series('m', 50, 0), series('x', 9999, 9999)] }
    const st = categoryStack(h, cats, 'm')
    expect(st.segments.map((s) => s.name)).toEqual(['Gás', 'Luz', 'Moradia (geral)'])
    expect(st.segments.map((s) => s.tone)).toEqual([TONES[0], TONES[1], TONES[2]])
    expect(st.bars.map((b) => b.totalCents)).toEqual([650, 600]) // a categoria de fora não entra
  })

  it('mais de 4 fatias: as menores viram "outras"', () => {
    const cats = [cat('m', 'M'), ...['a', 'b', 'c', 'd', 'e'].map((id) => cat(id, id.toUpperCase(), 'm'))]
    const h: CategoryHistory = { months, series: ['a', 'b', 'c', 'd', 'e'].map((id, i) => series(id, (5 - i) * 100, 0)) }
    const st = categoryStack(h, cats, 'm')
    expect(st.segments.map((s) => s.name)).toEqual(['A', 'B', 'C', 'outras'])
    expect(st.bars[0]!.parts.find((p) => p.key === 'outras')).toEqual({ key: 'outras', paidCents: 0, pendingCents: 300 })
  })

  it('filha e categoria simples: uma fatia, separando pago e a pagar', () => {
    const cats = [cat('m', 'Moradia'), cat('g', 'Gás', 'm')]
    const st = categoryStack({ months, series: [series('g', 1000, 800, 600)] }, cats, 'g')
    expect(st.segments).toHaveLength(1)
    expect(st.bars[0]!.parts[0]).toEqual({ key: 'g', paidCents: 600, pendingCents: 400 })
  })

  it('casa soma tudo; média, variação e compromissos', () => {
    const h: CategoryHistory = { months, series: [series('a', 1000, 1500, 0, 300), series('b', 0, 500, 0, 200)] }
    const bars = householdStack(h).bars
    expect(bars.map((b) => b.totalCents)).toEqual([1000, 2000])
    expect(average(bars)).toBe(1500)
    expect(lastChange(bars)).toEqual({ diffCents: 1000, pct: 100 })
    expect(lastChange([{ month: 'x', parts: [], totalCents: 0, paidCents: 0 }, { month: 'y', parts: [], totalCents: 10, paidCents: 0 }])).toEqual({ diffCents: 10, pct: null })
    expect(commitments(h)).toEqual([{ month: months[0], cents: 500 }, { month: months[1], cents: 500 }])
  })

  it('eixo: teto redondo e valor curto', () => {
    expect(niceMax(123400)).toBe(150000)
    expect(niceMax(0)).toBe(10000)
    expect(formatCompact(150000)).toBe('R$ 1,5 mil')
  })
})
