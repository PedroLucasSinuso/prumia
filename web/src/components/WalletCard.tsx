import type { WalletBalance } from '../api/types'
import { monthLabel } from '../lib/dates'
import { formatCents } from '../lib/money'
import { PaidGauge } from './PaidGauge'

type Props = { title: string; hint: string; balance: WalletBalance; /** Mês consultado (AAAA-MM-01): antes do mês de início da carteira ela "ainda não começou". */ month?: string; /** `dark`: a carteira padrão da casa (ganha um filete `accent` à esquerda; o fundo é o mesmo `raised` das outras). */ tone?: 'dark' | 'light' }

const row = 'flex items-baseline justify-between gap-3 border-t border-line py-2 text-ui md:py-1.5'

/**
 * Uma carteira no mês (o saldo continua de um mês para o outro). O número principal é o SALDO PROJETADO (previsto para entrar − pago − a pagar): só fica coral, com
 * `[ ✖ ]`, se no fim do mês vai faltar. O realizado (recebido − pago) vem embaixo, como informação: um salário que ainda não
 * foi marcado como recebido não é alarme. O "a pagar" por carteira é estimado pela carteira padrão da categoria.
 * Direção "Instrumento calmo": todas as carteiras sobre `raised` (sem bloco sólido da estrutura, que fica para a navegação).
 */
export function WalletCard({ title, hint, balance, month, tone = 'light' }: Props) {
  const start = balance.openingBalanceMonth
  const beforeStart = Boolean(start && month && month < start)
  const dark = tone === 'dark'
  const projected = balance.projectedCents
  const negative = projected < 0
  const paidFraction = balance.expectedIncomeCents > 0 ? balance.paidCents / balance.expectedIncomeCents : balance.paidCents > 0 ? 1 : 0
  const soft = 'text-muted'
  return (
    <section aria-label={title} className={`rounded-md bg-raised p-4 text-ink md:p-5 ${dark ? 'border-l-2 border-accent' : ''}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-meta font-medium uppercase tracking-wider text-muted">{title}</h2>
        <span className={`text-caption ${soft}`}>{hint}</span>
      </div>
      <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-ink">
        {negative ? (
          <>
            <span className="font-mono text-alert" aria-hidden="true">[ ✖ ]</span> <span className="text-alert-text">vai faltar</span>
          </>
        ) : (
          <>
            <span className="font-mono text-accent" aria-hidden="true">[ ▪ ]</span> deve sobrar
          </>
        )}
      </p>
      <p className={`font-mono text-figure font-semibold tracking-tight tabular-nums ${negative ? 'text-alert-text' : 'text-heading'}`}>
        {formatCents(Math.abs(projected))}
      </p>
      <p className={`text-caption ${soft}`}>
        hoje: <span className="font-mono tabular-nums">{formatCents(balance.balanceCents)}</span> (saldo anterior + recebido − pago ± transferências)
      </p>
      <PaidGauge fraction={Math.min(1, paidFraction)} className="mt-3" />
      <p className={`mt-1 text-caption ${soft}`}>{Math.round(paidFraction * 100)}% do previsto já foi pago</p>
      {beforeStart && start && <p className={`mt-1 text-caption ${soft}`}>esta carteira começa em {monthLabel(start)}</p>}
      <dl className="mt-3">
        {!beforeStart && balance.carryOverCents !== 0 && (
          <div className={row}>
            <dt>saldo que veio dos meses anteriores</dt>
            <dd className="font-mono tabular-nums">{formatCents(balance.carryOverCents)}</dd>
          </div>
        )}
        {balance.transfersInCents !== 0 && (
          <div className={row}>
            <dt>transferências recebidas</dt>
            <dd className="font-mono tabular-nums">{formatCents(balance.transfersInCents)}</dd>
          </div>
        )}
        {balance.transfersOutCents !== 0 && (
          <div className={row}>
            <dt>transferências enviadas</dt>
            <dd className="font-mono tabular-nums">{formatCents(balance.transfersOutCents)}</dd>
          </div>
        )}
        <div className={row}>
          <dt>previsto para entrar</dt>
          <dd className="font-mono tabular-nums">{formatCents(balance.expectedIncomeCents)}</dd>
        </div>
        <div className={row}>
          <dt>já recebido</dt>
          <dd className="font-mono tabular-nums">{formatCents(balance.receivedIncomeCents)}</dd>
        </div>
        <div className={row}>
          <dt>já pago</dt>
          <dd className="font-mono tabular-nums">{formatCents(balance.paidCents)}</dd>
        </div>
        <div className={row}>
          <dt>a pagar (estimado)</dt>
          <dd className="font-mono tabular-nums">{formatCents(balance.pendingCents)}</dd>
        </div>
      </dl>
    </section>
  )
}
