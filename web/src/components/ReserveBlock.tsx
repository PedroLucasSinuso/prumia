import type { ReserveStatus } from '../api/types'
import { formatCents } from '../lib/money'
import { PaidGauge } from './PaidGauge'

/** "2,5" meses: uma casa decimal, com vírgula (é contagem de meses, não dinheiro). */
const months = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })

/**
 * Reserva de emergência no Resumo (só quando a casa configurou uma meta). Mostra quanto está guardado nas carteiras de
 * reserva, quantos meses de gasto essencial isso cobre e o medidor até a meta. Sem gasto essencial ainda, explica.
 */
export function ReserveBlock({ reserve }: { reserve: ReserveStatus }) {
  if (reserve.targetMonths == null) return null
  const { targetMonths, savedCents, essentialMonthlyCents, basisMonths, targetCents } = reserve
  const covered = essentialMonthlyCents > 0 ? Math.max(0, savedCents) / essentialMonthlyCents : 0
  const fraction = targetCents > 0 ? Math.min(1, Math.max(0, savedCents) / targetCents) : 0
  return (
    <section aria-label="Reserva de emergência" className="rounded-md bg-raised p-4 md:p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-meta font-medium uppercase tracking-wider text-muted">reserva de emergência</h2>
        <span className="text-caption text-muted">meta: {targetMonths} {targetMonths === 1 ? 'mês' : 'meses'} de gasto essencial</span>
      </div>
      <p className="mt-1 font-mono text-figure font-semibold tracking-tight tabular-nums text-heading">{formatCents(savedCents)}</p>
      {reserve.walletIds.length === 0 ? (
        <p className="mt-1 text-ui text-muted">Nenhuma carteira marcada como reserva. Marque em Ajustes &gt; Carteiras.</p>
      ) : essentialMonthlyCents === 0 ? (
        <p className="mt-1 text-ui text-muted">Ainda não há gasto essencial lançado para calcular quantos meses isso cobre.</p>
      ) : (
        <>
          <p className="mt-1 text-ui text-ink">
            cobre <span className="font-mono font-semibold tabular-nums">{months(covered)}</span> de {targetMonths}{' '}
            {targetMonths === 1 ? 'mês' : 'meses'} · meta <span className="font-mono tabular-nums">{formatCents(targetCents)}</span>
          </p>
          <PaidGauge fraction={fraction} className="mt-3" label={`${Math.round(fraction * 100)}% da meta da reserva`} />
          <p className="mt-2 text-meta text-muted">
            gasto essencial médio: <span className="font-mono tabular-nums">{formatCents(essentialMonthlyCents)}</span> por mês
            ({basisMonths === 1 ? '1 mês' : `média de ${basisMonths} meses`})
          </p>
        </>
      )}
    </section>
  )
}
