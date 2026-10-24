import type { WalletBalance } from '../api/types'
import { formatCents } from '../lib/money'
import { PaidGauge } from './PaidGauge'

type Props = { title: string; hint: string; balance: WalletBalance; /** `dark`: a carteira padrão da casa; as outras são contornadas. */ tone?: 'dark' | 'light' }

const row = 'flex items-baseline justify-between gap-3 border-t border-line py-2 text-[13px] md:py-1.5'

/**
 * Uma carteira no mês (o saldo continua de um mês para o outro). O número principal é o SALDO PROJETADO (previsto para entrar − pago − a pagar): só fica coral, com
 * `[ ✖ ]`, se no fim do mês vai faltar. O realizado (recebido − pago) vem embaixo, como informação: um salário que ainda não
 * foi marcado como recebido não é alarme. O "a pagar" por carteira é estimado pela carteira padrão da categoria.
 */
export function WalletCard({ title, hint, balance, tone = 'light' }: Props) {
  const dark = tone === 'dark'
  const projected = balance.projectedCents
  const negative = projected < 0
  const paidFraction = balance.expectedIncomeCents > 0 ? balance.paidCents / balance.expectedIncomeCents : balance.paidCents > 0 ? 1 : 0
  const soft = dark ? 'text-on-structure/75' : 'text-ink/70'
  return (
    <section aria-label={title} className={`rounded-md p-4 ${dark ? 'bg-structure text-on-structure' : 'border border-line'}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className={`text-xs font-medium uppercase tracking-wider ${dark ? 'text-on-structure/85' : 'text-ink/80'}`}>{title}</h2>
        <span className={`text-[11px] ${soft}`}>{hint}</span>
      </div>
      <p className={`mt-1 flex items-center gap-2 text-sm font-semibold ${dark ? 'text-on-structure' : 'text-ink'}`}>
        {negative ? (
          <>
            <span className="font-mono text-alert" aria-hidden="true">[ ✖ ]</span> vai faltar
          </>
        ) : (
          <>
            <span className="font-mono" aria-hidden="true">[ ▪ ]</span> deve sobrar
          </>
        )}
      </p>
      <p className={`font-mono text-[38px] font-semibold leading-tight tracking-tight tabular-nums md:text-[32px] ${dark ? 'text-on-structure' : 'text-heading'}`}>
        {formatCents(Math.abs(projected))}
      </p>
      <p className={`text-[11px] ${soft}`}>
        hoje: <span className="font-mono tabular-nums">{formatCents(balance.balanceCents)}</span> (saldo anterior + recebido − pago ± transferências)
      </p>
      <PaidGauge fraction={Math.min(1, paidFraction)} tone={dark ? 'dark' : 'light'} className="mt-3" />
      <p className={`mt-1 text-[11px] ${soft}`}>{Math.round(paidFraction * 100)}% do previsto já foi pago</p>
      <dl className={`mt-3 ${dark ? '[&>div]:border-on-structure/20' : ''}`}>
        {balance.carryOverCents !== 0 && (
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
