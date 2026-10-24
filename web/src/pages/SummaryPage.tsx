import { Link } from 'react-router-dom'
import { useState, type ReactNode } from 'react'

import { useCategories, useCategoryHistory, useSummary } from '../api/queries'
import { useActiveHouse } from '../auth/useActiveHouse'
import { AppShell } from '../components/AppShell'
import { CategoryBreakdown } from '../components/CategoryBreakdown'
import { HistoryPanel } from '../components/HistoryPanel'
import { MonthSelector } from '../components/MonthSelector'
import { Sheet } from '../components/Sheet'
import { WalletCard } from '../components/WalletCard'
import { rollup } from '../lib/categories'
import { addMonths } from '../lib/dates'
import { commitments, monthShort } from '../lib/history'
import { formatCents } from '../lib/money'
import { useIsDesktop } from '../lib/useIsDesktop'
import { useMonthParam } from '../lib/useMonthParam'

const label = 'text-xs font-medium uppercase tracking-wider text-ink/80'
const card = 'rounded-md border border-line p-4'

/** Um destaque da linha do topo: rótulo, valor em mono e uma nota curta. */
function Tile({ title, value, note, strong = false }: { title: string; value: string; note?: ReactNode; strong?: boolean }) {
  return (
    <div className={`rounded-md p-3 md:p-4 ${strong ? 'border-2 border-structure' : 'border border-line'}`}>
      <p className={label}>{title}</p>
      <p className={`mt-1 font-mono text-xl font-semibold tabular-nums md:text-2xl ${strong ? 'text-heading' : 'text-ink'}`}>{value}</p>
      {note && <p className="mt-0.5 text-xs text-ink/75">{note}</p>}
    </div>
  )
}

/**
 * Resumo do mês. Número principal: o SALDO PROJETADO (previsto para entrar − pago − a pagar), da casa e de cada carteira;
 * coral só se ele for negativo. Depois as carteiras, "para onde vai o dinheiro" (cada categoria abre o histórico dela) e os
 * compromissos dos próximos 3 meses (parcelas e contas fixas). Tudo por competência.
 * Computador: grade com destaques, carteiras lado a lado e o histórico num painel ao lado da lista. Celular: uma coluna e o
 * histórico abre num painel que sobe da base.
 */
