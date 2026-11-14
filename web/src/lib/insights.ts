import type { Category, CategoryHistory } from '../api/types'

/**
 * "O que mudou neste mês": compara o mês do resumo com a MÉDIA dos meses anteriores do histórico e aponta as categorias que
 * mais fugiram do normal. Funções puras sobre o histórico que a API já entrega (um ponto por categoria e mês); nada é gravado.
 *
 * Regras (para o aviso ser útil e não barulho):
 * - a base são os meses anteriores que tiveram algum gasto (casa nova não se compara com meses vazios); com menos de
 *   MIN_BASE_MONTHS deles, não há comparação;
 * - subcategoria soma na principal (o histórico vem por categoria folha);
 * - uma categoria só é citada se a diferença for de pelo menos MIN_DIFF_CENTS e MIN_PCT % da média dela;
 * - categoria sem gasto na base e com gasto agora aparece como "novo" (pct null).
 */
export const MIN_BASE_MONTHS = 2
export const MIN_DIFF_CENTS = 5000
export const MIN_PCT = 20
/** Abaixo disto o mês é descrito como "na média". */
export const FLAT_PCT = 5

export type CategoryShift = {
  categoryId: string
  currentCents: number
  /** Média da categoria nos meses da base. */
  baseCents: number
  diffCents: number
  /** Variação em % contra a média; null quando a média é zero (gasto novo). */
  pct: number | null
}

export type MonthComparison = {
  month: string
  currentCents: number
  baseCents: number
  diffCents: number
  pct: number | null
  /** Quantos meses entraram na média. */
  basisMonths: number
  /** As que mais subiram (até 3) e as que mais caíram (até 2), da maior diferença para a menor. */
  up: CategoryShift[]
  down: CategoryShift[]
}

const pctOf = (diff: number, base: number) => (base > 0 ? Math.round((diff / base) * 100) : null)

/** O último mês de `history.months` é o mês comparado; os anteriores formam a base. */
export function compareMonth(history: CategoryHistory, categories: Category[]): MonthComparison | null {
  const last = history.months.length - 1
  if (last < 1) return null
  const parentOf = new Map(categories.map((c) => [c.id, c.parentId ?? c.id]))

  // Soma por categoria principal e por mês (índice do mês em history.months).
  const byCategory = new Map<string, number[]>()
  const house = history.months.map(() => 0)
  for (const s of history.series) {
    const id = parentOf.get(s.categoryId) ?? s.categoryId
    const row = byCategory.get(id) ?? history.months.map(() => 0)
    s.points.forEach((p, i) => {
      row[i] = (row[i] ?? 0) + p.totalCents
      house[i] = (house[i] ?? 0) + p.totalCents
    })
    byCategory.set(id, row)
  }

  const base = house.map((_, i) => i).filter((i) => i < last && (house[i] ?? 0) > 0)
  if (base.length < MIN_BASE_MONTHS) return null
  const mean = (row: number[]) => Math.round(base.reduce((sum, i) => sum + (row[i] ?? 0), 0) / base.length)

  const shifts: CategoryShift[] = []
  for (const [categoryId, row] of byCategory) {
    const currentCents = row[last] ?? 0
    const baseCents = mean(row)
    const diffCents = currentCents - baseCents
    const pct = pctOf(diffCents, baseCents)
    if (Math.abs(diffCents) < MIN_DIFF_CENTS || (pct !== null && Math.abs(pct) < MIN_PCT)) continue
    shifts.push({ categoryId, currentCents, baseCents, diffCents, pct })
  }
  const bySize = (a: CategoryShift, b: CategoryShift) => Math.abs(b.diffCents) - Math.abs(a.diffCents) || a.categoryId.localeCompare(b.categoryId)

  const currentCents = house[last] ?? 0
  const baseCents = mean(house)
  const diffCents = currentCents - baseCents
  return {
    month: history.months[last]!,
    currentCents,
    baseCents,
    diffCents,
    pct: pctOf(diffCents, baseCents),
    basisMonths: base.length,
    up: shifts.filter((s) => s.diffCents > 0).sort(bySize).slice(0, 3),
    down: shifts.filter((s) => s.diffCents < 0).sort(bySize).slice(0, 2),
  }
}

/** Frase principal: "12% acima da média", "8% abaixo da média" ou "na média". */
export function headline(c: Pick<MonthComparison, 'pct'>): string {
  if (c.pct === null || Math.abs(c.pct) < FLAT_PCT) return 'na média'
  return `${Math.abs(c.pct)}% ${c.pct > 0 ? 'acima' : 'abaixo'} da média`
}
