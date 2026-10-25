import { Trash2 } from 'lucide-react'

import type { WalletAdjustment } from '../api/types'
import { formatSignedCents } from '../lib/money'
import { ICON } from '../lib/navigation'

type Props = {
  adjustments: WalletAdjustment[]
  /** Nome da carteira pelo id (inclui as arquivadas). */
  walletName: (id: string) => string
  canWrite: boolean
  onDelete: (a: WalletAdjustment) => void
}

/**
 * "Ajustes de saldo do mês": cada conferência de saldo com a carteira, a diferença (com sinal) e a observação; excluir
 * tem Desfazer (no aviso). Só aparece quando há ajuste no mês: quem não usa "Conferir saldo" nunca vê o bloco.
 */
export function AdjustmentsSection({ adjustments, walletName, canWrite, onDelete }: Props) {
  if (adjustments.length === 0) return null
  return (
    <section aria-label="Ajustes de saldo do mês" className="rounded-md bg-raised p-4 md:p-5">
      <h2 className="text-meta font-medium uppercase tracking-wider text-muted">ajustes de saldo do mês</h2>
      <ul className="mt-2 flex flex-col">
        {adjustments.map((a) => (
          <li key={a.id} className="flex items-center gap-3 border-t border-line py-2 first:border-t-0 md:py-1.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-medium text-ink">{walletName(a.walletId)}</span>
              <span className="block truncate text-meta text-muted">{a.notes ?? 'saldo conferido'}</span>
            </span>
            <span className="shrink-0 font-mono text-body font-semibold tabular-nums text-ink">{formatSignedCents(a.amountCents)}</span>
            {canWrite && (
              <button
                aria-label={`Excluir ajuste de saldo de ${walletName(a.walletId)}`}
                onClick={() => onDelete(a)}
                className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted hover:bg-ink/6 hover:text-ink md:size-8"
              >
                <Trash2 aria-hidden="true" size={ICON.size} strokeWidth={ICON.strokeWidth} />
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-meta text-muted">Ajustes não são receita nem conta: só corrigem o saldo para bater com o real.</p>
    </section>
  )
}
