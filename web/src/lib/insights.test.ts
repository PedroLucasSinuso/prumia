import type { Category, CategoryHistory } from '../api/types'
import { compareMonth, headline } from './insights'

const months = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01']
const cat = (id: string, name: string, parentId?: string): Category => ({ id, name, parentId, isEssential: false, sortOrder: 0, archived: false })
const cats = [cat('luz', 'Luz'), cat('mercado', 'Mercado'), cat('lazer', 'Lazer'), cat('casa', 'Moradia'), cat('agua', 'Água', 'casa')]

/** Série sintética: um total por mês (na ordem de `months`). */
function serie(categoryId: string, totals: number[]) {
  return { categoryId, points: totals.map((totalCents, i) => ({ month: months[i]!, totalCents, paidCents: 0, seriesCents: 0 })) }
}
const history = (...series: ReturnType<typeof serie>[]): CategoryHistory => ({ months, series })

describe('compareMonth', () => {
  it('compara o último mês com a média dos anteriores e aponta quem subiu e quem caiu', () => {
    const c = compareMonth(
      history(
        serie('luz', [20000, 20000, 20000, 20000, 28000]), // +40%
        serie('mercado', [100000, 100000, 100000, 100000, 101000]), // +1%: fica de fora
        serie('lazer', [30000, 30000, 30000, 30000, 12000]), // -60%
      ),
      cats,
    )!
    expect(c.month).toBe('2026-10-01')
    expect(c.basisMonths).toBe(4)
    expect(c.baseCents).toBe(150000)
    expect(c.currentCents).toBe(141000)
    expect(c.pct).toBe(-6)
    expect(c.up).toEqual([{ categoryId: 'luz', currentCents: 28000, baseCents: 20000, diffCents: 8000, pct: 40 }])
    expect(c.down).toEqual([{ categoryId: 'lazer', currentCents: 12000, baseCents: 30000, diffCents: -18000, pct: -60 }])
  })

  it('meses sem gasto nenhum não entram na média (casa nova)', () => {
    const c = compareMonth(history(serie('luz', [0, 0, 10000, 30000, 20000])), cats)!
    expect(c.basisMonths).toBe(2)
    expect(c.baseCents).toBe(20000)
    expect(headline(c)).toBe('na média')
  })

  it('sem pelo menos dois meses de base não há comparação', () => {
    expect(compareMonth(history(serie('luz', [0, 0, 0, 30000, 20000])), cats)).toBeNull()
    expect(compareMonth({ months: ['2026-10-01'], series: [] }, cats)).toBeNull()
  })

  it('subcategoria soma na principal', () => {
    const c = compareMonth(history(serie('casa', [50000, 50000, 50000, 50000, 50000]), serie('agua', [10000, 10000, 10000, 10000, 40000])), cats)!
    expect(c.up).toEqual([{ categoryId: 'casa', currentCents: 90000, baseCents: 60000, diffCents: 30000, pct: 50 }])
  })

  it('gasto novo (categoria sem histórico) aparece sem percentual', () => {
    const c = compareMonth(history(serie('mercado', [100000, 100000, 100000, 100000, 100000]), serie('lazer', [0, 0, 0, 0, 25000])), cats)!
    expect(c.up).toEqual([{ categoryId: 'lazer', currentCents: 25000, baseCents: 0, diffCents: 25000, pct: null }])
  })

  it('diferença pequena em reais não vira aviso, mesmo com percentual alto', () => {
    const c = compareMonth(history(serie('mercado', [100000, 100000, 100000, 100000, 100000]), serie('lazer', [1000, 1000, 1000, 1000, 4000])), cats)!
    expect(c.up).toEqual([])
  })

  it('no máximo 3 altas e 2 quedas, da maior diferença para a menor', () => {
    const up = ['a', 'b', 'c', 'd'].map((id, i) => serie(id, [10000, 10000, 10000, 10000, 20000 + i * 10000]))
    const down = ['x', 'y', 'z'].map((id, i) => serie(id, [90000, 90000, 90000, 90000, 60000 - i * 10000]))
    const c = compareMonth(history(...up, ...down), [])!
    expect(c.up.map((s) => s.categoryId)).toEqual(['d', 'c', 'b'])
    expect(c.down.map((s) => s.categoryId)).toEqual(['z', 'y'])
  })
})

describe('headline', () => {
  it('descreve acima, abaixo e na média', () => {
    expect(headline({ pct: 12 })).toBe('12% acima da média')
    expect(headline({ pct: -8 })).toBe('8% abaixo da média')
    expect(headline({ pct: 3 })).toBe('na média')
    expect(headline({ pct: null })).toBe('na média')
  })
})
