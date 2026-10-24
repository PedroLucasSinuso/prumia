import type { MouseEvent } from 'react'

import type { Invoice } from '../api/types'
import { daysBetween, weekdayShort } from '../lib/dates'
import { formatCents } from '../lib/money'
import { useFlash, usePaidPulse } from '../lib/flash'
import { seriesTag } from '../lib/series'
import { useWalletName } from '../lib/useWalletName'
import { Tooltip } from './ui/Tooltip'

type Props = {
  invoice: Invoice
  /** Categoria como aparece na linha ("Moradia › Luz"); undefined quando a descrição já é o nome dela ("Luz / Luz"). */
  category?: string
  today?: string
  /** Aberta no painel de detalhe. */
  open: boolean
  /** Marcada na seleção múltipla. */
  checked: boolean
  /** Há alguma marcada: as caixas ficam visíveis em todas as linhas (sem precisar do hover). */
  selecting: boolean
  canWrite: boolean
  busy: boolean
  onTogglePaid: (invoice: Invoice) => void
  onOpen: (invoice: Invoice) => void
  /** Marca/desmarca; `range` = Shift+clique (marca o intervalo desde a última marcada). */
  onCheck: (invoice: Invoice, range: boolean) => void
}

/** Situação curta da linha: o marcador da marca e o texto (atraso em `ink`, o coral fica só no marcador e no nó). */
function rowStatus(invoice: Invoice, today: string | undefined, walletName: string): { mark: string; tone: string; text: string } {
  if (invoice.status === 'paid') return { mark: '[ ▪ ]', tone: 'text-accent', text: invoice.paid && walletName ? `paga · ${walletName}` : 'paga' }
  if (invoice.status === 'overdue') {
    const late = today ? daysBetween(invoice.dueDate, today) : 0
    return { mark: '[ ✖ ]', tone: 'text-alert', text: late > 0 ? `atrasada ${late} ${late === 1 ? 'dia' : 'dias'}` : 'atrasada' }
  }
  const d = today ? daysBetween(today, invoice.dueDate) : -1
  return { mark: '[ ▫ ]', tone: 'text-ink/80', text: d === 0 ? 'vence hoje' : d === 1 ? 'vence amanhã' : d > 1 ? `em ${d} dias` : 'a vencer' }
}

/**
 * Uma conta na lista do COMPUTADOR, em colunas (estilo instrumento): seleção · dia · nó (pagar) · descrição e selos ·
 * categoria · situação · valor · ação rápida. As colunas aparecem conforme a largura da lista (container queries `@lg`, `@2xl`):
 * em lista estreita, categoria e situação descem para a 2ª linha da descrição.
 * O nó continua no prumo (a linha vertical é desenhada pelo `Timeline`).
 */
export function InvoiceRow({ invoice, category, today, open, checked, selecting, canWrite, busy, onTogglePaid, onOpen, onCheck }: Props) {
  const paid = invoice.status === 'paid'
  const overdue = invoice.status === 'overdue'
  const node = paid ? 'border-structure bg-structure' : overdue ? 'border-alert bg-alert' : 'border-ink bg-surface'
  const tag = seriesTag(invoice)
  const nameOf = useWalletName()
  const status = rowStatus(invoice, today, nameOf(invoice.paid?.walletId))
  // O risco é sempre `line-through`, mas transparente enquanto a conta não está paga: ao pagar, a cor aparece em 150 ms.
  const strike = `line-through transition-colors ${paid ? 'text-ink/60 decoration-ink/60' : 'decoration-transparent'}`
  const flashing = useFlash(invoice.id)
  const pulsing = usePaidPulse(invoice.id)

  return (
    <li
      className={`group relative grid min-h-12 grid-cols-[28px_52px_44px_minmax(0,1fr)_64px] items-center border-l-2 pl-1.5 transition-colors ${flashing ? 'motion-safe:animate-flash' : ''} ${
        open ? 'border-structure bg-structure/7' : checked ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-ink/4'
      }`}
    >
      <span className="flex justify-center">
        {canWrite && (
          <input
            type="checkbox"
            aria-label={`Selecionar ${invoice.description}`}
            checked={checked}
            readOnly
            onClick={(e: MouseEvent<HTMLInputElement>) => onCheck(invoice, e.shiftKey)}
            className={`size-4 cursor-pointer accent-[var(--color-accent)] transition-opacity focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 ${checked || selecting ? 'opacity-100' : 'opacity-0'}`}
          />
        )}
      </span>
      <span className="flex items-baseline justify-end gap-1 pr-2 leading-tight">
        <span className="font-mono text-[15px] font-semibold tabular-nums">{invoice.dueDate.slice(8, 10)}</span>
        <span className="text-[11px] text-ink/75">{weekdayShort(invoice.dueDate)}</span>
      </span>
      <Tooltip label={paid ? 'Desfazer pagamento' : 'Pagar'} shortcut={paid ? undefined : 'P'}>
        <button
          aria-label={paid ? `Desfazer pagamento de ${invoice.description}` : `Pagar ${invoice.description}`}
          disabled={!canWrite || busy}
          onClick={() => onTogglePaid(invoice)}
          className="group/node flex h-11 w-11 items-center justify-center disabled:cursor-default"
        >
          <span className={`flex size-[18px] items-center justify-center rounded-sm border-2 outline-4 outline-surface transition-colors motion-safe:group-active/node:scale-90 ${node} ${pulsing ? 'motion-safe:animate-fill' : ''}`}>
            {paid && <span className="size-2 rounded-[1px] bg-on-structure" />}
          </span>
        </button>
      </Tooltip>
      <button
        aria-label={`Detalhes de ${invoice.description}`}
        data-row-id={invoice.id}
        onClick={() => onOpen(invoice)}
        className="grid min-h-12 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-1.5 pl-1 text-left outline-offset-[-2px] @lg:grid-cols-[minmax(0,1fr)_10.5rem_7.5rem] @3xl:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_10.5rem_7.5rem]"
      >
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={`truncate text-sm font-medium ${strike}`}>{invoice.description}</span>
            {tag && <span className="shrink-0 rounded-xs border border-ink/40 px-1 font-mono text-[10px] text-ink/80">{tag}</span>}
          </span>
          <span className="block truncate text-xs text-ink/75 @3xl:hidden">
            {category && <span>{category}</span>}
            <span className="@lg:hidden">{category ? ' · ' : ''}{status.text}</span>
          </span>
        </span>
        <span className="hidden truncate text-[13px] text-ink/80 @3xl:block">{category ?? ''}</span>
        <span className="hidden items-center gap-1.5 text-[13px] @lg:flex">
          <span aria-hidden="true" className={`shrink-0 whitespace-nowrap font-mono text-xs ${status.tone}`}>{status.mark}</span>
          <span className="truncate">{status.text}</span>
        </span>
        <span className={`text-right font-mono text-sm font-semibold tabular-nums ${strike}`}>{formatCents(invoice.amountCents)}</span>
      </button>
      {/* Atalho visual para o mouse; teclado e leitor de tela usam o nó (acima) ou as teclas P/Espaço. */}
      <span className="flex justify-center">
        {canWrite && (
          <button
            tabIndex={-1}
            aria-hidden="true"
            disabled={busy}
            onClick={() => onTogglePaid(invoice)}
            className="h-8 rounded-sm px-2 text-xs font-semibold text-accent underline underline-offset-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 disabled:text-ink/40"
          >
            {paid ? 'desfazer' : 'pagar'}
          </button>
        )}
      </span>
    </li>
  )
}
