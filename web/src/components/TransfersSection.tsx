import { Trash2 } from 'lucide-react'

import type { Transfer } from '../api/types'
import { dayMonth } from '../lib/dates'
import { formatCents } from '../lib/money'
import { ICON } from '../lib/navigation'

type Props = {
  transfers: Transfer[]
  /** Nome da carteira pelo id (inclui as arquivadas). */
  walletName: (id: string) => string
  canWrite: boolean
  onDelete: (t: Transfer) => void
}

/**
 * "Transferências do mês": data, De → Para, valor, observação e excluir (com Desfazer, no aviso que aparece depois).
 * Não há edição: para corrigir, exclui e cria outra.
 */
export function TransfersSection({ transfers, walletName, canWrite, onDelete }: Props) {
  return (
    <section aria-label="Transferências do mês" className="rounded-md border border-line p-4">
      <h2 className="text-xs font-medium uppercase tracking-wider text-ink/80">transferências do mês</h2>
      {transfers.length === 0 ? (
        <p className="mt-2 text-sm text-ink/75">Nenhuma transferência entre carteiras neste mês.</p>
      ) : (
        <ul className="mt-2 flex flex-col">
          {transfers.map((t) => {
            const route = `${walletName(t.fromWalletId)} → ${walletName(t.toWalletId)}`
            return (
              <li key={t.id} className="flex items-center gap-3 border-t border-line py-2 first:border-t-0 md:py-1.5">
                <span className="w-11 shrink-0 font-mono text-xs tabular-nums text-ink/75">{dayMonth(t.transferDate)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{route}</span>
                  {t.notes && <span className="block truncate text-xs text-ink/75">{t.notes}</span>}
                </span>
                <span className="shrink-0 font-mono text-[15px] font-semibold tabular-nums">{formatCents(t.amountCents)}</span>
                {canWrite && (
                  <button
                    aria-label={`Excluir transferência ${route}`}
                    onClick={() => onDelete(t)}
                    className="flex size-11 shrink-0 items-center justify-center rounded-md text-ink/70 hover:bg-ink/5 hover:text-ink md:size-8"
                  >
                    <Trash2 aria-hidden="true" size={ICON.size} strokeWidth={ICON.strokeWidth} />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
