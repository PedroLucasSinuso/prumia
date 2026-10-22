import { useMemo, useState } from 'react'

import { useIncomeActions, useIncomeSources, useIncomes, useMembers, useSourceActions } from '../api/queries'
import type { Income, IncomeKind, IncomeSource } from '../api/types'
import { useAuth } from '../auth/context'
import { useActiveHouse } from '../auth/useActiveHouse'
import { AppShell } from '../components/AppShell'
import { Button } from '../components/Button'
import { IncomeForm } from '../components/IncomeForm'
import { IncomeList } from '../components/IncomeList'
import { MonthSelector } from '../components/MonthSelector'
import { PaidGauge } from '../components/PaidGauge'
import { Sheet } from '../components/Sheet'
import { SourceForm } from '../components/SourceForm'
import { useToast } from '../components/toastContext'
import { incomeTotals, kindLabel, netOf, sumDeductions } from '../lib/income'
import { formatCents } from '../lib/money'
import { useIsDesktop } from '../lib/useIsDesktop'
import { useMonthParam } from '../lib/useMonthParam'

type Editing =
  | { kind: 'income-new' }
  | { kind: 'income'; id: string }
  | { kind: 'source-new'; sourceKind: IncomeKind }
  | { kind: 'source'; id: string }
  | null

const label = 'text-xs font-medium uppercase tracking-wider'

/**
 * Receitas do mês. A ideia central: cadastre o salário UMA vez (a "fonte") e o app prevê os meses seguintes com bruto e
 * descontos; cada mês continua editável (a coparticipação varia). Ao receber, um toque no nó. O líquido é sempre bruto − descontos.
 */
