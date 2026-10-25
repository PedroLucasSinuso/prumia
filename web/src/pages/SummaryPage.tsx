import { ArrowLeftRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useState } from 'react'

import { useAdjustmentActions, useAdjustments, useReferenceRates, useReserve, useCategories, useCategoryHistory, useMembers, useSummary, useTransferActions, useTransfers, useWallets } from '../api/queries'
import type { Transfer, TransferInput, TransferResult, WalletAdjustment, WalletBalance } from '../api/types'
import { useActiveHouse } from '../auth/useActiveHouse'
import { AdjustmentsSection } from '../components/AdjustmentsSection'
import { AppShell } from '../components/AppShell'
import { BalanceCheckForm } from '../components/BalanceCheckForm'
import { ReserveBlock } from '../components/ReserveBlock'
import { CategoryBreakdown } from '../components/CategoryBreakdown'
import { HistoryPanel } from '../components/HistoryPanel'
import { MonthSelector } from '../components/MonthSelector'
import { Sheet } from '../components/Sheet'
import { SlideOver } from '../components/SlideOver'
import { useToast } from '../components/toastContext'
import { TransferForm } from '../components/TransferForm'
import { TransfersSection } from '../components/TransfersSection'
import { InvestmentCard } from '../components/InvestmentCard'
import { WalletCard } from '../components/WalletCard'
import { Button, ButtonLink } from '../components/ui/Button'
import { Eyebrow } from '../components/ui/Eyebrow'
import { ListSkeleton } from '../components/ui/ListSkeleton'
import { Notice } from '../components/ui/Notice'
import { Stat } from '../components/ui/Stat'
import { Surface } from '../components/ui/Surface'
import { rollup } from '../lib/categories'
import { addMonths, currentMonth, monthLabel, monthName } from '../lib/dates'
import { commitments, monthShort } from '../lib/history'
import { formatCents, formatSignedCents } from '../lib/money'
import { useIsDesktop } from '../lib/useIsDesktop'
import { useMonthParam } from '../lib/useMonthParam'
import { formatBasisPoints } from '../lib/rates'
import { walletName } from '../lib/wallets'

