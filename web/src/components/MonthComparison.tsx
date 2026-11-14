import { useCategoryHistory } from '../api/queries'
import type { Category } from '../api/types'
import { addMonths, currentMonth, monthLabel } from '../lib/dates'
import { compareMonth, headline, type CategoryShift } from '../lib/insights'
import { formatCents } from '../lib/money'

type Props = {
  houseId: string
  month: string
  categories: Category[]
  /** Abre o histórico da categoria (o mesmo painel de "para onde vai o dinheiro"). */
  onSelect: (categoryId: string) => void
}

/** Quantos meses anteriores entram na média. */
const BASE_SPAN = 6

const monthName = (month: string) => {
  const name = monthLabel(month).split(' de ')[0] ?? ''
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/**
 * "O que mudou": o gasto do mês contra a média dos meses anteriores e as categorias que mais fugiram do normal
 * (lib/insights.ts). Some sozinho quando não há histórico suficiente para comparar: o resumo de uma casa nova não ganha um
 * bloco vazio. Cada categoria citada abre o histórico dela.
 */
export function MonthComparison({ houseId, month, categories, onSelect }: Props) {
  const history = useCategoryHistory(houseId, addMonths(month, -BASE_SPAN), month)
  const c = history.data ? compareMonth(history.data, categories) : null
  if (!c) return null

  const nameOf = (id: string) => categories.find((x) => x.id === id)?.name ?? 'Sem categoria'
  const open = month >= currentMonth() // o mês ainda não fechou: o total é o que já está lançado
  const item = (s: CategoryShift) => {
    const up = s.diffCents > 0
    return (
      <li key={s.categoryId}>
        <button
          type="button"
          onClick={() => onSelect(s.categoryId)}
          aria-label={`${nameOf(s.categoryId)}: ${formatCents(s.currentCents)}, ${up ? 'acima' : 'abaixo'} da média de ${formatCents(s.baseCents)}. Ver histórico`}
          className="flex w-full items-baseline justify-between gap-3 rounded-sm py-2 text-left transition-colors duration-150 hover:bg-ink/5"
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-ink">{nameOf(s.categoryId)}</span>
            <span className="block text-meta text-muted">
              {s.pct === null ? 'gasto novo' : `média ${formatCents(s.baseCents)}`}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className={`block font-mono text-sm font-semibold tabular-nums ${up ? 'text-alert-text' : 'text-ink'}`}>
              {up ? '+' : '−'}{formatCents(Math.abs(s.diffCents))}
            </span>
            {s.pct !== null && <span className="block font-mono text-meta tabular-nums text-muted">{up ? '+' : '−'}{Math.abs(s.pct)}%</span>}
          </span>
        </button>
      </li>
    )
  }

  return (
    <section aria-label="O que mudou neste mês" className="rounded-md bg-raised p-4 md:p-5">
      <h2 className="text-caption font-medium uppercase tracking-wider text-muted">o que mudou</h2>
      <p className="mt-1 font-display text-title font-semibold leading-tight text-heading font-stretch-condensed">
        {monthName(month)} está {headline(c)}
      </p>
      <p className="mt-1 text-sm text-muted">
        <span className="font-mono tabular-nums text-ink">{formatCents(c.currentCents)}</span> em contas, contra{' '}
        <span className="font-mono tabular-nums text-ink">{formatCents(c.baseCents)}</span> de média {c.basisMonths === 1 ? 'no mês anterior' : `nos ${c.basisMonths} meses anteriores`}.
        {open && ' O mês ainda não fechou: conta o que já está lançado.'}
      </p>
      {c.up.length + c.down.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Nenhuma categoria fugiu do normal.</p>
      ) : (
        <div className="mt-3 grid gap-x-8 gap-y-3 md:grid-cols-2">
          {c.up.length > 0 && (
            <div>
              <h3 className="text-meta font-medium text-muted">subiram</h3>
              <ul aria-label="Categorias que subiram" className="divide-y divide-line">{c.up.map(item)}</ul>
            </div>
          )}
          {c.down.length > 0 && (
            <div>
              <h3 className="text-meta font-medium text-muted">caíram</h3>
              <ul aria-label="Categorias que caíram" className="divide-y divide-line">{c.down.map(item)}</ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
