import type { Category, Invoice, Payee } from '../api/types'
import { addDays } from './dates'

/**
 * Regras puras da lista do mês (filtro, busca, seções, próximos vencimentos). Sem rede e sem React: fáceis de testar.
 */

export type StatusFilter = 'all' | 'open' | 'paid'

/** Minúsculas e sem acento: "Água" casa com "agua". */
export const normalize = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()

export type ListFilter = { status: StatusFilter; categoryId?: string; query?: string }

/**
 * Aplica o filtro de situação, o de categoria (escolher uma mãe inclui todas as filhas) e a busca
 * (descrição, categoria, favorecido e observação).
 */
export function filterInvoices(list: Invoice[], f: ListFilter, categories: Category[], payees: Payee[] = []): Invoice[] {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const payeeName = new Map(payees.map((p) => [p.id, p.name]))
  const q = f.query ? normalize(f.query) : ''
  return list.filter((i) => {
    if (f.status === 'paid' && i.status !== 'paid') return false
    if (f.status === 'open' && i.status === 'paid') return false
    if (f.categoryId && i.categoryId !== f.categoryId && byId.get(i.categoryId)?.parentId !== f.categoryId) return false
    if (!q) return true
    const cat = byId.get(i.categoryId)
    const parent = cat?.parentId ? byId.get(cat.parentId) : undefined
    const haystack = [i.description, cat?.name, parent?.name, i.payeeId ? payeeName.get(i.payeeId) : undefined, i.notes ?? undefined]
    return haystack.some((h) => h && normalize(h).includes(q))
  })
}

export type SectionId = 'overdue' | 'upcoming' | 'paid'
export type Section = { id: SectionId; title: string; items: Invoice[]; totalCents: number }

const titles: Record<SectionId, string> = { overdue: 'Atrasadas', upcoming: 'Daqui pra frente', paid: 'Pagas' }

/** As três seções da lista do computador, na ordem em que aparecem. Seção vazia some. A lista já vem por data. */
export function sectionsOf(list: Invoice[]): Section[] {
  const pick = (id: SectionId): Section => {
    const items = list.filter((i) => (id === 'overdue' ? i.status === 'overdue' : id === 'paid' ? i.status === 'paid' : i.status === 'pending'))
    return { id, title: titles[id], items, totalCents: items.reduce((s, i) => s + (id === 'paid' ? (i.paid?.amountCents ?? i.amountCents) : i.amountCents), 0) }
  }
  return (['overdue', 'upcoming', 'paid'] as const).map(pick).filter((s) => s.items.length > 0)
}

/** Contas não pagas que vencem de hoje até `days` dias depois (inclui as atrasadas, que vêm primeiro). */
export function dueSoon(list: Invoice[], today: string, days = 7): Invoice[] {
  const limit = addDays(today, days)
  return list.filter((i) => i.status === 'overdue' || (i.status === 'pending' && i.dueDate >= today && i.dueDate <= limit))
}

/** "Luz / Luz": quando a descrição repete o nome da categoria, a categoria não aparece de novo na linha. */
export function repeatsCategory(description: string, category: Category | undefined): boolean {
  return category !== undefined && normalize(description) === normalize(category.name)
}