export default function SummaryPage() {
  const [month, setMonth] = useMonthParam()
  const { house } = useActiveHouse()
  const houseId = house?.id ?? ''
  const summary = useSummary(houseId, month)
  const categories = useCategories(houseId)
  const future = useCategoryHistory(houseId, addMonths(month, 1), addMonths(month, 3))
  const desktop = useIsDesktop()
  const [picked, setPicked] = useState<string | null>(null)

  if (!house) return null
  const s = summary.data
  const cats = categories.data ?? []
  const noIncome = s !== undefined && s.wallets.free.expectedIncomeCents === 0 && s.wallets.benefit.expectedIncomeCents === 0
  const rows = rollup(s?.byCategory ?? [], cats)
  const projected = s ? s.wallets.free.projectedCents + s.wallets.benefit.projectedCents : 0
  // No computador o painel nunca fica vazio: sem escolha, mostra a categoria que mais pesa.
  const selected = picked ?? (desktop ? (rows[0]?.id ?? null) : null)
  const selectedName = selected ? (cats.find((c) => c.id === selected)?.name ?? 'Sem categoria') : ''
  const ahead = future.data ? commitments(future.data) : []
  const aheadTotal = ahead.reduce((sum, m) => sum + m.cents, 0)

  return (
    <AppShell>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pb-36 pt-2 md:max-w-[1600px] md:gap-5 md:px-8 md:pb-10 md:pt-8">
        <header>
          <MonthSelector month={month} onChange={setMonth} />
          <p className="mt-2 hidden text-sm text-ink/75 md:block">Resumo do mês: o que entra, o que sai e para onde vai.</p>
        </header>

        {summary.isPending && <p role="status" className="text-sm text-ink/70">carregando…</p>}
        {summary.isError && (
          <p role="alert" className="rounded-md border border-alert/60 bg-alert/10 px-3 py-2 text-sm">
            <span className="font-mono text-alert">[ ✖ ]</span> Não foi possível carregar o resumo.{' '}
            <button className="font-semibold underline" onClick={() => void summary.refetch()}>
              Tentar de novo
            </button>
          </p>
        )}

        {s && (
          <>
            {noIncome && (
              <p className="rounded-md border border-dashed border-line p-4 text-sm text-ink/80">
                Ainda não há receitas neste mês, então o saldo mostra só o que sai. Cadastre o salário e o vale em{' '}
                <Link to="/receitas" className="font-semibold text-accent underline underline-offset-2">
                  receitas
                </Link>
                .
              </p>
            )}

            <section aria-label="Destaques do mês">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Tile
                  strong
                  title="saldo projetado"
                  value={formatCents(Math.abs(projected))}
                  note={
                    projected < 0 ? (
                      <>
                        <span className="font-mono text-alert" aria-hidden="true">[ ✖ ]</span> vai faltar no mês
                      </>
                    ) : (
                      <>
                        <span className="font-mono" aria-hidden="true">[ ▪ ]</span> deve sobrar no mês
                      </>
                    )
                  }
                />
                <Tile title="a pagar" value={formatCents(s.totalPendingCents)} note="inclui as atrasadas" />
                <Tile
                  title="atrasado"
                  value={formatCents(s.overdueCents)}
                  note={
                    s.overdueCount > 0 ? (
                      <>
                        <span className="font-mono text-alert" aria-hidden="true">[ ✖ ]</span> {s.overdueCount === 1 ? '1 conta vencida' : `${s.overdueCount} contas vencidas`}
                      </>
                    ) : (
                      'nenhuma conta vencida'
                    )
                  }
                />
                <Tile title="pago" value={formatCents(s.totalPaidCents)} note="valor efetivamente pago" />
              </div>
              <p className="mt-2 text-xs text-ink/70">
                Projetado = tudo o que está previsto para entrar menos o que já foi pago e o que falta pagar no mês.
              </p>
            </section>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]">
              <WalletCard title="Carteira livre" hint="salário e outras receitas" balance={s.wallets.free} tone="free" />
              <WalletCard title="Carteira de benefício" hint="vale-refeição" balance={s.wallets.benefit} tone="benefit" />
              {desktop && (
                <div className={`${card} md:col-span-2 lg:col-span-1`}>
                  <HistoryPanel houseId={houseId} month={month} categoryId={null} categories={cats} />
                </div>
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              <section aria-label="Por categoria" className={card}>
                <h2 className={label}>para onde vai o dinheiro</h2>
                {s.byCategory.length === 0 ? (
                  <p className="mt-2 text-sm text-ink/75">Nenhuma conta neste mês.</p>
                ) : (
                  <>
                    <p className="mt-1 text-xs text-ink/70">Selecione uma categoria para ver o histórico.</p>
                    <div className="mt-3">
                      <CategoryBreakdown rows={rows} split onSelect={setPicked} selectedId={selected} />
                    </div>
                  </>
                )}
                <p className="mt-3 flex items-center gap-4 text-xs text-ink/80">
                  <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-xs bg-structure" />pago</span>
                  <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-xs bg-accent" />a pagar</span>
                </p>
              </section>

              {desktop && selected && (
                <div className={card}>
                  <HistoryPanel key={selected} houseId={houseId} month={month} categoryId={selected} categories={cats} />
                </div>
              )}
            </div>

            {aheadTotal > 0 && (
              <section aria-label="Compromissos futuros" className={card}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className={label}>compromissos futuros</h2>
                  <Link to="/parcelas" className="text-sm font-semibold text-accent underline underline-offset-2">
                    ver parcelas e fixas
                  </Link>
                </div>
                <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-heading">{formatCents(aheadTotal)}</p>
                <p className="text-xs text-ink/75">em parcelas e contas fixas nos próximos 3 meses</p>
                <ul className="mt-3 grid grid-cols-3 gap-3 text-sm">
                  {ahead.map((m) => (
                    <li key={m.month} className="border-t border-line pt-2">
                      <span className="block text-xs text-ink/75">{monthShort(m.month)}</span>
                      <span className="font-mono tabular-nums">{formatCents(m.cents)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {!desktop && selected && (
              <Sheet title={selectedName} onClose={() => setPicked(null)}>
                <HistoryPanel houseId={houseId} month={month} categoryId={selected} categories={cats} hideTitle />
              </Sheet>
            )}
          </>
        )}
      </main>
    </AppShell>
  )
}
