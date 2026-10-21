import type { WalletBalance } from '../api/types'
import { formatCents } from '../lib/money'
import { PaidGauge } from './PaidGauge'

type Props = { title: string; hint: string; balance: WalletBalance; tone?: 'free' | 'benefit' }

const row = 'flex items-baseline justify-between gap-3 border-t border-graphite/10 py-2 text-[13px]'

/**
 * O saldo de uma carteira no mês: recebido − pago. É uma estimativa, não o saldo do banco.
 * "sobra" em teal; "falta" leva o marcador coral `[ ✖ ]` (o coral só aparece onde há alerta).
 */
export function WalletCard({ title, hint, balance, tone = 'free' }: Props) {
  const negative = balance.balanceCents < 0
  const spentFraction = balance.receivedIncomeCents > 0 ? balance.paidCents / balance.receivedIncomeCents : balance.paidCents > 0 ? 1 : 0
  return (
    <section aria-label={title} className={`rounded-md p-4 ${tone === 'free' ? 'bg-teal text-ivory' : 'border border-graphite/20'}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className={`text-xs font-medium uppercase tracking-wider ${tone === 'free' ? 'text-ivory/85' : 'text-graphite/80'}`}>{title}</h2>
        <span className={`text-[11px] ${tone === 'free' ? 'text-ivory/75' : 'text-graphite/70'}`}>{hint}</span>
      </div>
      <p className={`mt-1 flex items-center gap-2 text-sm font-semibold ${tone === 'free' ? 'text-ivory' : 'text-graphite'}`}>
        {negative ? (
          <>
            <span className="font-mono text-signal" aria-hidden="true">[ ✖ ]</span> falta
          </>
        ) : (
          <>
            <span className="font-mono" aria-hidden="true">[ ▪ ]</span> sobra
          </>
        )}
      </p>
      <p className={`font-mono text-[38px] font-semibold leading-tight tracking-tight tabular-nums ${tone === 'free' ? 'text-ivory' : 'text-teal'}`}>
        {formatCents(Math.abs(balance.balanceCents))}
      </p>
      <PaidGauge fraction={Math.min(1, spentFraction)} tone={tone === 'free' ? 'dark' : 'light'} className="mt-2" />
      <p className={`mt-1 text-[11px] ${tone === 'free' ? 'text-ivory/75' : 'text-graphite/70'}`}>
        {Math.round(spentFraction * 100)}% do que entrou já foi gasto
      </p>
      <dl className={`mt-3 ${tone === 'free' ? '[&>div]:border-ivory/20' : ''}`}>
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
      </dl>
    </section>
  )
}
