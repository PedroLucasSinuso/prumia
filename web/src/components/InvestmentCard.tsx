import type { WalletBalance } from '../api/types'
import { formatCents, formatSignedCents } from '../lib/money'
import { Button } from './ui/Button'

type Props = { balance: WalletBalance; institution?: string
  /** Abre o "Conferir saldo" (aqui: atualizar o valor com o rendimento); sem ele (Só leitura, mês futuro, arquivada) o botão não aparece. */
  onCheck?: () => void }

const row = 'flex items-baseline justify-between gap-3 border-t border-line py-2 text-ui md:py-1.5'

/**
 * Um investimento no mês. É uma carteira especial: o valor é o saldo realizado (saldo anterior + aportes − resgates ±
 * atualizações). Aporte e resgate são transferências; o rendimento entra pelo Conferir saldo. Sem "vai faltar": não paga
 * conta e fica fora do saldo projetado da casa.
 */
export function InvestmentCard({ balance, institution, onCheck }: Props) {
  const name = balance.name
  return (
    <section aria-label={name} className="rounded-md bg-raised p-4 text-ink md:p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-meta font-medium uppercase tracking-wider text-muted">{name}</h3>
        {institution && <span className="truncate text-caption text-muted">{institution}</span>}
      </div>
      <p className="mt-1 font-mono text-figure font-semibold tracking-tight tabular-nums text-heading">{formatCents(balance.balanceCents)}</p>
      <p className="text-caption text-muted">valor no fim do mês (o último informado mais aportes e resgates)</p>
      <dl className="mt-3">
        {balance.carryOverCents !== 0 && (
          <div className={row}>
            <dt>valor dos meses anteriores</dt>
            <dd className="font-mono tabular-nums">{formatCents(balance.carryOverCents)}</dd>
          </div>
        )}
        <div className={row}>
          <dt>aportes</dt>
          <dd className="font-mono tabular-nums">{formatCents(balance.transfersInCents)}</dd>
        </div>
        <div className={row}>
          <dt>resgates</dt>
          <dd className="font-mono tabular-nums">{formatCents(balance.transfersOutCents)}</dd>
        </div>
        {balance.adjustmentsCents !== 0 && (
          <div className={row}>
            <dt>rendimento e atualizações</dt>
            <dd className="font-mono tabular-nums">{formatSignedCents(balance.adjustmentsCents)}</dd>
          </div>
        )}
      </dl>
      {onCheck && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={onCheck} aria-label={`Atualizar valor de ${name}`}>
          Atualizar valor
        </Button>
      )}
    </section>
  )
}
