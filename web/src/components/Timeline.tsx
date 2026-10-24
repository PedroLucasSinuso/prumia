import type { Invoice } from '../api/types'
import { dayMonth, daysBetween, weekdayShort } from '../lib/dates'
import { formatCents } from '../lib/money'
import { useFlash, usePaidPulse } from '../lib/flash'
import { seriesTag } from '../lib/series'
import { useWalletName } from '../lib/useWalletName'
import { InvoiceRow } from './InvoiceRow'

type Props = {
  invoices: Invoice[]
  /** Categoria que a linha mostra (undefined = não repetir, ex.: "Luz / Luz"). `full` pede "Mãe › Filha" (computador). */
  categoryName: (invoice: Invoice, full?: boolean) => string | undefined
  /** Hoje ("AAAA-MM-DD") quando o mês exibido é o atual; undefined nos outros meses (sem separador de hoje). */
  today?: string
  /** Mostra o losango "hoje" (padrão: sim, quando há `today`). */
  marker?: boolean
  selectedId?: string
  canWrite: boolean
  busy: boolean
  onTogglePaid: (invoice: Invoice) => void
  onOpen: (invoice: Invoice) => void
  /** Computador: linhas em colunas, com seleção múltipla. */
  columns?: boolean
  checked?: Set<string>
  onCheck?: (invoice: Invoice, range: boolean) => void
}


/**
 * A linha de prumo do mês: uma linha vertical sustenta as contas, cada uma é um nó nela (e o nó é o botão de pagar).
 * Um losango marca "hoje": o que está acima dele e não foi pago é atraso. Contas pagas ficam, riscadas.
 * Celular: linhas grandes para o polegar. Computador (`columns`): linhas densas em colunas (`InvoiceRow`).
 */
