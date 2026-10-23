import type { RollupRow } from '../lib/categories'
import { formatCents } from '../lib/money'

/**
 * Lista "por categoria": uma barra por categoria principal (a soma das filhas incluída) e, embaixo, o detalhe das filhas em
 * texto pequeno. `split` mostra pago (teal) e a pagar (cobalt) na mesma barra; sem ele, uma barra só.
 */
export function CategoryBreakdown({ rows, split = false, gap = 'gap-3' }: { rows: RollupRow[]; split?: boolean; gap?: string }) {
  const max = rows[0]?.totalCents || 1
  return (
    <ul className={`flex flex-col ${gap}`}>
      {rows.map((r) => (
        <li key={r.id}>
          <p className="flex justify-between gap-3 text-[13px]">
            <span className="font-medium">{r.name}</span>
            <span className="font-mono tabular-nums">{formatCents(r.totalCents)}</span>
          </p>
          <span className="mt-1 flex h-2 rounded-xs bg-graphite/10" aria-hidden="true">
            {split ? (
              <>
                <span className="h-2 rounded-l-xs bg-teal" style={{ width: `${(r.paidCents / max) * 100}%` }} />
                <span className="h-2 bg-cobalt" style={{ width: `${((r.totalCents - r.paidCents) / max) * 100}%` }} />
              </>
            ) : (
              <span className="block h-2 rounded-xs bg-cobalt" style={{ width: `${Math.round((r.totalCents / max) * 100)}%` }} />
            )}
          </span>
          {r.children.length > 0 && (
            <ul aria-label={`Detalhe de ${r.name}`} className="mt-1 flex flex-col gap-0.5 border-l-2 border-graphite/15 pl-2.5">
              {r.children.map((c) => (
                <li key={c.id} className="flex justify-between gap-3 text-xs text-graphite/80">
                  <span>{c.name}</span>
                  <span className="font-mono tabular-nums">{formatCents(c.totalCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  )
}
