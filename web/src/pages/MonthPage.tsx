import { useMemo, useState } from 'react'
import { useCategories, useInvoiceActions, useInvoices } from '../api/queries'
import type { Invoice } from '../api/types'
import { useAuth } from '../auth/context'
import { AppShell } from '../components/AppShell'
import { Button } from '../components/Button'
import { InvoiceForm } from '../components/InvoiceForm'
import { InvoiceSheet } from '../components/InvoiceSheet'
import { MonthRuler } from '../components/MonthRuler'
import { MonthSelector } from '../components/MonthSelector'
import { PaidGauge } from '../components/PaidGauge'
import { Timeline } from '../components/Timeline'
import { useToast } from '../components/toastContext'
import { currentMonth, todayISO } from '../lib/dates'
import { formatCents } from '../lib/money'
import { useIsDesktop } from '../lib/useIsDesktop'
import { useMonthParam } from '../lib/useMonthParam'

type Editing = { kind: 'new' } | { kind: 'edit'; id: string } | null
type Filter = 'all' | 'open' | 'paid'

const walletLabel = { free: 'carteira livre', benefit: 'carteira de benefício' } as const
const label = 'text-xs font-medium uppercase tracking-wider'

/**
 * A visão do mês. O mês escolhido fica na URL (?mes=2026-10): voltar e compartilhar funcionam.
 * Celular: número principal, régua, filtros e a linha de prumo; o cadastro sobe num painel.
 * Computador: blocos de números, régua em largura total e, ao lado da lista, o detalhe da conta (sem janela por cima).
 */