export function Timeline({ invoices, categoryName, today, marker = true, selectedId, canWrite, busy, onTogglePaid, onOpen, columns, checked, onCheck }: Props) {
  // O separador "hoje" entra antes da primeira conta que vence hoje ou depois.
  const showToday = marker && today !== undefined
  const todayIndex = showToday ? invoices.findIndex((i) => i.dueDate >= today) : -1
  const items: Array<{ kind: 'today' } | { kind: 'invoice'; invoice: Invoice }> = []
  invoices.forEach((invoice, idx) => {
    if (idx === todayIndex) items.push({ kind: 'today' })
    items.push({ kind: 'invoice', invoice })
  })
  if (showToday && todayIndex === -1 && invoices.length > 0) items.push({ kind: 'today' }) // tudo vence antes de hoje

  // o prumo passa pelo centro dos nós. Celular: 12 + 40 + 22 = 74 px; computador: 8 + 28 + 52 + 22 = 110 px
  const line = columns ? 'left-[109px]' : 'left-[73px] md:left-[85px]'
  const todayGrid = columns ? 'grid-cols-[28px_52px_44px_1fr] pl-2' : 'grid-cols-[40px_44px_1fr] px-3 md:grid-cols-[56px_44px_1fr]'

  return (
    <ol className="relative">
      <span aria-hidden="true" className={`absolute bottom-0 top-0 w-0.5 bg-ink/20 ${line}`} />
      {items.map((item, idx) =>
        item.kind === 'today' ? (
          <li key={`hoje-${idx}`} className={`grid min-h-9 items-center ${todayGrid}`}>
            {columns && <span />}
            <span />
            <span className="flex justify-center">
              <span aria-hidden="true" className="size-3 rotate-45 bg-alert outline-[3px] outline-surface" />
            </span>
            <span className="flex items-center gap-2.5 pl-1.5">
              <span className="font-mono text-[11px] font-semibold tracking-widest">HOJE · {dayMonth(today!)}</span>
              <span aria-hidden="true" className="flex-1 border-t-2 border-alert" />
            </span>
          </li>
        ) : columns ? (
          <InvoiceRow
            key={item.invoice.id}
            invoice={item.invoice}
            category={categoryName(item.invoice, true)}
            today={today}
            open={item.invoice.id === selectedId}
            checked={checked?.has(item.invoice.id) ?? false}
            selecting={(checked?.size ?? 0) > 0}
            canWrite={canWrite}
            busy={busy}
            onTogglePaid={onTogglePaid}
            onOpen={onOpen}
            onCheck={onCheck ?? (() => {})}
          />
        ) : (
          <Row
            key={item.invoice.id}
            invoice={item.invoice}
            category={categoryName(item.invoice)}
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
  category?: string
  today?: string
  selected: boolean
  canWrite: boolean
  busy: boolean
  onTogglePaid: (i: Invoice) => void
  onOpen: (i: Invoice) => void
}) {
  const paid = invoice.status === 'paid'
  const overdue = invoice.status === 'overdue'
  const node = paid ? 'border-structure bg-structure' : overdue ? 'border-alert bg-alert' : 'border-ink bg-surface'
  const tag = seriesTag(invoice)
  const nameOf = useWalletName()
  const flashing = useFlash(invoice.id)
  const pulsing = usePaidPulse(invoice.id)
  // O risco é sempre `line-through`, transparente até a conta ser paga: a cor aparece com transição.
  const strike = `line-through transition-colors ${paid ? 'text-ink/60 decoration-ink/60' : 'decoration-transparent'}`
  const lateDays = overdue && today ? daysBetween(invoice.dueDate, today) : 0
  const meta = paid && invoice.paid
    ? `paga na carteira ${nameOf(invoice.paid.walletId)}`
    : overdue
      ? lateDays > 0 ? `atrasada ${lateDays} ${lateDays === 1 ? 'dia' : 'dias'}` : 'atrasada'
      : `vence dia ${invoice.dueDate.slice(8, 10)}`

  return (
    <li className={`grid min-h-16 grid-cols-[40px_44px_1fr] items-center border-l-4 px-3 transition-colors md:grid-cols-[56px_44px_1fr] ${flashing ? 'motion-safe:animate-flash' : ''} ${selected ? 'border-structure bg-structure/7' : 'border-transparent'}`}>
      <span className="flex flex-col items-end pr-2 leading-tight md:pr-2.5">
        <span className="font-mono text-[15px] font-semibold tabular-nums">{invoice.dueDate.slice(8, 10)}</span>
        <span className="text-[11px] text-ink/75">{weekdayShort(invoice.dueDate)}</span>
      </span>
      <button
        aria-label={paid ? `Desfazer pagamento de ${invoice.description}` : `Pagar ${invoice.description}`}
        disabled={!canWrite || busy}
        onClick={() => onTogglePaid(invoice)}
        className="group/node flex h-14 w-11 items-center justify-center disabled:cursor-default"
      >
        <span className={`flex size-5 items-center justify-center rounded-sm border-2 outline-4 outline-surface transition-colors motion-safe:group-active/node:scale-90 ${node} ${pulsing ? 'motion-safe:animate-fill' : ''}`}>
          {paid && <span className="size-2 rounded-[1px] bg-on-structure" />}
        </span>
      </button>
      <button aria-label={`Detalhes de ${invoice.description}`} onClick={() => onOpen(invoice)} className="flex min-h-14 min-w-0 items-center justify-between gap-3 py-2.5 pl-1.5 text-left">
        <span className="min-w-0">
          <span className={`block truncate text-[15px] font-medium ${strike}`}>{invoice.description}</span>
          <span className="mt-0.5 block truncate text-xs text-ink/80">
            {tag && <span className="mr-1 rounded-xs border border-ink/40 px-1 font-mono text-[10px] text-ink/80">{tag}</span>}
            {category ? `${category} · ` : ''}{meta}
          </span>
        </span>
        <span className={`shrink-0 font-mono text-[15px] font-semibold tabular-nums ${strike}`}>
          {formatCents(invoice.amountCents)}
        </span>
      </button>
    </li>
  )
}
