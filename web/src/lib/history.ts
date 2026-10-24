import type { Category, CategoryHistory } from '../api/types'

/**
 * Funções puras dos gráficos do resumo. O servidor entrega o histórico por categoria FOLHA (uma série por categoria, um
 * ponto por mês); aqui montamos as barras: a categoria principal vira as filhas empilhadas, a casa inteira vira a soma.
 */

const shortMonths = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** "2026-10-01" -> "out/26" (rótulo do eixo). */
export function monthShort(month: string): string {
  return `${shortMonths[Number(month.slice(5, 7)) - 1] ?? '?'}/${month.slice(2, 4)}`
}

/** Uma fatia de uma barra: pago (sólido) e a pagar (tracejado) de uma categoria num mês. */
export type Part = { key: string; paidCents: number; pendingCents: number }
export type Bar = { month: string; parts: Part[]; totalCents: number; paidCents: number }
/** Classes literais (o Tailwind só gera classes que aparecem escritas no código): preenchimento e contorno da mesma cor. */
export type Tone = { fill: string; stroke: string }
export type Segment = { key: string; name: string; tone: Tone }
export type Stack = { segments: Segment[]; bars: Bar[] }

/**
 * Cores das fatias, só com os tokens da marca e opacidade, via `fill-*`/`stroke-*` (não `text-*`: no tema Grafite o
 * `text-accent` muda de cor em alguns temas para passar contraste de texto, e as fatias se confundiriam). Ordem FIXA: a fatia N tem sempre
 * a mesma cor, independente do valor. Alternam escuro/claro para separar vizinhas em qualquer tema. Acima de 4 filhas, o
 * resto é somado em "outras".
 */
export const TONES: readonly Tone[] = [
  { fill: 'fill-accent', stroke: 'stroke-accent' },
  { fill: 'fill-structure', stroke: 'stroke-structure' },
  { fill: 'fill-accent/45', stroke: 'stroke-accent/45' },
  { fill: 'fill-ink/45', stroke: 'stroke-ink/45' },
]
const OTHER_TONE: Tone = { fill: 'fill-ink/20', stroke: 'stroke-ink/30' }
const MAX_SEGMENTS = TONES.length

type Point = CategoryHistory['series'][number]['points'][number]

function emptyBars(months: string[]): Bar[] {
  return months.map((month) => ({ month, parts: [], totalCents: 0, paidCents: 0 }))
}

function addPoints(bars: Bar[], key: string, points: Point[]) {
  points.forEach((p, i) => {
    const bar = bars[i]
    if (!bar) return
    let part = bar.parts.find((x) => x.key === key)
    if (!part) {
      part = { key, paidCents: 0, pendingCents: 0 }
      bar.parts.push(part)
    }
    part.paidCents += p.paidCents
    part.pendingCents += p.totalCents - p.paidCents
    bar.totalCents += p.totalCents
    bar.paidCents += p.paidCents
  })
}

const sumOf = (points: Point[]) => points.reduce((s, p) => s + p.totalCents, 0)

/**
 * Barras de uma categoria. Principal com filhas: uma fatia por filha (a própria principal, se tiver contas diretas, vira
 * "Nome (geral)"); filha ou categoria simples: uma fatia só. Fatias na ordem do maior total do período.
 */
export function categoryStack(history: CategoryHistory, categories: Category[], categoryId: string): Stack {
  const bars = emptyBars(history.months)
  const byId = new Map(categories.map((c) => [c.id, c]))
  const self = byId.get(categoryId)
  const childIds = new Set(categories.filter((c) => c.parentId === categoryId).map((c) => c.id))
  const series = history.series.filter((s) => s.categoryId === categoryId || childIds.has(s.categoryId))
  if (childIds.size === 0) {
    const name = self?.name ?? 'Sem categoria'
    for (const s of series) addPoints(bars, categoryId, s.points)
    return { segments: [{ key: categoryId, name, tone: TONES[0]! }], bars }
  }
  const ranked = [...series].sort((a, b) => sumOf(b.points) - sumOf(a.points) || a.categoryId.localeCompare(b.categoryId))
  const shown = ranked.length > MAX_SEGMENTS ? ranked.slice(0, MAX_SEGMENTS - 1) : ranked
  const rest = ranked.slice(shown.length)
  const segments: Segment[] = shown.map((s, i) => ({
    key: s.categoryId,
    name: s.categoryId === categoryId ? `${self?.name ?? ''} (geral)` : (byId.get(s.categoryId)?.name ?? 'Sem categoria'),
    tone: TONES[i] ?? OTHER_TONE,
  }))
  for (const s of shown) addPoints(bars, s.categoryId, s.points)
  if (rest.length > 0) {
    segments.push({ key: 'outras', name: 'outras', tone: OTHER_TONE })
    for (const s of rest) addPoints(bars, 'outras', s.points)
  }
  return { segments, bars }
}

/** Gasto da casa por mês (todas as categorias somadas), uma fatia só. */
export function householdStack(history: CategoryHistory): Stack {
  const bars = emptyBars(history.months)
  for (const s of history.series) addPoints(bars, 'casa', s.points)
  return { segments: [{ key: 'casa', name: 'gasto da casa', tone: TONES[0]! }], bars }
}

/** Média por mês do período (arredondada para centavos inteiros). */
export function average(bars: Bar[]): number {
  return bars.length ? Math.round(bars.reduce((s, b) => s + b.totalCents, 0) / bars.length) : 0
}

/** Variação do último mês contra o anterior: diferença em centavos e percentual (null se o anterior foi zero). */
export function lastChange(bars: Bar[]): { diffCents: number; pct: number | null } | null {
  const last = bars.at(-1)
  const prev = bars.at(-2)
  if (!last || !prev) return null
  const diffCents = last.totalCents - prev.totalCents
  return { diffCents, pct: prev.totalCents > 0 ? Math.round((diffCents / prev.totalCents) * 100) : null }
}

/** Compromissos: soma por mês do que é parcela ou conta fixa (seriesCents), para "Compromissos futuros". */
export function commitments(history: CategoryHistory): { month: string; cents: number }[] {
  return history.months.map((month, i) => ({
    month,
    cents: history.series.reduce((s, x) => s + (x.points[i]?.seriesCents ?? 0), 0),
  }))
}

/** Teto "redondo" do eixo e as marcas (0, metade, teto). Ex.: 1.234,00 -> teto 1.500,00. */
export function niceMax(maxCents: number): number {
  if (maxCents <= 0) return 10000
  const mag = 10 ** Math.floor(Math.log10(maxCents))
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (step * mag >= maxCents) return step * mag
  }
  return 10 * mag
}

const compact = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 })

/** Valor curto do eixo: 150000 -> "R$ 1,5 mil". */
export function formatCompact(cents: number): string {
  return compact.format(cents / 100).replace(/\s/g, ' ')
}