export default function MonthPage() {
  const { session } = useAuth()
  const [editing, setEditing] = useState<Editing>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const toast = useToast()
  const desktop = useIsDesktop()

  const [month, setMonth] = useMonthParam()
  const today = todayISO()
  const isCurrent = month === currentMonth()
  const house = session.status === 'authenticated' ? session.me.households[0] : undefined
  const houseId = house?.id ?? ''

  const categories = useCategories(houseId)
  const invoices = useInvoices(houseId, month)
  const actions = useInvoiceActions(houseId)

  const categoryById = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c])), [categories.data])
  const list = useMemo(() => invoices.data ?? [], [invoices.data])
  const counts = useMemo(
    () => ({ all: list.length, open: list.filter((i) => i.status !== 'paid').length, paid: list.filter((i) => i.status === 'paid').length }),
    [list],
  )
  const visible = useMemo(
    () => list.filter((i) => (filter === 'all' ? true : filter === 'paid' ? i.status === 'paid' : i.status !== 'paid')),
    [list, filter],
  )
  const byCategory = useMemo(() => {
    const sums = new Map<string, number>()
    for (const i of list) sums.set(i.categoryId, (sums.get(i.categoryId) ?? 0) + i.amountCents)
    return [...sums.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [list])

  if (!house) return null
  const canWrite = house.role !== 'viewer'
  const total = list.reduce((s, i) => s + i.amountCents, 0)
  const toPay = list.filter((i) => i.status !== 'paid').reduce((s, i) => s + i.amountCents, 0)
  const paidTotal = list.filter((i) => i.status === 'paid').reduce((s, i) => s + (i.paid?.amountCents ?? i.amountCents), 0)
  const overdueCount = list.filter((i) => i.status === 'overdue').length
  const fraction = total > 0 ? list.filter((i) => i.status === 'paid').reduce((s, i) => s + i.amountCents, 0) / total : 0
  const busy = actions.pay.isPending || actions.unpay.isPending
  const editingInvoice = editing?.kind === 'edit' ? list.find((i) => i.id === editing.id) : undefined
  const formCategories = (categories.data ?? []).filter((c) => !c.archived || c.id === editingInvoice?.categoryId)

  // Um toque: paga com a carteira sugerida pela categoria (Mercado -> benefício); sem sugestão, a livre.
  function togglePaid(inv: Invoice) {
    if (inv.status === 'paid') {
      actions.unpay.mutate(inv.id, { onError: () => toast({ message: 'Não foi possível desfazer o pagamento.' }) })
      return
    }
    const wallet = categoryById.get(inv.categoryId)?.defaultWallet ?? 'free'
    actions.pay.mutate(
      { id: inv.id, wallet },
      {
        onSuccess: (result) =>
          toast({
            // O servidor avisa (sem bloquear) quando o saldo de benefício do mês fica negativo.
            message: result?.warnings?.includes('benefit_balance_insufficient')
              ? `${inv.description} paga na ${walletLabel[wallet]}. Atenção: o saldo de benefício deste mês ficou negativo.`
              : `${inv.description} paga na ${walletLabel[wallet]}.`,
            actionLabel: 'Desfazer',
            onAction: () => actions.unpay.mutate(inv.id),
          }),
        onError: () => toast({ message: 'Não foi possível marcar como paga. Tente de novo.' }),
      },
    )
  }

  function remove(inv: Invoice) {
    actions.remove.mutate(inv.id, {
      onSuccess: () => {
        setEditing(null)
        toast({ message: `${inv.description} excluída.`, actionLabel: 'Desfazer', onAction: () => actions.restore.mutate(inv.id) })
      },
      onError: () => toast({ message: 'Não foi possível excluir.' }),
    })
  }

  const formProps = {
    month,
    categories: formCategories,
    invoice: editingInvoice,
    canWrite,
    onDone: () => setEditing(null),
    onCreate: (body: Parameters<typeof actions.create.mutateAsync>[0]) => actions.create.mutateAsync(body),
    onUpdate: (id: string, body: Parameters<typeof actions.update.mutateAsync>[0]['body']) => actions.update.mutateAsync({ id, body }),
    onDelete: remove,
    onUnpay: (inv: Invoice) => actions.unpay.mutate(inv.id, { onSuccess: () => !desktop && setEditing(null) }),
    onPay: (inv: Invoice) => {
      togglePaid(inv)
      if (!desktop) setEditing(null)
    },
  }
  const formReady = categories.isSuccess && (editing?.kind === 'new' || editingInvoice !== undefined)
  const empty = invoices.isSuccess && list.length === 0

  const filters: Array<[Filter, string]> = [['all', 'Todas'], ['open', 'A pagar'], ['paid', 'Pagas']]

  return (
    <AppShell>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pb-36 pt-2 md:max-w-none md:gap-6 md:px-10 md:pb-10 md:pt-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <MonthSelector month={month} onChange={setMonth} />
          {desktop && canWrite && (
            <Button onClick={() => setEditing({ kind: 'new' })} className="flex items-center gap-2">
              <span aria-hidden="true" className="text-xl leading-none">+</span> Nova conta
            </Button>
          )}
        </header>

        {/* Números */}
        <section aria-label="Resumo do mês" className="grid gap-4 md:grid-cols-3">
          <div className="rounded-md px-1 md:bg-teal md:px-4 md:py-4 md:text-ivory">
            <div className={`flex justify-between ${label} text-graphite/80 md:text-ivory/85`}>
              <span>a pagar neste mês</span>
              <span className="font-mono">{Math.round(fraction * 100)}% pago</span>
            </div>
            <p className="font-mono text-[40px] font-semibold leading-tight tracking-tight tabular-nums text-teal md:text-ivory">{formatCents(toPay)}</p>
            <PaidGauge fraction={fraction} tone={desktop ? 'dark' : 'light'} className="mt-2" />
            <p className="mt-1.5 flex justify-between text-xs text-graphite/80 md:hidden">
              <span>{counts.paid} de {counts.all} contas pagas</span>
              <span className="font-mono">de {formatCents(total)}</span>
            </p>
          </div>
          <div className="hidden rounded-md border border-graphite/20 p-4 md:block">
            <p className={`${label} text-graphite/80`}>pago</p>
            <p className="font-mono text-[38px] font-semibold leading-tight tracking-tight tabular-nums text-cobalt">{formatCents(paidTotal)}</p>
            <p className="mt-2.5 text-[13px] text-graphite/80">{counts.paid} de {counts.all} contas</p>
          </div>
          <div className="hidden rounded-md border border-graphite/20 p-4 md:block">
            <p className={`${label} text-graphite/80`}>total do mês</p>
            <p className="font-mono text-[38px] font-semibold leading-tight tracking-tight tabular-nums">{formatCents(total)}</p>
            <p className="mt-2.5 flex items-center gap-2 text-[13px] text-graphite/80">
              <span aria-hidden="true" className="size-2.5 rounded-xs bg-signal" />
              {overdueCount === 0 ? 'nenhuma conta atrasada' : `${overdueCount} ${overdueCount === 1 ? 'conta atrasada' : 'contas atrasadas'}`}
            </p>
          </div>
        </section>

        {/* Régua do mês */}
        <section aria-label="Régua do mês" className="rounded-md border border-graphite/15 px-2.5 pb-1.5 pt-2.5 md:border-graphite/20 md:px-4 md:pb-3 md:pt-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className={`${label} text-graphite/80`}>régua do mês</h2>
            <p className="hidden items-center gap-4 text-xs text-graphite/85 md:flex">
              <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-xs bg-teal" />paga</span>
              <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-xs bg-cobalt" />a vencer</span>
              <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-xs bg-signal" />atrasada</span>
            </p>
            <p className="text-[11px] text-graphite/75 md:hidden">cada barra é um dia</p>
          </div>
          <MonthRuler invoices={list} month={month} todayDay={isCurrent ? Number(today.slice(8, 10)) : undefined} barArea={desktop ? 112 : 52} />
        </section>

        {invoices.isPending && <p role="status" className="text-sm text-graphite/70">carregando…</p>}
        {invoices.isError && (
          <p role="alert" className="rounded-md border border-signal/60 bg-signal/10 px-3 py-2 text-sm">
            <span className="font-mono text-signal">[ ✖ ]</span> Não foi possível carregar as contas.{' '}
            <button className="font-semibold underline" onClick={() => void invoices.refetch()}>
              Tentar de novo
            </button>
          </p>
        )}

        <div className="flex flex-col gap-6 md:flex-row md:items-start">
          <section aria-label="Contas do mês" className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
              <h2 className="hidden font-display text-[26px] font-bold text-teal font-stretch-condensed md:block">Contas do mês</h2>
              <div role="group" aria-label="Filtrar contas" className="flex gap-2">
                {filters.map(([key, text]) => (
                  <button
                    key={key}
                    aria-pressed={filter === key}
                    onClick={() => setFilter(key)}
                    className={`h-10 rounded-md border px-3.5 text-[13px] ${filter === key ? 'border-teal bg-teal font-semibold text-ivory' : 'border-graphite/30 font-medium'}`}
                  >
                    {text} <span className="font-mono opacity-85">{counts[key]}</span>
                  </button>
                ))}
              </div>
            </div>
            {empty && (
              <p className="mt-2 rounded-md border border-dashed border-graphite/25 p-4 text-sm text-graphite/70">
                Nenhuma conta neste mês.{canWrite ? ' Toque em + para adicionar a primeira.' : ''}
              </p>
            )}
            <Timeline
              invoices={visible}
              categoryName={(id) => categoryById.get(id)?.name ?? 'Sem categoria'}
              today={isCurrent ? today : undefined}
              selectedId={desktop && editing?.kind === 'edit' ? editing.id : undefined}
              canWrite={canWrite}
              busy={busy}
              onTogglePaid={togglePaid}
              onOpen={(inv) => setEditing({ kind: 'edit', id: inv.id })}
            />
          </section>

          {desktop && (
            <aside className="flex w-full shrink-0 flex-col gap-4 md:sticky md:top-6 md:w-[360px] lg:w-[400px]">
              {formReady ? (
                <section aria-label="Detalhes da conta" className="rounded-md border-2 border-teal bg-white/30 p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h2 className="font-display text-[22px] font-bold text-teal font-stretch-condensed">
                      {editingInvoice ? editingInvoice.description : 'Nova conta'}
                    </h2>
                    <button aria-label="Fechar detalhes" onClick={() => setEditing(null)} className="flex size-9 items-center justify-center rounded-md text-xl hover:bg-graphite/5">
                      ×
                    </button>
                  </div>
                  <InvoiceForm key={editingInvoice ? editingInvoice.id : 'nova'} {...formProps} />
                </section>
              ) : (
                <p className="rounded-md border border-dashed border-graphite/25 p-4 text-sm text-graphite/75">
                  Toque numa conta para ver os detalhes{canWrite ? ', ou em Nova conta para lançar uma' : ''}.
                </p>
              )}
              {byCategory.length > 0 && (
                <section aria-label="Por categoria" className="rounded-md border border-graphite/20 p-4">
                  <h2 className={`${label} mb-3 text-graphite/80`}>por categoria</h2>
                  <ul className="flex flex-col gap-2.5">
                    {byCategory.map(([id, sum]) => (
                      <li key={id}>
                        <p className="flex justify-between text-[13px]">
                          <span className="font-medium">{categoryById.get(id)?.name ?? 'Sem categoria'}</span>
                          <span className="font-mono tabular-nums">{formatCents(sum)}</span>
                        </p>
                        <span className="mt-1 block h-2 rounded-xs bg-graphite/10">
                          <span className="block h-2 rounded-xs bg-cobalt" style={{ width: `${Math.round((sum / byCategory[0][1]) * 100)}%` }} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </aside>
          )}
        </div>
      </main>

      {!desktop && canWrite && (
        <button
          aria-label="Nova conta"
          onClick={() => setEditing({ kind: 'new' })}
          className="fixed bottom-24 right-4 z-30 flex size-14 items-center justify-center rounded-md bg-teal text-3xl leading-none text-ivory shadow-[0_2px_0_var(--color-graphite)] hover:bg-teal/90"
        >
          +
        </button>
      )}

      {!desktop && editing && formReady && <InvoiceSheet {...formProps} />}
    </AppShell>
  )
}
