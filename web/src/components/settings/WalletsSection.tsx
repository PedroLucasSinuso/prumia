import { Plus } from 'lucide-react'
import { useState } from 'react'

import { useMembers, useWalletActions, useWallets } from '../../api/queries'
import type { Wallet } from '../../api/types'
import { monthLabel } from '../../lib/dates'
import { ICON } from '../../lib/navigation'
import { Button } from '../ui/Button'
import { useToast } from '../toastContext'
import { WalletForm } from '../WalletForm'
import { DetailLayout, DetailPanel } from './DetailPanel'
import { LoadError, SectionHeader } from './ui'

type Editing = { kind: 'new' } | { kind: 'edit'; id: string } | null

/**
 * Ajustes > Carteiras: onde o dinheiro da casa mora (Geral, Benefício, Reserva...). O saldo de cada uma continua de um mês
 * para o outro. Só o Responsável cria e altera; todo mundo vê.
 */
export function WalletsSection({ houseId, isAdmin, desktop }: { houseId: string; isAdmin: boolean; desktop: boolean }) {
  const toast = useToast()
  const [editing, setEditing] = useState<Editing>(null)
  const wallets = useWallets(houseId)
  const members = useMembers(houseId)
  const actions = useWalletActions(houseId)

  const all = wallets.data ?? []
  const active = all.filter((w) => !w.archived)
  const archived = all.filter((w) => w.archived)
  const selected = editing?.kind === 'edit' ? all.find((w) => w.id === editing.id) : undefined
  const close = () => setEditing(null)
  const panelOpen = editing?.kind === 'new' || selected !== undefined
  const ownerName = (w: Wallet) => members.data?.find((m) => m.userId === w.ownerUserId)?.name

  const item = (w: Wallet) => (
    <li key={w.id} className={`border-t border-line/60 first:border-t-0 ${selected?.id === w.id ? 'bg-accent/8' : ''}`}>
      <button aria-label={`Abrir carteira ${w.name}`} onClick={() => setEditing({ kind: 'edit', id: w.id })} className="flex min-h-14 w-full min-w-0 flex-col justify-center px-3 py-2 text-left">
        <span className={`block truncate text-body font-medium ${w.archived ? 'text-muted' : ''}`}>{w.name}</span>
        <span className="block truncate text-meta text-muted">
          {[w.isDefault ? 'padrão' : null, ownerName(w) ?? 'de todos', w.warnOnOverdraft ? 'avisa saldo negativo' : null, w.openingBalanceMonth ? `começa em ${monthLabel(w.openingBalanceMonth)}` : null].filter(Boolean).join(' · ')}
        </span>
      </button>
    </li>
  )

  return (
    <div>
      <SectionHeader
        title="Carteiras"
        description="Onde o dinheiro da casa fica: uma geral e quantas mais vocês quiserem (benefício, reserva...). Cada receita entra numa carteira e cada conta é paga com uma. O saldo continua de um mês para o outro."
        actions={
          isAdmin && (
            <Button onClick={() => setEditing({ kind: 'new' })} className="flex items-center gap-2 md:h-9">
              <Plus aria-hidden="true" size={18} strokeWidth={ICON.strokeWidth} /> Nova carteira
            </Button>
          )
        }
      />

      <DetailLayout open={desktop && panelOpen}>
        <div className="min-w-0">
          {wallets.isPending && <p role="status" className="text-sm text-muted">carregando…</p>}
          {wallets.isError && <LoadError what="as carteiras" onRetry={() => void wallets.refetch()} />}
          {active.length > 0 && <ul aria-label="Carteiras ativas" className="flex flex-col rounded-md bg-raised">{active.map(item)}</ul>}
          {!isAdmin && wallets.isSuccess && <p className="mt-3 text-meta text-muted">Só o Responsável da casa cria e altera carteiras.</p>}
          {archived.length > 0 && (
            <details className="mt-4 rounded-md bg-sunken px-3">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-muted md:min-h-10">arquivadas ({archived.length})</summary>
              <ul aria-label="Carteiras arquivadas" className="flex flex-col">{archived.map(item)}</ul>
            </details>
          )}
        </div>

        {panelOpen && (
          <DetailPanel desktop={desktop} title={editing?.kind === 'new' ? 'Nova carteira' : (selected?.name ?? 'Carteira')} onClose={close}>
            <WalletForm
              key={selected?.id ?? 'nova'}
              wallet={selected}
              members={members.data ?? []}
              canWrite={isAdmin}
              onCreate={(body) => actions.create.mutateAsync(body)}
              onUpdate={(id, body) => actions.update.mutateAsync({ id, body })}
              onArchive={(id) => actions.archive.mutateAsync(id)}
              onRestore={(id) => actions.restore.mutateAsync(id)}
              onDone={(message) => {
                close()
                toast({ message })
              }}
            />
          </DetailPanel>
        )}
      </DetailLayout>
    </div>
  )
}
