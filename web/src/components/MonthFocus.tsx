import type { Invoice } from '../api/types'
import { dayMonth, monthName } from '../lib/dates'
import { formatCents } from '../lib/money'
import { dueSoon } from '../lib/monthList'
import { PaidGauge } from './PaidGauge'
import { Button } from './ui/Button'
import { Eyebrow } from './ui/Eyebrow'
import { Stat } from './ui/Stat'
import { Surface } from './ui/Surface'

type Props = {
  list: Invoice[]
  /** Mês exibido ("AAAA-MM-01"). */
  month: string
  today: string
  canWrite: boolean
  busy: boolean
  /** O mesmo `togglePaid` da lista: paga com a carteira sugerida e mostra o aviso com Desfazer. */
  onPay: (invoice: Invoice) => void
  /** Celular: números em linhas compactas; computador: coluna ao lado do destaque. */
  compact?: boolean
}

/** Quantas contas o destaque lista; o resto continua na lista do mês, logo abaixo. */
const MAX_ITEMS = 5

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * O topo da visão do mês na direção "Instrumento calmo": UM destaque (`Surface raised`, ~2/3 da largura) que muda conforme
 * o estado do mês, e ao lado, sem caixa, os três números de contexto separados por filetes.
 *   - há atrasadas      → "pede atenção agora": quantas, o valor em `alert-text` e a lista acionável (atrasadas + 7 dias);
 *   - vence na semana   → "próximos 7 dias": o que vence e o valor;
 *   - nada pendente     → "mês quitado": uma frase calma, sem um R$ 0,00 gigante;
 *   - o resto (sem nada nos 7 dias, ou outro mês) → as próximas contas a pagar.
 * Cada linha da lista tem "Pagar" (o mesmo pagamento de um toque do nó da lista).
 */