const label = 'text-caption font-medium uppercase tracking-wider text-muted'
// Blocos do resumo: profundidade por TOM (raised), sem borda.
const card = 'rounded-md bg-raised p-4 md:p-5'

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
  const members = useMembers(houseId)
  const future = useCategoryHistory(houseId, addMonths(month, 1), addMonths(month, 3))
  const wallets = useWallets(houseId)
  const transfers = useTransfers(houseId, month)
  const transferActions = useTransferActions(houseId)
  const adjustments = useAdjustments(houseId, month)
  const adjustmentActions = useAdjustmentActions(houseId)
  const reserve = useReserve(houseId, month)
  const toast = useToast()
  const desktop = useIsDesktop()
  const [picked, setPicked] = useState<string | null>(null)
  const [transferring, setTransferring] = useState(false)
  // Carteira em conferência de saldo (o painel "Conferir saldo" fica aberto enquanto houver uma).
  const [checking, setChecking] = useState<WalletBalance | null>(null)

  if (!house) return null
  const canWrite = house.role !== 'viewer'
  const walletList = wallets.data ?? []
  const nameOf = (id: string) => walletName(walletList, id)
  const canTransfer = canWrite && walletList.filter((w) => !w.archived).length >= 2

  function deleteTransfer(t: Transfer) {
    transferActions.remove.mutate(t.id, {
      onSuccess: () =>
        toast({ message: 'Transferência excluída.', actionLabel: 'Desfazer', onAction: () => transferActions.restore.mutate(t.id) }),
      onError: () => toast({ message: 'Não foi possível excluir a transferência. Tente de novo.' }),
    })
  }
  // No computador o formulário abre na lateral; no celular, sobe da base (como os outros formulários).
  const TransferPanel = desktop ? SlideOver : Sheet
  // Conferir saldo: só quem escreve, só até o mês atual (um mês que não chegou não tem o que conferir), nunca arquivada.
  const canCheck = canWrite && month <= currentMonth()

  function afterCheck(adj: WalletAdjustment) {
    const name = checking?.name ?? nameOf(adj.walletId)
    setChecking(null)
    toast({
      message: `Saldo de ${name} conferido: ajuste de ${formatSignedCents(adj.amountCents)} em ${monthName(adj.competenceMonth)}.`,
      actionLabel: 'Desfazer',
      onAction: () => adjustmentActions.remove.mutate(adj.id),
    })
  }
  function deleteAdjustment(adj: WalletAdjustment) {
    adjustmentActions.remove.mutate(adj.id, {
      onSuccess: () =>
        toast({ message: 'Ajuste de saldo excluído.', actionLabel: 'Desfazer', onAction: () => adjustmentActions.restore.mutate(adj.id) }),
      onError: () => toast({ message: 'Não foi possível excluir o ajuste. Tente de novo.' }),
    })
  }

  function afterTransfer(result: TransferResult, sent: TransferInput) {
    setTransferring(false)
    const warn = result.warnings?.includes('wallet_balance_insufficient') ? ' Atenção: o saldo dela ficou negativo.' : ''
    toast({
      message: `${formatCents(sent.amountCents)} transferidos de ${nameOf(sent.fromWalletId)} para ${nameOf(sent.toWalletId)}.${warn}`,
      actionLabel: 'Desfazer',
      onAction: () => transferActions.remove.mutate(result.transfer.id),
    })
  }
  const s = summary.data
  const cats = categories.data ?? []
  // Investimento fica à parte: não paga conta nem recebe receita, então não entra no saldo projetado do mês (o aporte já
  // sai da carteira de origem como transferência).
  const regular = s ? s.wallets.filter((w) => w.kind !== 'investment') : []
  const investments = s ? s.wallets.filter((w) => w.kind === 'investment') : []
  // Taxas de referência (BrasilAPI pelo servidor) só quando há investimento para comparar.
  const rates = useReferenceRates(investments.length > 0).data
  const cdi = rates?.rates.find((r) => r.code === 'cdi')?.basisPoints
  const noIncome = s !== undefined && regular.every((w) => w.expectedIncomeCents === 0)
  const rows = rollup(s?.byCategory ?? [], cats)
  const projected = regular.reduce((sum, w) => sum + w.projectedCents, 0)
  // No computador o painel nunca fica vazio: sem escolha, mostra a categoria que mais pesa.
  const selected = picked ?? (desktop ? (rows[0]?.id ?? null) : null)
  const selectedName = selected ? (cats.find((c) => c.id === selected)?.name ?? 'Sem categoria') : ''
  const ahead = future.data ? commitments(future.data) : []
  const aheadTotal = ahead.reduce((sum, m) => sum + m.cents, 0)

  return (
    <AppShell>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-36 pt-2 md:max-w-[1600px] md:gap-8 md:px-8 md:pb-10 md:pt-8">
        <header>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <MonthSelector month={month} onChange={setMonth} />
            {canTransfer && (
              <Button variant="secondary" onClick={() => setTransferring(true)}>
                <ArrowLeftRight aria-hidden="true" size={18} strokeWidth={1.5} /> Transferir
              </Button>
            )}
          </div>
          <p className="mt-2 hidden text-sm text-muted md:block">Resumo do mês: o que entra, o que sai e para onde vai.</p>
        </header>

        {summary.isPending && <ListSkeleton label="Carregando o resumo" rows={4} />}
        {summary.isError && <Notice onRetry={() => void summary.refetch()}>Não foi possível carregar o resumo.</Notice>}

        {s && (
          <>
            {noIncome && (
              <p className="rounded-md bg-sunken p-4 text-sm text-muted">
                Ainda não há receitas neste mês, então o saldo mostra só o que sai. Cadastre o salário e o vale em{' '}
                <Link to="/receitas" className="font-semibold text-accent underline underline-offset-2">
                  receitas
                </Link>
                .
              </p>
            )}

            {/* UM destaque (o saldo projetado, em `alert-text` se vai faltar) e, ao lado, sem caixa, a pagar · atrasado · pago. */}
            <section aria-label="Destaques do mês" className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:gap-8">
              <Surface className="flex min-w-0 flex-col gap-2">
                <Eyebrow as="h2" tone={projected < 0 ? 'alert' : 'muted'}>saldo projetado</Eyebrow>
                <p className={`font-mono text-figure font-semibold tracking-tight tabular-nums md:text-figure-lg ${projected < 0 ? 'text-alert-text' : 'text-heading'}`}>
                  {formatCents(Math.abs(projected))}
                </p>
                <p className="flex items-center gap-2 text-ui text-muted">
                  {projected < 0 ? (
                    <>
                      <span className="font-mono text-alert" aria-hidden="true">[ ✖ ]</span> <span className="font-medium text-alert-text">vai faltar no mês</span>
                    </>
                  ) : (
                    <>
                      <span className="font-mono text-accent" aria-hidden="true">[ ▪ ]</span> deve sobrar no mês
                    </>
                  )}
                </p>
                <p className="mt-2 text-meta text-muted">
                  Projetado = tudo o que está previsto para entrar menos o que já foi pago e o que falta pagar no mês.
                </p>
              </Surface>
              <div className="flex min-w-0 flex-col divide-y divide-line px-1 lg:px-0">
                <Stat label="a pagar" value={formatCents(s.totalPendingCents)} size="sm" note="inclui as atrasadas" className="pb-4" />
                <Stat
                  label="atrasado"
                  value={formatCents(s.overdueCents)}
                  emphasis={s.overdueCount > 0 ? 'alert' : 'muted'}
                  size="sm"
                  note={
                    s.overdueCount > 0 ? (
                      <>
                        <span className="font-mono text-alert" aria-hidden="true">[ ✖ ]</span> {s.overdueCount === 1 ? '1 conta vencida' : `${s.overdueCount} contas vencidas`}
                      </>
                    ) : (
                      'nenhuma conta vencida'
                    )
                  }
                  className="py-4"
                />
                <Stat label="pago" value={formatCents(s.totalPaidCents)} size="sm" note="valor efetivamente pago" className="pt-4" />
              </div>
            </section>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {regular.map((w) => (
                <WalletCard
                  key={w.walletId}
                  title={w.name}
                  hint={w.isDefault ? 'carteira padrão' : (members.data?.find((m) => m.userId === w.ownerUserId)?.name ?? '')}
                  balance={w}
                  month={month}
                  tone={w.isDefault ? 'dark' : 'light'}
                  onCheck={canCheck && !w.archived ? () => setChecking(w) : undefined}
                />
              ))}
            </div>
            {investments.length > 0 && (
              <section aria-label="Investimentos" className="flex flex-col gap-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className={label}>investimentos</h2>
                  <p className="font-mono text-ui tabular-nums text-muted">
                    total {formatCents(investments.reduce((sum, w) => sum + w.balanceCents, 0))}
                  </p>
                </div>
                {rates && rates.rates.length > 0 && (
                  <p className="text-meta text-muted">
                    referências{rates.available ? '' : ' (última leitura)'}:{' '}
                    {rates.rates.map((r, i) => (
                      <span key={r.code}>
                        {i > 0 && ' · '}
                        {r.name} <span className="font-mono tabular-nums">{formatBasisPoints(r.basisPoints)}</span> {r.code === 'ipca' ? 'em 12 meses' : 'ao ano'}
                      </span>
                    ))}{' '}
                    (BrasilAPI)
                  </p>
                )}
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {investments.map((w) => (
                    <InvestmentCard key={w.walletId} balance={w} cdi={cdi} institution={walletList.find((x) => x.id === w.walletId)?.institution ?? undefined}
                      onCheck={canCheck && !w.archived ? () => setChecking(w) : undefined} />
                  ))}
                </div>
              </section>
            )}
            {reserve.data && <ReserveBlock reserve={reserve.data} />}
            <TransfersSection transfers={transfers.data ?? []} walletName={nameOf} canWrite={canWrite} onDelete={deleteTransfer} />
            <AdjustmentsSection adjustments={adjustments.data ?? []} walletName={nameOf} canWrite={canWrite} onDelete={deleteAdjustment} />
            {desktop && (
              <div className={card}>
                <HistoryPanel houseId={houseId} month={month} categoryId={null} categories={cats} />
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              <section aria-label="Por categoria" className={card}>
                <h2 className={label}>para onde vai o dinheiro</h2>
                {s.byCategory.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">Nenhuma conta neste mês.</p>
                ) : (
                  <>
                    <p className="mt-1 text-meta text-muted">Selecione uma categoria para ver o histórico.</p>
                    <div className="mt-3">
                      <CategoryBreakdown rows={rows} split onSelect={setPicked} selectedId={selected} />
                    </div>
                  </>
                )}
                <p className="mt-3 flex items-center gap-4 text-meta text-muted">
                  <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-xs bg-done" />pago</span>
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
                  <ButtonLink to="/parcelas" variant="quiet" size="sm">
                    ver parcelas e fixas
                  </ButtonLink>
                </div>
                <p className="mt-1 font-mono text-title font-semibold tabular-nums text-heading">{formatCents(aheadTotal)}</p>
                <p className="text-meta text-muted">em parcelas e contas fixas nos próximos 3 meses</p>
                <ul className="mt-3 grid grid-cols-3 gap-3 text-sm">
                  {ahead.map((m) => (
                    <li key={m.month} className="border-t border-line pt-2">
                      <span className="block text-meta text-muted">{monthShort(m.month)}</span>
                      <span className="font-mono tabular-nums text-ink">{formatCents(m.cents)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {transferring && (
              <TransferPanel title="Transferir entre carteiras" subtitle={monthLabel(month)} onClose={() => setTransferring(false)}>
                <TransferForm wallets={walletList} month={month} onCreate={(body) => transferActions.create.mutateAsync(body)} onDone={afterTransfer} />
              </TransferPanel>
            )}

            {checking && (
              <TransferPanel title="Conferir saldo" subtitle={`${checking.name} · ${monthLabel(month)}`} onClose={() => setChecking(null)}>
                <BalanceCheckForm balance={checking} month={month} onCreate={(body) => adjustmentActions.create.mutateAsync(body)} onDone={afterCheck} />
              </TransferPanel>
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
