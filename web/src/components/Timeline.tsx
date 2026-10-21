import type { Invoice } from '../api/types'
import { dayMonth, daysBetween, weekdayShort } from '../lib/dates'
import { formatCents } from '../lib/money'
import { seriesTag } from '../lib/series'

type Props = {
  invoices: Invoice[]
  categoryName: (id: string) => string
  /** Hoje ("AAAA-MM-DD") quando o mês exibido é o atual; undefined nos outros meses (sem separador de hoje). */
  today?: string
  selectedId?: string
  canWrite: boolean
  busy: boolean
  onTogglePaid: (invoice: Invoice) => void
  onOpen: (invoice: Invoice) => void
}

const walletLabel = { free: 'livre', benefit: 'benefício' } as const

/**
 * A linha de prumo do mês: uma linha vertical sustenta as contas, cada uma é um nó nela (e o nó é o botão de pagar).
 * Um losango marca "hoje": o que está acima dele e não foi pago é atraso. Contas pagas ficam, riscadas.
 */
export function Timeline({ invoices, categoryName, today, selectedId, canWrite, busy, onTogglePaid, onOpen }: Props) {
  // O separador "hoje" entra antes da primeira conta que vence hoje ou depois.
  const todayIndex = today ? invoices.findIndex((i) => i.dueDate >= today) : -1
  const items: Array<{ kind: 'today' } | { kind: 'invoice'; invoice: Invoice }> = []
  invoices.forEach((invoice, idx) => {
    if (idx === todayIndex) items.push({ kind: 'today' })
    items.push({ kind: 'invoice', invoice })
  })
  if (today && todayIndex === -1 && invoices.length > 0) items.push({ kind: 'today' }) // tudo vence antes de hoje

  return (
    <ol className="relative">
      {/* o prumo: a linha que passa pelo centro dos nós (12 + 40 + 22 = 74px) */}
      <span aria-hidden="true" className="absolute bottom-0 left-[73px] top-0 w-0.5 bg-graphite/20 md:left-[85px]" />
      {items.map((item, idx) =>
        item.kind === 'today' ? (
          <li key={`hoje-${idx}`} className="grid min-h-9 grid-cols-[40px_44px_1fr] items-center px-3 md:grid-cols-[56px_44px_1fr]">
            <span />
            <span className="flex justify-center">
              <span aria-hidden="true" className="size-3 rotate-45 bg-signal outline-[3px] outline-ivory" />
            </span>
            <span className="flex items-center gap-2.5 pl-1.5">
              <span className="font-mono text-[11px] font-semibold tracking-widest">HOJE · {dayMonth(today!)}</span>
              <span aria-hidden="true" className="flex-1 border-t-2 border-signal" />
            </span>
          </li>
        ) : (
          <Row
            key={item.invoice.id}
            invoice={item.invoice}
            category={categoryName(item.invoice.categoryId)}
            today={today}
            selected={item.invoice.id === selectedId}
            canWrite={canWrite}
            busy={busy}
            onTogglePaid={onTogglePaid}
            onOpen={onOpen}
          />
        ),
      )}
    </ol>
  )
}

function Row({ invoice, category, today, selected, canWrite, busy, onTogglePaid, onOpen }: {
  invoice: Invoice
  category: string
  today?: string
  selected: boolean
  canWrite: boolean
  busy: boolean
  onTogglePaid: (i: Invoice) => void
  onOpen: (i: Invoice) => void
}) {
  const paid = invoice.status === 'paid'
  const overdue = invoice.status === 'overdue'
  const node = paid ? 'border-teal bg-teal' : overdue ? 'border-signal bg-signal' : 'border-graphite'
  const tag = seriesTag(invoice)
  const lateDays = overdue && today ? daysBetween(invoice.dueDate, today) : 0
  const meta = paid && invoice.paid
    ? `paga na carteira ${walletLabel[invoice.paid.wallet]}`
    : overdue
      ? lateDays > 0 ? `atrasada ${lateDays} ${lateDays === 1 ? 'dia' : 'dias'}` : 'atrasada'
      : `vence dia ${invoice.dueDate.slice(8, 10)}`

  return (
    <li className={`grid min-h-15 grid-cols-[40px_44px_1fr] items-center border-l-4 px-3 md:grid-cols-[56px_44px_1fr] ${selected ? 'border-teal bg-teal/7' : 'border-transparent'}`}>
      <span className="flex flex-col items-end pr-2 leading-tight md:pr-2.5">
        <span className="font-mono text-[15px] font-semibold tabular-nums">{invoice.dueDate.slice(8, 10)}</span>
        <span className="text-[11px] text-graphite/75">{weekdayShort(invoice.dueDate)}</span>
      </span>
      <button
        aria-label={paid ? `Desfazer pagamento de ${invoice.description}` : `Pagar ${invoice.description}`}
        disabled={!canWrite || busy}
        onClick={() => onTogglePaid(invoice)}
        className="flex h-14 w-11 items-center justify-center disabled:cursor-default"
      >
        <span className={`flex size-5 items-center justify-center rounded-sm border-2 outline-4 outline-ivory ${node}`}>
          {paid && <span className="size-2 rounded-[1px] bg-ivory" />}
        </span>
      </button>
      <button aria-label={`Detalhes de ${invoice.description}`} onClick={() => onOpen(invoice)} className="flex min-h-14 min-w-0 items-center justify-between gap-3 py-2 pl-1 text-left">
        <span className="min-w-0">
          <span className={`block truncate text-[15px] font-medium ${paid ? 'text-graphite/60 line-through' : ''}`}>{invoice.description}</span>
          <span className="block truncate text-xs text-graphite/80">
            {tag && <span className="mr-1 rounded-xs border border-graphite/40 px-1 font-mono text-[10px] text-graphite/80">{tag}</span>}
            {category} · {meta}
          </span>
        </span>
        <span className={`shrink-0 font-mono text-[15px] font-semibold tabular-nums ${paid ? 'text-graphite/60 line-through' : ''}`}>
          {formatCents(invoice.amountCents)}
        </span>
      </button>
    </li>
  )
}
