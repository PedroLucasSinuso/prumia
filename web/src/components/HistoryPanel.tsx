import { useState } from 'react'

import { useCategoryHistory } from '../api/queries'
import type { Category } from '../api/types'
import { addMonths } from '../lib/dates'
import { average, categoryStack, householdStack, lastChange, monthShort } from '../lib/history'
import { formatCents } from '../lib/money'
import { BarChart } from './BarChart'

type Props = {
  houseId: string
  /** Último mês do gráfico (o mês do resumo). */
  month: string
  /** Categoria a mostrar; `null` = gasto da casa inteira. */
  categoryId: string | null
  categories: Category[]
  /** Esconde o título (quando o painel já tem um, como o Sheet do celular). */
  hideTitle?: boolean
}

/**
 * Histórico de uma categoria (ou da casa): barras por mês, 6 ou 12 meses, com média do período e variação contra o mês
 * anterior. Os 6 meses padrão usam a mesma consulta do gráfico "Gasto por mês" (o cache do React Query a reaproveita).
 */
export function HistoryPanel({ houseId, month, categoryId, categories, hideTitle = false }: Props) {
  const [span, setSpan] = useState<6 | 12>(6)
  const history = useCategoryHistory(houseId, addMonths(month, -(span - 1)), month)
  const name = categoryId ? (categories.find((c) => c.id === categoryId)?.name ?? 'Sem categoria') : 'Gasto por mês'
  const title = categoryId ? name : 'Gasto por mês'
  const h = history.data
  const stack = h ? (categoryId ? categoryStack(h, categories, categoryId) : householdStack(h)) : undefined
  const avg = stack ? average(stack.bars) : 0
  const change = stack ? lastChange(stack.bars) : null

  return (
    <section aria-label={categoryId ? `Histórico de ${name}` : 'Gasto por mês'} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!hideTitle && <h2 className="font-display text-lg font-semibold font-stretch-condensed text-structure">{title}</h2>}
        <div role="group" aria-label="Período" className="ml-auto flex rounded-sm border border-ink/15 text-xs">
          {([6, 12] as const).map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={span === n}
              onClick={() => setSpan(n)}
              className={`h-9 px-3 transition-colors duration-150 md:h-8 ${span === n ? 'bg-structure text-on-structure' : 'text-ink/80 hover:bg-ink/5'}`}
            >
              {n} meses
            </button>
          ))}
        </div>
      </div>

      {history.isPending && <p role="status" className="text-sm text-ink/70">carregando…</p>}
      {history.isError && (
        <p role="alert" className="text-sm">
          <span className="font-mono text-alert">[ ✖ ]</span> Não foi possível carregar o histórico.{' '}
          <button className="font-semibold underline" onClick={() => void history.refetch()}>
            Tentar de novo
          </button>
        </p>
      )}

      {stack && (
        <>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-ink/75">média por mês</dt>
              <dd className="font-mono text-base font-semibold tabular-nums">{formatCents(avg)}</dd>
            </div>
            {change && (
              <div>
                <dt className="text-xs text-ink/75">
                  {monthShort(month)} vs. {monthShort(addMonths(month, -1))}
                </dt>
                <dd className="font-mono text-base font-semibold tabular-nums">
                  {change.diffCents === 0 ? 'igual' : `${change.diffCents > 0 ? '+' : '−'}${formatCents(Math.abs(change.diffCents))}`}
                  {change.pct !== null && change.diffCents !== 0 && (
                    <span className="ml-1 text-xs font-normal text-ink/70">
                      ({change.pct > 0 ? '+' : '−'}
                      {Math.abs(change.pct)}%)
                    </span>
                  )}
                </dd>
              </div>
            )}
          </dl>
          <BarChart stack={stack} label={categoryId ? `Gasto com ${name} por mês` : 'Gasto da casa por mês'} />
        </>
      )}
    </section>
  )
}
