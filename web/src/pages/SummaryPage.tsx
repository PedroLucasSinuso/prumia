import { Link } from 'react-router-dom'

import { useCategories, useSummary } from '../api/queries'
import { useActiveHouse } from '../auth/useActiveHouse'
import { AppShell } from '../components/AppShell'
import { CategoryBreakdown } from '../components/CategoryBreakdown'
import { MonthSelector } from '../components/MonthSelector'
import { WalletCard } from '../components/WalletCard'
import { rollup } from '../lib/categories'
import { formatCents } from '../lib/money'
import { useMonthParam } from '../lib/useMonthParam'

const label = 'text-xs font-medium uppercase tracking-wider text-graphite/80'

/**
 * Resumo do mês: "sobra ou falta?" por carteira (livre e benefício), quanto já foi pago x o que falta pagar,
 * e para onde o dinheiro vai (total por categoria). Tudo por competência. O saldo é recebido − pago: uma estimativa.
 */
export default function SummaryPage() {
  const [month, setMonth] = useMonthParam()
  const { house } = useActiveHouse()
  const houseId = house?.id ?? ''
  const summary = useSummary(houseId, month)
  const categories = useCategories(houseId)

  if (!house) return null
  const s = summary.data
  const noIncome = s !== undefined && s.wallets.free.expectedIncomeCents === 0 && s.wallets.benefit.expectedIncomeCents === 0
  const total = s ? s.totalPaidCents + s.totalPendingCents : 0
  const paidShare = total > 0 && s ? s.totalPaidCents / total : 0
  const rows = rollup(s?.byCategory ?? [], categories.data ?? [])

  return (
    <AppShell>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pb-36 pt-2 md:max-w-none md:gap-6 md:px-10 md:pb-10 md:pt-8">
        <header>
          <MonthSelector month={month} onChange={setMonth} />
          <p className="mt-2 hidden text-sm text-graphite/75 md:block">Resumo do mês: o que entrou, o que saiu e para onde foi.</p>
        </header>

        {summary.isPending && <p role="status" className="text-sm text-graphite/70">carregando…</p>}
        {summary.isError && (
          <p role="alert" className="rounded-md border border-signal/60 bg-signal/10 px-3 py-2 text-sm">
            <span className="font-mono text-signal">[ ✖ ]</span> Não foi possível carregar o resumo.{' '}
            <button className="font-semibold underline" onClick={() => void summary.refetch()}>
              Tentar de novo
            </button>
          </p>
        )}

        {s && (
          <>
            {noIncome && (
              <p className="rounded-md border border-dashed border-graphite/25 p-4 text-sm text-graphite/80">
                Ainda não há receitas neste mês, então o saldo mostra só o que foi pago. Cadastre o salário e o vale em{' '}
                <Link to="/receitas" className="font-semibold text-cobalt underline underline-offset-2">
                  receitas
                </Link>
                .
              </p>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <WalletCard title="Carteira livre" hint="salário e outras receitas" balance={s.wallets.free} tone="free" />
              <WalletCard title="Carteira de benefício" hint="vale-refeição" balance={s.wallets.benefit} tone="benefit" />
            </div>

            <section aria-label="Pago e a pagar" className="rounded-md border border-graphite/20 p-4">
              <h2 className={label}>contas do mês</h2>
              <div className="mt-2 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-graphite/80">já pago</p>
                  <p className="font-mono text-2xl font-semibold tabular-nums text-teal">{formatCents(s.totalPaidCents)}</p>
                </div>
                <div>
                  <p className="text-xs text-graphite/80">a pagar</p>
                  <p className="font-mono text-2xl font-semibold tabular-nums text-cobalt">{formatCents(s.totalPendingCents)}</p>
                </div>
              </div>
              <div role="img" aria-label={`${Math.round(paidShare * 100)}% das contas do mês já foi pago`} className="mt-3 flex h-3 overflow-hidden rounded-xs bg-graphite/10">
                <span className="bg-teal" style={{ width: `${paidShare * 100}%` }} />
                <span className="bg-cobalt" style={{ width: `${(1 - paidShare) * 100}%`, opacity: total > 0 ? 1 : 0 }} />
              </div>
            </section>

            <section aria-label="Por categoria" className="rounded-md border border-graphite/20 p-4">
              <h2 className={label}>para onde vai o dinheiro</h2>
              {s.byCategory.length === 0 ? (
                <p className="mt-2 text-sm text-graphite/75">Nenhuma conta neste mês.</p>
              ) : (
                <div className="mt-3"><CategoryBreakdown rows={rows} split /></div>
              )}
              <p className="mt-3 flex items-center gap-4 text-xs text-graphite/80">
                <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-xs bg-teal" />pago</span>
                <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-xs bg-cobalt" />a pagar</span>
              </p>
            </section>

            <p className="text-xs text-graphite/70">
              Saldo = o que já foi <strong>recebido</strong> menos o que já foi <strong>pago</strong> na competência do mês. É uma estimativa, não o
              saldo do banco; receitas ainda só previstas não entram.
            </p>
          </>
        )}
      </main>
    </AppShell>
  )
}