export function MonthFocus({ list, month, today, canWrite, busy, onPay, compact = false }: Props) {
  const pending = list.filter((i) => i.status !== 'paid')
  const overdue = list.filter((i) => i.status === 'overdue')
  // dueSoon já traz as atrasadas primeiro e depois o que vence de hoje até daqui a 7 dias.
  const soon = dueSoon(list, today)
  const sum = (items: Invoice[]) => items.reduce((s, i) => s + i.amountCents, 0)

  const total = sum(list)
  const toPay = sum(pending)
  const paidList = list.filter((i) => i.status === 'paid')
  const paidTotal = paidList.reduce((s, i) => s + (i.paid?.amountCents ?? i.amountCents), 0)
  // Medidor: fração por VALOR das contas pagas (o mesmo critério da régua).
  const fraction = total > 0 ? sum(paidList) / total : 0
  const pct = Math.round(fraction * 100)

  const state = overdue.length > 0 ? 'late' : soon.length > 0 ? 'week' : pending.length === 0 ? 'done' : 'later'
  const items = state === 'late' || state === 'week' ? soon : pending
  const shown = items.slice(0, MAX_ITEMS)
  const rest = items.length - shown.length

  const focus = (
    <Surface as="section" aria-label="Destaque do mês" className="flex min-w-0 flex-col gap-4">
      {state === 'late' && (
        <>
          <Eyebrow as="h2" tone="alert">pede atenção agora</Eyebrow>
          <div>
            <p className="flex items-baseline gap-2 font-display text-title font-bold text-heading font-stretch-condensed md:text-section">
              <span aria-hidden="true" className="font-mono text-ui font-semibold text-alert">[ ✖ ]</span>
              <span>{plural(overdue.length, 'conta atrasada', 'contas atrasadas')}</span>
            </p>
            <p data-emphasis="alert" className="mt-1 font-mono text-figure font-semibold tracking-tight tabular-nums text-alert-text md:text-figure-lg">
              {formatCents(sum(overdue))}
            </p>
            {soon.length > overdue.length && (
              <p className="mt-1 text-ui text-muted">
                e mais <span className="font-mono">{formatCents(sum(soon) - sum(overdue))}</span> vencem nos próximos 7 dias
              </p>
            )}
          </div>
        </>
      )}
      {state === 'week' && (
        <>
          <Eyebrow as="h2">próximos 7 dias</Eyebrow>
          <div>
            <p className="font-display text-title font-bold text-heading font-stretch-condensed md:text-section">
              {soon.length === 1 ? '1 conta vence nesta semana' : `${soon.length} contas vencem nesta semana`}
            </p>
            <p className="mt-1 font-mono text-figure font-semibold tracking-tight tabular-nums text-heading md:text-figure-lg">{formatCents(sum(soon))}</p>
          </div>
        </>
      )}
      {state === 'done' && (
        <>
          <Eyebrow as="h2">mês quitado</Eyebrow>
          <div>
            <p className="flex items-baseline gap-2 font-display text-title font-bold text-heading font-stretch-condensed md:text-section">
              <span aria-hidden="true" className="font-mono text-ui font-semibold text-accent">[ ▪ ]</span>
              <span>Tudo pago em {monthName(month)}</span>
            </p>
            <p className="mt-1 text-body text-muted">
              <span className="font-mono">{formatCents(paidTotal)}</span> em {plural(list.length, 'conta', 'contas')}. Nada pendente.
            </p>
          </div>
        </>
      )}
      {state === 'later' && (
        <>
          <Eyebrow as="h2">próximos vencimentos</Eyebrow>
          <p className="font-display text-title font-bold text-heading font-stretch-condensed md:text-section">
            {month.slice(0, 7) === today.slice(0, 7) ? 'Nada vence nos próximos 7 dias' : `${plural(pending.length, 'conta', 'contas')} a pagar em ${monthName(month)}`}
          </p>
        </>
      )}

      {shown.length > 0 && (
        <ul aria-label={state === 'late' ? 'Atrasadas e próximos 7 dias' : 'Contas a pagar'} className="-mx-2 flex flex-col">
          {shown.map((i) => {
            const late = i.status === 'overdue'
            return (
              <li key={i.id} className="flex min-h-12 items-center gap-3 rounded-sm px-2 md:min-h-10">
                <span aria-hidden="true" className={`shrink-0 font-mono text-caption ${late ? 'text-alert' : 'text-muted'}`}>{late ? '[ ✖ ]' : '[ ▫ ]'}</span>
                <span className={`w-11 shrink-0 font-mono text-meta tabular-nums ${late ? 'text-alert-text' : 'text-muted'}`}>{dayMonth(i.dueDate)}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{i.description}</span>
                <span className="shrink-0 font-mono text-ui font-semibold tabular-nums text-ink">{formatCents(i.amountCents)}</span>
                {canWrite && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    aria-label={`Pagar ${i.description}, ${late ? 'venceu' : 'vence'} ${dayMonth(i.dueDate)}`}
                    onClick={() => onPay(i)}
                  >
                    Pagar
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {rest > 0 && <p className="text-meta text-muted">e mais {plural(rest, 'conta', 'contas')} na lista abaixo</p>}
    </Surface>
  )

  // Números de contexto: sem caixa, separados por filetes. O "a pagar" recua para `muted` quando o mês está quitado.
  const figures = compact ? (
    <dl aria-label="Números do mês" className="flex flex-col divide-y divide-line px-1">
      <div className="flex items-baseline justify-between gap-3 py-2.5">
        <dt className="text-caption font-medium uppercase tracking-wider text-muted">a pagar no mês</dt>
        <dd className={`font-mono text-body font-semibold tabular-nums ${toPay === 0 ? 'text-muted' : 'text-heading'}`}>{formatCents(toPay)}</dd>
      </div>
      <div className="flex flex-col gap-2 py-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-caption font-medium uppercase tracking-wider text-muted">pago · <span className="font-mono">{pct}%</span></dt>
          <dd className="font-mono text-body font-semibold tabular-nums text-ink">{formatCents(paidTotal)}</dd>
        </div>
        <PaidGauge fraction={fraction} />
      </div>
      <div className="flex items-baseline justify-between gap-3 py-2.5">
        <dt className="text-caption font-medium uppercase tracking-wider text-muted">total do mês</dt>
        <dd className="text-ui text-muted">
          <span className="font-mono font-semibold text-ink">{formatCents(total)}</span> · {plural(list.length, 'conta', 'contas')}
        </dd>
      </div>
    </dl>
  ) : (
    <div className="flex min-w-0 flex-col divide-y divide-line">
      <Stat
        label="a pagar no mês"
        value={formatCents(toPay)}
        emphasis={toPay === 0 ? 'muted' : 'primary'}
        size="sm"
        note={pending.length === 0 ? 'nada pendente' : plural(pending.length, 'pendente', 'pendentes')}
        className="pb-4"
      />
      <Stat
        label="pago"
        aside={`${pct}%`}
        value={formatCents(paidTotal)}
        size="sm"
        note={
          <span className="flex w-full flex-col gap-2">
            <PaidGauge fraction={fraction} />
            <span>{paidList.length} de {plural(list.length, 'conta', 'contas')}</span>
          </span>
        }
        className="py-4"
      />
      <Stat label="total do mês" value={formatCents(total)} size="sm" note={plural(list.length, 'conta', 'contas')} className="pt-4" />
    </div>
  )

  return (
    <section aria-label="Resumo do mês" className={compact ? 'flex flex-col gap-3' : 'grid items-start gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]'}>
      {focus}
      {figures}
    </section>
  )
}