export default function IncomesPage() {
  const { session } = useAuth()
  const [month, setMonth] = useMonthParam()
  const [editing, setEditing] = useState<Editing>(null)
  const toast = useToast()
  const desktop = useIsDesktop()

  const me = session.status === 'authenticated' ? session.me : undefined
  const { house } = useActiveHouse()
  const houseId = house?.id ?? ''

  const incomes = useIncomes(houseId, month)
  const sources = useIncomeSources(houseId)
  const members = useMembers(houseId)
  const actions = useIncomeActions(houseId)
  const sourceActions = useSourceActions(houseId)

  const list = useMemo(() => incomes.data ?? [], [incomes.data])
  const totals = useMemo(() => incomeTotals(list), [list])
  const byWallet = useMemo(
    () => ({
      free: list.filter((i) => i.wallet === 'free' && i.received).reduce((s, i) => s + i.netAmountCents, 0),
      benefit: list.filter((i) => i.wallet === 'benefit' && i.received).reduce((s, i) => s + i.netAmountCents, 0),
    }),
    [list],
  )

  if (!me || !house) return null
  const canWrite = house.role !== 'viewer'
  const memberList = members.data ?? []
  const fraction = totals.expected > 0 ? totals.received / totals.expected : 0
  const busy = actions.receive.isPending || actions.unreceive.isPending
  const editingIncome = editing?.kind === 'income' ? list.find((i) => i.id === editing.id) : undefined
  const editingSource = editing?.kind === 'source' ? (sources.data ?? []).find((s) => s.id === editing.id) : undefined
  const personName = (id: string) => memberList.find((m) => m.userId === id)?.name ?? 'Pessoa'

  function toggleReceived(inc: Income) {
    if (inc.received) {
      actions.unreceive.mutate(inc.id, { onError: () => toast({ message: 'Não foi possível desfazer o recebimento.' }) })
      return
    }
    actions.receive.mutate(inc.id, {
      onSuccess: () => toast({ message: `${inc.description} recebida.`, actionLabel: 'Desfazer', onAction: () => actions.unreceive.mutate(inc.id) }),
      onError: () => toast({ message: 'Não foi possível marcar como recebida. Tente de novo.' }),
    })
  }

  function removeIncome(inc: Income) {
    actions.remove.mutate(inc.id, {
      onSuccess: () => {
        setEditing(null)
        toast({ message: `${inc.description} excluída.` })
      },
      onError: () => toast({ message: 'Não foi possível excluir.' }),
    })
  }

  const close = () => setEditing(null)
  const incomeFormProps = {
    month, members: memberList, defaultUserId: me.id, income: editingIncome, canWrite, onDone: close,
    onCreate: (b: Parameters<typeof actions.create.mutateAsync>[0]) => actions.create.mutateAsync(b),
    onUpdate: (id: string, body: Parameters<typeof actions.update.mutateAsync>[0]['body']) => actions.update.mutateAsync({ id, body }),
    onDelete: removeIncome,
    onReceive: (i: Income) => { toggleReceived(i); if (!desktop) close() },
    onUnreceive: (i: Income) => actions.unreceive.mutate(i.id, { onSuccess: () => !desktop && close() }),
  }
  const sourceFormProps = {
    month, members: memberList, defaultUserId: me.id, source: editingSource,
    defaultKind: editing?.kind === 'source-new' ? editing.sourceKind : ('salary' as IncomeKind),
    canWrite, onDone: close,
    onCreate: (b: Parameters<typeof sourceActions.create.mutateAsync>[0]) => sourceActions.create.mutateAsync(b),
    onUpdate: (id: string, body: Parameters<typeof sourceActions.update.mutateAsync>[0]['body'], applyFrom?: string) =>
      sourceActions.update.mutateAsync({ id, body, applyFrom }),
  }

  const formReady = members.isSuccess && (editing?.kind === 'income-new' || editing?.kind === 'source-new' || editingIncome !== undefined || editingSource !== undefined)
  const panelTitle =
    editing?.kind === 'income-new' ? 'Nova receita' : editing?.kind === 'income' ? (editingIncome?.description ?? 'Receita')
    : editing?.kind === 'source-new' ? 'Nova fonte de receita' : (editingSource?.name ?? 'Fonte de receita')
  const form = !formReady ? null : editing?.kind === 'source-new' || editing?.kind === 'source'
    ? <SourceForm key={editingSource?.id ?? `nova-${editing.kind === 'source-new' ? editing.sourceKind : ''}`} {...sourceFormProps} />
    : <IncomeForm key={editingIncome?.id ?? 'nova'} {...incomeFormProps} />

  const hasSources = (sources.data ?? []).length > 0
  const empty = incomes.isSuccess && list.length === 0

  return (
    <AppShell>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pb-36 pt-2 md:max-w-none md:gap-6 md:px-10 md:pb-10 md:pt-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <MonthSelector month={month} onChange={setMonth} />
          {desktop && canWrite && (
            <Button onClick={() => setEditing({ kind: 'income-new' })} className="flex items-center gap-2">
              <span aria-hidden="true" className="text-xl leading-none">+</span> Nova receita
            </Button>
          )}
        </header>

        {/* Números */}
        <section aria-label="Resumo das receitas" className="grid gap-4 md:grid-cols-3">
          <div className="rounded-md px-1 md:bg-teal md:px-4 md:py-4 md:text-ivory">
            <div className={`flex justify-between ${label} text-graphite/80 md:text-ivory/85`}>
              <span>recebido neste mês</span>
              <span className="font-mono">{Math.round(fraction * 100)}% do previsto</span>
            </div>
            <p className="font-mono text-[40px] font-semibold leading-tight tracking-tight tabular-nums text-teal md:text-ivory">{formatCents(totals.received)}</p>
            <PaidGauge fraction={fraction} tone={desktop ? 'dark' : 'light'} className="mt-2" />
          </div>
          <div className="rounded-md border border-graphite/20 p-4">
            <p className={`${label} text-graphite/80`}>previsto</p>
            <p className="font-mono text-[30px] font-semibold leading-tight tabular-nums md:text-[38px]">{formatCents(totals.expected)}</p>
            <p className="mt-1 text-[13px] text-graphite/80">falta receber {formatCents(totals.pending)}</p>
          </div>
          <div className="rounded-md border border-graphite/20 p-4">
            <p className={`${label} text-graphite/80`}>por carteira (recebido)</p>
            <dl className="mt-1 font-mono text-[15px] tabular-nums">
              <div className="flex justify-between"><dt className="font-sans text-[13px]">livre</dt><dd>{formatCents(byWallet.free)}</dd></div>
              <div className="flex justify-between"><dt className="font-sans text-[13px]">benefício</dt><dd>{formatCents(byWallet.benefit)}</dd></div>
            </dl>
          </div>
        </section>

        {incomes.isPending && <p role="status" className="text-sm text-graphite/70">carregando…</p>}
        {incomes.isError && (
          <p role="alert" className="rounded-md border border-signal/60 bg-signal/10 px-3 py-2 text-sm">
            <span className="font-mono text-signal">[ ✖ ]</span> Não foi possível carregar as receitas.{' '}
            <button className="font-semibold underline" onClick={() => void incomes.refetch()}>Tentar de novo</button>
          </p>
        )}

        <div className="flex flex-col gap-6 md:flex-row md:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-6">
            <section aria-label="Receitas do mês">
              <h2 className="mb-1 hidden font-display text-[26px] font-bold text-teal font-stretch-condensed md:block">Receitas do mês</h2>
              {empty && !hasSources && canWrite && (
                <div className="rounded-md border border-dashed border-graphite/25 p-4">
                  <p className="text-sm text-graphite/85">
                    Cadastre o seu salário <strong>uma vez</strong> e o app prevê os próximos meses, já com os descontos. Você só ajusta o que mudar.
                  </p>
                  <Button className="mt-3" onClick={() => setEditing({ kind: 'source-new', sourceKind: 'salary' })}>
                    Cadastrar salário
                  </Button>
                </div>
              )}
              {empty && (hasSources || !canWrite) && (
                <p className="rounded-md border border-dashed border-graphite/25 p-4 text-sm text-graphite/75">Nenhuma receita neste mês.</p>
              )}
              <IncomeList
                incomes={list}
                members={memberList}
                selectedId={desktop && editing?.kind === 'income' ? editing.id : undefined}
                canWrite={canWrite}
                busy={busy}
                onToggleReceived={toggleReceived}
                onOpen={(i) => setEditing({ kind: 'income', id: i.id })}
              />
            </section>

            <section aria-label="Fontes de receita" className="rounded-md border border-graphite/20 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className={`${label} text-graphite/80`}>previsão mensal · fontes</h2>
                {canWrite && (
                  <button onClick={() => setEditing({ kind: 'source-new', sourceKind: hasSources ? 'benefit' : 'salary' })} className="h-11 text-sm font-semibold text-cobalt underline underline-offset-4">
                    + Nova fonte
                  </button>
                )}
              </div>
              {sources.isSuccess && !hasSources && <p className="mt-1 text-sm text-graphite/75">Nenhuma fonte ainda. Uma fonte gera a previsão do salário (ou do vale) todo mês.</p>}
              <ul className="mt-2 flex flex-col">
                {(sources.data ?? []).map((s: IncomeSource) => (
                  <li key={s.id} className="border-t border-graphite/10 first:border-t-0">
                    <button aria-label={`Editar fonte ${s.name}`} onClick={() => setEditing({ kind: 'source', id: s.id })} className="flex min-h-14 w-full items-center justify-between gap-3 py-2 text-left">
                      <span className="min-w-0">
                        <span className="block truncate text-[15px] font-medium">{s.name}</span>
                        <span className="block truncate text-xs text-graphite/80">
                          {personName(s.userId)} · {kindLabel[s.kind]} · todo dia {s.dayOfMonth}
                          {s.generatedThrough ? ` · previsto até ${s.generatedThrough.slice(5, 7)}/${s.generatedThrough.slice(0, 4)}` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-mono text-[15px] font-semibold tabular-nums">{formatCents(netOf(s.grossAmountCents, s.deductions))}</span>
                        <span className="block text-[11px] text-graphite/75">líquido{sumDeductions(s.deductions) > 0 ? ` (bruto ${formatCents(s.grossAmountCents)})` : ''}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {desktop && (
            <aside className="w-full shrink-0 md:sticky md:top-6 md:w-[380px] lg:w-[420px]">
              {form ? (
                <section aria-label="Detalhes" className="rounded-md border-2 border-teal bg-white/30 p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h2 className="font-display text-[22px] font-bold text-teal font-stretch-condensed">{panelTitle}</h2>
                    <button aria-label="Fechar detalhes" onClick={close} className="flex size-9 items-center justify-center rounded-md text-xl hover:bg-graphite/5">×</button>
                  </div>
                  {form}
                </section>
              ) : (
                <p className="rounded-md border border-dashed border-graphite/25 p-4 text-sm text-graphite/75">
                  Toque numa receita para ver ou ajustar o mês{canWrite ? ', ou em Nova receita para lançar uma avulsa' : ''}.
                </p>
              )}
            </aside>
          )}
        </div>
      </main>

      {!desktop && canWrite && (
        <button
          aria-label="Nova receita"
          onClick={() => setEditing({ kind: 'income-new' })}
          className="fixed bottom-24 right-4 z-30 flex size-14 items-center justify-center rounded-md bg-teal text-3xl leading-none text-ivory shadow-[0_2px_0_var(--color-graphite)] hover:bg-teal/90"
        >
          +
        </button>
      )}
      {!desktop && editing && form && <Sheet title={panelTitle} onClose={close}>{form}</Sheet>}
    </AppShell>
  )
}
