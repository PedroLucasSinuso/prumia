import { useEffect, useState } from 'react'

import { useCategories, useInvoiceActions, usePayees, useRecurrenceActions, usePurchases, useRecurrences } from '../api/queries'
import type { Invoice, Purchase, Recurrence } from '../api/types'
import { useActiveHouse } from '../auth/useActiveHouse'
import { AppShell } from '../components/AppShell'
import { Button } from '../components/ui/Button'
import { InvoiceForm } from '../components/InvoiceForm'
import { RecurrenceForm } from '../components/RecurrenceForm'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/toastContext'
import { EmptyState } from '../components/ui/EmptyState'
import { ListSkeleton } from '../components/ui/ListSkeleton'
import { Notice } from '../components/ui/Notice'
import { SectionRule } from '../components/ui/SectionRule'
import { SectionTitle } from '../components/ui/SectionTitle'
import { currentMonth, dayMonth, fullDate, monthLabel } from '../lib/dates'
import { formatCents } from '../lib/money'


/** Valor da parcela: o das invoices geradas, ou total/parcelas se todas foram excluídas. */
function installmentValue(p: Purchase): number {
  const first = p.installments[0]
  return first ? first.amountCents : Math.floor(p.totalAmountCents / p.installmentsCount)
}

function PurchaseItem({ purchase }: { purchase: Purchase }) {
  // A listagem já traz as parcelas (não excluídas, em ordem): "n de N pagas" e a lista não dependem de outra consulta.
  const parcels: Invoice[] = purchase.installments
  const paid = parcels.filter((i) => i.status === 'paid').length
  return (
    <li className="border-t border-line first:border-t-0">
      <details>
        <summary className="-mx-2 flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-sm px-2 py-2 transition-colors hover:bg-raised [&::-webkit-details-marker]:hidden">
          <span className="min-w-0">
            <span className="block truncate text-body font-medium text-ink">{purchase.description}</span>
            <span className="block truncate text-meta text-muted">
              comprada em {fullDate(purchase.purchaseDate)}
              {` · ${paid} de ${purchase.installmentsCount} pagas`}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block font-mono text-body font-semibold tabular-nums text-ink">{purchase.installmentsCount}x {formatCents(installmentValue(purchase))}</span>
            <span className="block text-caption text-muted">total {formatCents(purchase.totalAmountCents)}</span>
          </span>
        </summary>
        {parcels.length === 0 && <p className="mb-2 ml-1 text-ui text-muted">Todas as parcelas foram excluídas.</p>}
        {parcels.length > 0 && (
          <ul aria-label={`Parcelas de ${purchase.description}`} className="mb-2 ml-1 border-l border-line-strong pl-3">
            {parcels.map((i) => (
              <li key={i.id} className="flex justify-between gap-3 py-1 text-ui">
                <span>
                  <span aria-hidden="true" className={`font-mono text-meta ${i.status === 'paid' ? 'text-accent' : 'text-muted'}`}>{i.status === 'paid' ? '[ ▪ ]' : '[ ▫ ]'}</span> {i.series?.installmentNumber}/{purchase.installmentsCount} · vence {dayMonth(i.dueDate)}
                </span>
                <span className="font-mono tabular-nums">{formatCents(i.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </li>
  )
}

/**
 * Parcelas e contas fixas. As compras parceladas respondem "quando comprei o notebook?" (busca por nome) e mostram
 * cada parcela; as contas fixas (aluguel, internet) listam o molde mensal e deixam ajustar valor, dia e fim.
 */
export default function SeriesPage() {
  const toast = useToast()
  const { house } = useActiveHouse()
  const houseId = house?.id ?? ''

  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  // Espera a pessoa parar de digitar antes de consultar (uma busca por tecla seria desperdício).
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300)
    return () => clearTimeout(t)
  }, [text])

  const purchases = usePurchases(houseId, q)
  const recurrences = useRecurrences(houseId)
  const actions = useRecurrenceActions(houseId)
  const [editing, setEditing] = useState<Recurrence>()
  // Criar daqui reaproveita o formulário de conta (o mesmo do Mês), já no tipo escolhido.
  const [creating, setCreating] = useState<'installments' | 'recurring'>()
  const categories = useCategories(houseId)
  const payees = usePayees(houseId)
  const invoiceActions = useInvoiceActions(houseId)

  if (!house) return null
  const canWrite = house.role !== 'viewer'

  return (
    <AppShell>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-36 pt-4 md:max-w-none md:px-10 md:pb-10 md:pt-8">
        <header>
          <SectionTitle as="h1" size="page" className="leading-none">Parcelas e contas fixas</SectionTitle>
          <p className="mt-1 text-sm text-muted">Compras no cartão e contas que se repetem todo mês.</p>
          {canWrite && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => setCreating('installments')}>Nova compra parcelada</Button>
              <Button variant="secondary" onClick={() => setCreating('recurring')}>Nova conta fixa</Button>
            </div>
          )}
        </header>

        <div className="grid gap-8 md:grid-cols-2 md:items-start">
          <section aria-label="Compras parceladas">
            <SectionRule as="h2" title="Compras parceladas" count={purchases.data?.length} />
            <div className="mt-2">
              <label htmlFor="busca-compra" className="sr-only">Buscar compra</label>
              <input
                id="busca-compra"
                type="search"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Quando comprei… (ex.: notebook)"
                className="h-11 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-ink placeholder:text-muted transition-colors hover:border-ink/50 focus-visible:border-accent md:h-9 md:text-sm"
              />
            </div>
            {purchases.isPending && <ListSkeleton className="mt-3" label="Carregando as compras" />}
            {purchases.isError && <Notice className="mt-3" onRetry={() => void purchases.refetch()}>Não foi possível carregar as compras.</Notice>}
            {purchases.isSuccess && purchases.data.length === 0 && (
              <EmptyState compact className="mt-3" title={q ? `Nenhuma compra com “${q}”.` : 'Nenhuma compra parcelada ainda.'} />
            )}
            <ul className="mt-2 flex flex-col">
              {(purchases.data ?? []).map((p) => (
                <PurchaseItem key={p.id} purchase={p} />
              ))}
            </ul>
          </section>

          <section aria-label="Contas fixas">
            <SectionRule as="h2" title="Contas fixas" count={recurrences.data?.length} />
            {recurrences.isPending && <ListSkeleton className="mt-3" label="Carregando as contas fixas" />}
            {recurrences.isError && <Notice className="mt-3" onRetry={() => void recurrences.refetch()}>Não foi possível carregar as contas fixas.</Notice>}
            {recurrences.isSuccess && recurrences.data.length === 0 && <EmptyState compact className="mt-3" title="Nenhuma conta fixa ainda." />}
            <ul className="mt-2 flex flex-col">
              {(recurrences.data ?? []).map((r) => (
                <li key={r.id} className="border-t border-line first:border-t-0">
                  <button aria-label={`Editar ${r.description}`} onClick={() => setEditing(r)} className="-mx-2 flex min-h-14 w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-sm px-2 py-2 text-left transition-colors hover:bg-raised">
                    <span className="min-w-0">
                      <span className="block truncate text-body font-medium text-ink">{r.description}</span>
                      <span className="block truncate text-meta text-muted">
                        todo dia {r.dayOfMonth} · desde {monthLabel(r.startMonth)}
                        {r.endMonth ? ` · até ${monthLabel(r.endMonth)}` : ' · sem fim'}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-body font-semibold tabular-nums text-ink">{formatCents(r.amountCents)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>

      {creating && categories.isSuccess && (
        <Sheet title={creating === 'installments' ? 'Nova compra parcelada' : 'Nova conta fixa'} onClose={() => setCreating(undefined)}>
          <InvoiceForm
            key={creating}
            month={currentMonth()}
            houseId={houseId}
            categories={categories.data.filter((c) => !c.archived)}
            payees={payees.data}
            canWrite={canWrite}
            initialKind={creating}
            onDone={() => setCreating(undefined)}
            onCreate={(body) => invoiceActions.create.mutateAsync(body)}
            onCreatePurchase={(body) => invoiceActions.createPurchase.mutateAsync(body)}
            onCreateRecurrence={(body) => invoiceActions.createRecurrence.mutateAsync(body)}
            // Aqui só se cria: editar/pagar/excluir contas é na tela do mês.
            onUpdate={() => Promise.resolve()}
          />
        </Sheet>
      )}

      {editing && (
        <Sheet title={editing.description} onClose={() => setEditing(undefined)}>
          <RecurrenceForm
            key={editing.id}
            recurrence={editing}
            canWrite={canWrite}
            onSave={(body) => actions.update.mutateAsync({ id: editing.id, body })}
            onDone={() => {
              setEditing(undefined)
              toast({ message: 'Conta fixa atualizada.' })
            }}
          />
        </Sheet>
      )}
    </AppShell>
  )
}
