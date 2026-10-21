import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useCategories, useInvoiceActions, useInvoices } from '../api/queries'
import type { Invoice } from '../api/types'
import { useAuth } from '../auth/context'
import { AppShell } from '../components/AppShell'
import { InvoiceRow } from '../components/InvoiceRow'
import { InvoiceSheet } from '../components/InvoiceSheet'
import { MonthSelector } from '../components/MonthSelector'
import { useToast } from '../components/toastContext'
import { currentMonth, monthFromParam, monthToParam } from '../lib/dates'
import { formatCents } from '../lib/money'

type Editing = { kind: 'new' } | { kind: 'edit'; invoice: Invoice } | null

const walletLabel = { free: 'carteira livre', benefit: 'carteira de benefício' } as const

/** Tela principal: a visão do mês. O mês escolhido fica na URL (?mes=2026-10): voltar e compartilhar funcionam. */
export default function MonthPage() {
  const { session } = useAuth()
  const [params, setParams] = useSearchParams()
  const [editing, setEditing] = useState<Editing>(null)
  const toast = useToast()

  const month = monthFromParam(params.get('mes')) ?? currentMonth()
  const house = session.status === 'authenticated' ? session.me.households[0] : undefined
  const houseId = house?.id ?? ''

  const categories = useCategories(houseId)
  const invoices = useInvoices(houseId, month)
  const actions = useInvoiceActions(houseId)

  const categoryById = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c])), [categories.data])
  const groups = useMemo(() => {
    const list = invoices.data ?? []
    return {
      overdue: list.filter((i) => i.status === 'overdue'),
      pending: list.filter((i) => i.status === 'pending'),
      paid: list.filter((i) => i.status === 'paid'),
    }
  }, [invoices.data])

  if (!house) return null
  const canWrite = house.role !== 'viewer'
  const toPay = [...groups.overdue, ...groups.pending].reduce((sum, i) => sum + i.amountCents, 0)
  const paidTotal = groups.paid.reduce((sum, i) => sum + (i.paid?.amountCents ?? i.amountCents), 0)
  const busy = actions.pay.isPending || actions.unpay.isPending

  const setMonth = (m: string) => setParams(m === currentMonth() ? {} : { mes: monthToParam(m) }, { replace: true })

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
        onSuccess: () =>
          toast({
            message: `${inv.description} paga na ${walletLabel[wallet]}.`,
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

  function unpayFromSheet(inv: Invoice) {
    actions.unpay.mutate(inv.id, { onSuccess: () => setEditing(null) })
  }

  const section = (title: string, list: Invoice[], tone = '') =>
    list.length > 0 && (
      <section aria-label={title} className="rounded-md border border-graphite/15 px-3">
        <h2 className={`pt-3 text-xs font-medium uppercase tracking-wider ${tone || 'text-graphite/70'}`}>
          {title} · {list.length}
        </h2>
        <ul>
          {list.map((i) => (
            <InvoiceRow
              key={i.id}
              invoice={i}
              categoryName={categoryById.get(i.categoryId)?.name ?? 'Sem categoria'}
              canWrite={canWrite}
              busy={busy}
              onTogglePaid={togglePaid}
              onOpen={(inv) => setEditing({ kind: 'edit', invoice: inv })}
            />
          ))}
        </ul>
      </section>
    )

  const empty = invoices.isSuccess && invoices.data.length === 0

  return (
    <AppShell>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 pb-28 pt-5 md:max-w-5xl md:px-10 md:pt-8">
        <MonthSelector month={month} onChange={setMonth} />

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md border border-graphite/15 p-3">
            <p className="text-xs font-medium uppercase tracking-wider text-graphite/70">a pagar</p>
            <p className="mt-1 font-mono text-xl font-bold tabular-nums">{formatCents(toPay)}</p>
          </div>
          <div className="rounded-md border border-graphite/15 p-3">
            <p className="text-xs font-medium uppercase tracking-wider text-graphite/70">pago</p>
            <p className="mt-1 font-mono text-xl font-bold tabular-nums text-cobalt">{formatCents(paidTotal)}</p>
          </div>
        </div>

        {invoices.isPending && <p role="status" className="text-sm text-graphite/70">carregando…</p>}
        {invoices.isError && (
          <p role="alert" className="rounded-md border border-signal/60 bg-signal/10 px-3 py-2 text-sm">
            <span className="font-mono text-signal">[ ✖ ]</span> Não foi possível carregar as contas.{' '}
            <button className="font-semibold underline" onClick={() => void invoices.refetch()}>
              Tentar de novo
            </button>
          </p>
        )}
        {empty && (
          <p className="rounded-md border border-dashed border-graphite/25 p-4 text-sm text-graphite/70">
            Nenhuma conta neste mês.{canWrite ? ' Toque em + para adicionar a primeira.' : ''}
          </p>
        )}

        {section('Atrasadas', groups.overdue, 'text-signal')}
        {section('A vencer', groups.pending)}
        {section('Pagas', groups.paid)}
      </main>

      {canWrite && (
        <button
          aria-label="Nova conta"
          onClick={() => setEditing({ kind: 'new' })}
          className="fixed bottom-6 right-4 z-30 h-14 w-14 rounded-md bg-teal text-3xl leading-none text-ivory hover:bg-teal/90 md:right-8"
        >
          +
        </button>
      )}

      {editing && categories.data && (
        <InvoiceSheet
          month={month}
          categories={categories.data.filter((c) => !c.archived || (editing.kind === 'edit' && c.id === editing.invoice.categoryId))}
          invoice={editing.kind === 'edit' ? editing.invoice : undefined}
          canWrite={canWrite}
          onClose={() => setEditing(null)}
          onCreate={(body) => actions.create.mutateAsync(body)}
          onUpdate={(id, body) => actions.update.mutateAsync({ id, body })}
          onDelete={remove}
          onUnpay={unpayFromSheet}
        />
      )}
    </AppShell>
  )
}
