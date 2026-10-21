import type { Invoice } from '../api/types'
import { dayMonth } from '../lib/dates'
import { formatCents } from '../lib/money'

type Props = {
  invoice: Invoice
  categoryName: string
  canWrite: boolean
  busy: boolean
  onTogglePaid: (invoice: Invoice) => void
  onOpen: (invoice: Invoice) => void
}

const walletLabel = { free: 'livre', benefit: 'benefício' } as const

/**
 * Uma conta na lista do mês. À esquerda, o marcador [ ▫ ] / [ ▪ ] é o botão de pagar (um toque; 44px de alvo).
 * Contas pagas continuam na lista, riscadas (mais visual e agradável de ver o mês andando).
 * Tocar no resto da linha abre os detalhes.
 */
export function InvoiceRow({ invoice, categoryName, canWrite, busy, onTogglePaid, onOpen }: Props) {
  const paid = invoice.status === 'paid'
  const overdue = invoice.status === 'overdue'
  return (
    <li className="flex items-stretch gap-1 border-b border-graphite/10 last:border-b-0">
      <button
        aria-label={paid ? `Desfazer pagamento de ${invoice.description}` : `Pagar ${invoice.description}`}
        disabled={!canWrite || busy}
        onClick={() => onTogglePaid(invoice)}
        className={`w-12 shrink-0 font-mono text-sm disabled:cursor-default ${paid ? 'text-cobalt' : 'text-graphite'}`}
      >
        {paid ? '[ ▪ ]' : '[ ▫ ]'}
      </button>
      <button
        aria-label={`Detalhes de ${invoice.description}`}
        onClick={() => onOpen(invoice)}
        className="flex min-h-14 flex-1 items-center justify-between gap-3 py-2 text-left"
      >
        <span className="min-w-0">
          <span className={`block truncate text-sm font-medium ${paid ? 'text-graphite/50 line-through' : ''}`}>{invoice.description}</span>
          <span className="block truncate text-xs text-graphite/60">
            {categoryName} ·{' '}
            <span className={overdue ? 'font-semibold text-signal' : ''}>
              {overdue ? 'venceu ' : paid && invoice.paid ? 'paga ' : 'vence '}
              {dayMonth(paid && invoice.paid ? invoice.paid.paidAt : invoice.dueDate)}
            </span>
            {paid && invoice.paid ? ` · ${walletLabel[invoice.paid.wallet]}` : ''}
          </span>
        </span>
        <span className={`shrink-0 font-mono text-sm tabular-nums ${paid ? 'text-graphite/50 line-through' : 'font-semibold'}`}>
          {formatCents(invoice.amountCents)}
        </span>
      </button>
    </li>
  )
}
