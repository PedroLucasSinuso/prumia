import type { ReactNode } from 'react'

import type { RollupRow } from '../lib/categories'
import { formatCents } from '../lib/money'

/**
 * Lista "por categoria": uma barra por categoria principal (a soma das filhas incluída) e, embaixo, o detalhe das filhas em
 * texto pequeno. `split` mostra pago (structure) e a pagar (accent) na mesma barra; sem ele, uma barra só.
 * `onSelect` torna cada categoria (e cada filha) clicável: o resumo abre o histórico dela. `selectedId` marca a escolhida.
 */
export function CategoryBreakdown({
  rows, split = false, gap = 'gap-3', onSelect, selectedId,
}: { rows: RollupRow[]; split?: boolean; gap?: string; onSelect?: (id: string) => void; selectedId?: string | null }) {
  const max = rows[0]?.totalCents || 1
  // Com onSelect, o conteúdo vira um botão (alvo grande, foco visível, hover sutil); sem ele, fica como era.
  const pick = (id: string, label: string, children: ReactNode, extra = '') =>
    onSelect ? (
      <button
        type="button"
        onClick={() => onSelect(id)}
        aria-pressed={selectedId === id}
        className={`-mx-1.5 block min-h-11 w-[calc(100%+0.75rem)] rounded-sm px-1.5 py-1 text-left md:min-h-0 transition-colors duration-150 hover:bg-ink/5 ${selectedId === id ? 'bg-accent/10' : ''} ${extra}`}
      >
        {children}
        <span className="sr-only">{`, ver histórico de ${label}`}</span>
      </button>
    ) : (
      children
    )
  return (
    <ul className={`flex flex-col ${gap}`}>
      {rows.map((r) => (
        <li key={r.id}>
          {pick(r.id, r.name, <>
          <span className="flex justify-between gap-3 text-ui">
            <span className="font-medium">{r.name}</span>
            <span className="font-mono tabular-nums">{formatCents(r.totalCents)}</span>
          </span>
          <span className="mt-1 flex h-2 rounded-xs bg-ink/10" aria-hidden="true">
            {split ? (
              <>
                <span className="h-2 rounded-l-xs bg-structure" style={{ width: `${(r.paidCents / max) * 100}%` }} />
                <span className="h-2 bg-accent" style={{ width: `${((r.totalCents - r.paidCents) / max) * 100}%` }} />
              </>
            ) : (
              <span className="block h-2 rounded-xs bg-accent" style={{ width: `${Math.round((r.totalCents / max) * 100)}%` }} />
            )}
          </span>
          </>)}
          {r.children.length > 0 && (
            <ul aria-label={`Detalhe de ${r.name}`} className="mt-1 flex flex-col gap-0.5 border-l-2 border-line pl-2.5">
              {r.children.map((c) => (
                <li key={c.id} className="text-meta text-muted">
                  {pick(c.id, c.name, <span className="flex justify-between gap-3">
                    <span>{c.name}</span>
                    <span className="font-mono tabular-nums">{formatCents(c.totalCents)}</span>
                  </span>, 'py-2 md:py-0.5')}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  )
}
