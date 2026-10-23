import type { Category } from '../api/types'

/**
 * Categorias em dois níveis (mãe → filhas). O servidor guarda a conta na categoria mais específica; a soma da mãe é feita aqui,
 * na leitura. Tudo aqui é puro (sem rede), então é fácil de testar.
 */

const bySort = (a: Category, b: Category) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'pt-BR')

export type CategoryNode = { category: Category; children: Category[] }

/** Mães (topo) com suas filhas, cada grupo na ordem do usuário. Filha cuja mãe não está na lista vira de topo (defensivo). */
export function buildTree(categories: Category[]): CategoryNode[] {
  const ids = new Set(categories.map((c) => c.id))
  const kids = new Map<string, Category[]>()
  const tops: Category[] = []
  for (const c of categories) {
    if (c.parentId && ids.has(c.parentId)) kids.set(c.parentId, [...(kids.get(c.parentId) ?? []), c])
    else tops.push(c)
  }
  return tops.sort(bySort).map((category) => ({ category, children: (kids.get(category.id) ?? []).sort(bySort) }))
}

/** "Moradia › Gás" para filha; só o nome para as de topo. Usado onde a categoria aparece sozinha (ex.: sugestão do favorecido). */
export function categoryPath(c: Category | undefined, all: Category[]): string | undefined {
  if (!c) return undefined
  const parent = c.parentId ? all.find((x) => x.id === c.parentId) : undefined
  return parent ? `${parent.name} › ${c.name}` : c.name
}

export type RollupRow = {
  id: string
  name: string
  totalCents: number
  paidCents: number
  /** Detalhe da mãe: as filhas com valor e, se a própria mãe tem contas além das filhas, uma linha "(geral)". */
  children: { id: string; name: string; totalCents: number; paidCents: number }[]
}

/**
 * Soma por categoria com a mãe agregando as filhas. `rows` vem por categoria folha (como o servidor entrega).
 * Resultado: só mães/categorias com valor, da maior para a menor. Categoria desconhecida (ex.: excluída) vira "Sem categoria".
 */
export function rollup(rows: { categoryId: string; totalCents: number; paidCents: number }[], categories: Category[]): RollupRow[] {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const out = new Map<string, RollupRow>()
  const own = new Map<string, { totalCents: number; paidCents: number }>()
  for (const r of rows) {
    const cat = byId.get(r.categoryId)
    const topId = cat?.parentId && byId.has(cat.parentId) ? cat.parentId : r.categoryId
    const top = out.get(topId) ?? { id: topId, name: byId.get(topId)?.name ?? 'Sem categoria', totalCents: 0, paidCents: 0, children: [] }
    top.totalCents += r.totalCents
    top.paidCents += r.paidCents
    out.set(topId, top)
    if (topId === r.categoryId) own.set(topId, { totalCents: r.totalCents, paidCents: r.paidCents })
    else top.children.push({ id: r.categoryId, name: cat?.name ?? 'Sem categoria', totalCents: r.totalCents, paidCents: r.paidCents })
  }
  for (const top of out.values()) {
    const o = own.get(top.id)
    if (o && top.children.length > 0) top.children.push({ id: top.id, name: `${top.name} (geral)`, ...o })
    top.children.sort((a, b) => b.totalCents - a.totalCents)
  }
  return [...out.values()].sort((a, b) => b.totalCents - a.totalCents)
}
