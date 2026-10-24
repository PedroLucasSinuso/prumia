import { describe, expect, it } from 'vitest'

import type { Category, Invoice } from '../api/types'
import { dueSoon, filterInvoices, normalize, repeatsCategory, sectionsOf } from './monthList'

const cat = (id: string, name: string, over: Partial<Category> = {}): Category => ({ id, name, isEssential: false, sortOrder: 0, archived: false, ...over })
const cats = [cat('m', 'Moradia'), cat('g', 'Gás', { parentId: 'm' }), cat('z', 'Lazer')]
const inv = (id: string, over: Partial<Invoice>): Invoice => ({
  id, description: id, categoryId: 'm', amountCents: 1000, dueDate: '2026-10-20', competenceMonth: '2026-10-01', status: 'pending', ...over,
})
const list = [
  inv('Aluguel', { status: 'overdue', dueDate: '2026-10-05' }),
  inv('Botijão', { categoryId: 'g', dueDate: '2026-10-22' }),
  inv('Cinema', { categoryId: 'z', status: 'paid', dueDate: '2026-10-10', paid: { paidAt: '2026-10-10', walletId: 'w1', amountCents: 900 } }),
  inv('Show', { categoryId: 'z', dueDate: '2026-10-30', notes: 'ingresso da Ana' }),
]

describe('lista do mês', () => {
  it('normaliza sem acento e sem caixa', () => {
    expect(normalize(' Água ')).toBe('agua')
  })

  it('filtra por situação', () => {
    expect(filterInvoices(list, { status: 'open' }, cats).map((i) => i.id)).toEqual(['Aluguel', 'Botijão', 'Show'])
    expect(filterInvoices(list, { status: 'paid' }, cats).map((i) => i.id)).toEqual(['Cinema'])
  })

  it('categoria mãe inclui as filhas; a filha só ela', () => {
    expect(filterInvoices(list, { status: 'all', categoryId: 'm' }, cats).map((i) => i.id)).toEqual(['Aluguel', 'Botijão'])
    expect(filterInvoices(list, { status: 'all', categoryId: 'g' }, cats).map((i) => i.id)).toEqual(['Botijão'])
  })

  it('busca na descrição, na categoria (e na mãe) e na observação', () => {
    expect(filterInvoices(list, { status: 'all', query: 'botijao' }, cats).map((i) => i.id)).toEqual(['Botijão'])
    expect(filterInvoices(list, { status: 'all', query: 'gás' }, cats).map((i) => i.id)).toEqual(['Botijão'])
    expect(filterInvoices(list, { status: 'all', query: 'moradia' }, cats).map((i) => i.id)).toEqual(['Aluguel', 'Botijão'])
    expect(filterInvoices(list, { status: 'all', query: 'ana' }, cats).map((i) => i.id)).toEqual(['Show'])
  })

  it('separa em atrasadas, daqui pra frente e pagas (somando o valor pago)', () => {
    const s = sectionsOf(list)
    expect(s.map((x) => [x.id, x.items.length, x.totalCents])).toEqual([['overdue', 1, 1000], ['upcoming', 2, 2000], ['paid', 1, 900]])
    expect(sectionsOf([list[1]]).map((x) => x.id)).toEqual(['upcoming'])
  })

  it('próximos 7 dias: atrasadas e o que vence até lá', () => {
    expect(dueSoon(list, '2026-10-20').map((i) => i.id)).toEqual(['Aluguel', 'Botijão'])
  })

  it('descrição igual à categoria não repete a categoria', () => {
    expect(repeatsCategory('luz', cat('l', 'Luz'))).toBe(true)
    expect(repeatsCategory('Conta de luz', cat('l', 'Luz'))).toBe(false)
  })
})
