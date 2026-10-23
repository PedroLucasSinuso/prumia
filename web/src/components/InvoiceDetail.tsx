import { Pencil, Trash2, Undo2 } from 'lucide-react'

import type { Invoice, Purchase, SeriesScope, Wallet } from '../api/types'
import { daysBetween, fullDate, monthLabel, weekdayShort } from '../lib/dates'
import { formatCents } from '../lib/money'
import { BoletoBox } from './BoletoBox'
import { Button } from './Button'

type Props = {
  invoice: Invoice
  /** "Moradia › Luz" (com a mãe, se for subcategoria). */
  categoryLabel: string
  payeeName?: string
  /** A compra da parcela (total e quanto falta), quando já carregada. */
  purchase?: Purchase
  /** Hoje (AAAA-MM-DD): calcula "vence em 3 dias" / "atrasada há 2 dias". */
  today: string
  /** Carteira que o "Pagar" vai usar (a sugerida pela categoria). */
  payWallet: Wallet
  canWrite: boolean
  busy: boolean
  onPay: (invoice: Invoice) => void
  onUnpay: (invoice: Invoice) => void
  onEdit: () => void
  onDelete: (invoice: Invoice, scope: SeriesScope) => void
}

const walletName = { free: 'carteira livre', benefit: 'carteira de benefício' } as const
const label = 'text-[11px] font-medium uppercase tracking-wider text-ink/75'

function statusLine(inv: Invoice, today: string): { mark: string; tone: string; text: string } {
  if (inv.status === 'paid') return { mark: '[ ▪ ]', tone: 'text-accent', text: inv.paid ? `paga em ${fullDate(inv.paid.paidAt)}` : 'paga' }
  const d = daysBetween(today, inv.dueDate)
  if (inv.status === 'overdue') {
    const late = -d
    return { mark: '[ ✖ ]', tone: 'text-alert', text: late > 0 ? `atrasada há ${late} ${late === 1 ? 'dia' : 'dias'}` : 'atrasada' }
  }
  const when = d === 0 ? 'vence hoje' : d === 1 ? 'vence amanhã' : d > 1 ? `vence em ${d} dias` : 'a vencer'
  return { mark: '[ ▫ ]', tone: 'text-ink', text: `a vencer · ${when}` }
}

/** Texto da série: "Parcela 3 de 10" (+ total e quanto falta, se a compra já veio) ou "Fixa · todo dia 12". */
function seriesLines(inv: Invoice, purchase?: Purchase): string[] {
  const s = inv.series
  if (!s) return []
  if (s.kind === 'recurrence') return [`Conta fixa · todo dia ${inv.dueDate.slice(8, 10)}`]
  const lines = [s.installmentNumber && s.installmentsCount ? `Parcela ${s.installmentNumber} de ${s.installmentsCount}` : 'Parcela']
  if (purchase) {
    const open = purchase.installments.filter((i) => i.status !== 'paid')
    const left = open.reduce((sum, i) => sum + i.amountCents, 0)
    lines.push(`Compra de ${formatCents(purchase.totalAmountCents)}`)
    lines.push(open.length === 0 ? 'Todas as parcelas pagas' : `Faltam ${formatCents(left)} (${open.length} ${open.length === 1 ? 'parcela' : 'parcelas'})`)
  }
  return lines
}

/**
 * Detalhe da conta em modo LEITURA: o que a pessoa quer conferir (valor, situação, vencimento, série, pagamento, boleto)
 * e as ações (Pagar, Editar, Excluir, Desfazer pagamento). Editar troca este quadro pelo formulário, no mesmo lugar.
 */
export function InvoiceDetail({ invoice, categoryLabel, payeeName, purchase, today, payWallet, canWrite, busy, onPay, onUnpay, onEdit, onDelete }: Props) {
  const status = statusLine(invoice, today)
  const paid = invoice.status === 'paid'
  const inSeries = invoice.series != null
  const rows: Array<[string, string]> = [
    ['Vencimento', `${fullDate(invoice.dueDate)} · ${weekdayShort(invoice.dueDate)}`],
    ['Competência', monthLabel(invoice.competenceMonth)],
    ['Categoria', categoryLabel],
  ]
  if (payeeName) rows.push(['Favorecido', payeeName])
  const series = seriesLines(invoice, purchase)
  if (series.length) rows.push(['Série', series.join('\n')])
  if (invoice.notes) rows.push(['Observação', invoice.notes])

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className={label}>valor</p>
        <p className={`font-mono text-[40px] font-semibold leading-tight tracking-tight tabular-nums text-structure ${paid ? 'line-through decoration-2' : ''}`}>
          {formatCents(invoice.amountCents)}
        </p>
        <p className="mt-1 flex items-center gap-2 text-sm font-medium">
          <span aria-hidden="true" className={`font-mono ${status.tone}`}>{status.mark}</span>
          {status.text}
        </p>
      </div>

      <dl className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-x-4 gap-y-2.5 border-t border-line pt-4 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink/75">{k}</dt>
            <dd className="whitespace-pre-line break-words font-medium">{v}</dd>
          </div>
        ))}
      </dl>

      {paid && invoice.paid && (
        <section aria-label="Pagamento" className="rounded-md border border-line px-3 py-3 text-sm">
          <p className={`${label} mb-1.5`}>pagamento</p>
          <p>
            <span aria-hidden="true" className="font-mono text-accent">[ ▪ ]</span> Paga em {fullDate(invoice.paid.paidAt)} · {walletName[invoice.paid.wallet]}
          </p>
          <p className="mt-0.5 text-ink/80">
            Valor pago: <span className="font-mono font-semibold tabular-nums text-ink">{formatCents(invoice.paid.amountCents)}</span>
          </p>
        </section>
      )}

      {invoice.boleto && (
        <section aria-label="Boleto" className="rounded-md border border-line px-3 py-3">
          <BoletoBox boleto={invoice.boleto} />
        </section>
      )}

      {canWrite && (
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          {!paid && (
            <Button type="button" disabled={busy} onClick={() => onPay(invoice)} title="Atalho: P">
              Pagar · {walletName[payWallet]}
            </Button>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" onClick={onEdit} className="flex flex-1 items-center justify-center gap-2 md:h-9">
              <Pencil size={16} strokeWidth={1.5} aria-hidden="true" /> Editar
            </Button>
            {paid && (
              <Button type="button" variant="ghost" disabled={busy} onClick={() => onUnpay(invoice)} className="flex flex-1 items-center justify-center gap-2 md:h-9">
                <Undo2 size={16} strokeWidth={1.5} aria-hidden="true" /> Desfazer pagamento
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4">
            <button type="button" onClick={() => onDelete(invoice, 'this')} className="flex h-11 items-center gap-1.5 text-sm font-semibold underline underline-offset-4 md:h-9">
              <Trash2 size={15} strokeWidth={1.5} aria-hidden="true" />
              {inSeries ? 'Excluir só esta' : 'Excluir conta'}
            </button>
            {inSeries && (
              <button type="button" onClick={() => onDelete(invoice, 'following')} className="h-11 text-sm font-semibold underline underline-offset-4 md:h-9">
                Excluir esta e as seguintes
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
