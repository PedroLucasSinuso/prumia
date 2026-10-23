import { describe, expect, it } from 'vitest'

import type { Category } from '../api/types'
import { buildTree, categoryPath, rollup } from './categories'

const cat = (id: string, name: string, over: Partial<Category> = {}): Category => ({ id, name, isEssential: false, sortOrder: 0, archived: false, ...over })
const moradia = cat('m', 'Moradia', { sortOrder: 0 })
const gas = cat('g', 'Gás', { parentId: 'm', sortOrder: 1 })
const luz = cat('l', 'Luz', { parentId: 'm', sortOrder: 0 })
const lazer = cat('z', 'Lazer', { sortOrder: 1 })
const all = [lazer, gas, moradia, luz]

describe('categorias em árvore', () => {
  it('agrupa filhas sob a mãe, cada grupo na ordem do usuário', () => {
    const tree = buildTree(all)
    expect(tree.map((n) => n.category.name)).toEqual(['Moradia', 'Lazer'])
    expect(tree[0].children.map((c) => c.name)).toEqual(['Luz', 'Gás'])
    expect(tree[1].children).toEqual([])
  })

  it('filha sem mãe na lista vira de topo', () => {
    expect(buildTree([gas]).map((n) => n.category.id)).toEqual(['g'])
  })

  it('caminho "Mãe › Filha"', () => {
    expect(categoryPath(gas, all)).toBe('Moradia › Gás')
    expect(categoryPath(lazer, all)).toBe('Lazer')
    expect(categoryPath(undefined, all)).toBeUndefined()
  })
})

describe('soma da mãe', () => {
  const rows = [
    { categoryId: 'g', totalCents: 15000, paidCents: 15000 },
    { categoryId: 'l', totalCents: 9000, paidCents: 0 },
    { categoryId: 'm', totalCents: 100000, paidCents: 100000 }, // aluguel direto na mãe
    { categoryId: 'z', totalCents: 5000, paidCents: 0 },
  ]

  it('mãe agrega as filhas e as contas dela mesma; maior primeiro', () => {
    const r = rollup(rows, all)
    expect(r.map((x) => [x.name, x.totalCents, x.paidCents])).toEqual([['Moradia', 124000, 115000], ['Lazer', 5000, 0]])
  })

  it('detalha as filhas e mostra "(geral)" quando a mãe tem contas próprias', () => {
    const [moradiaRow] = rollup(rows, all)
    expect(moradiaRow.children.map((c) => [c.name, c.totalCents])).toEqual([['Moradia (geral)', 100000], ['Gás', 15000], ['Luz', 9000]])
  })

  it('categoria sem filhas não tem detalhe, e a desconhecida vira "Sem categoria"', () => {
    const r = rollup([{ categoryId: 'z', totalCents: 1, paidCents: 0 }, { categoryId: 'x', totalCents: 2, paidCents: 0 }], all)
    expect(r.find((x) => x.id === 'z')?.children).toEqual([])
    expect(r.find((x) => x.id === 'x')?.name).toBe('Sem categoria')
  })
})
