import { useMemo, useState } from 'react'

import { usePayeeActions, usePayees } from '../api/queries'
import type { Category, Payee } from '../api/types'
import { categoryPath } from '../lib/categories'
import { formatCnpj } from '../lib/cnpj'
import { Button } from './Button'
import { PayeeForm } from './PayeeForm'
import { Sheet } from './Sheet'
import { useToast } from './toastContext'

type Editing = { kind: 'new' } | { kind: 'edit'; id: string } | null

/** Ajustes > Favorecidos: lista, criar, editar, arquivar/restaurar. O formulário abre num painel (Sheet) em qualquer tela. */
export function PayeesSection({ houseId, categories, canWrite }: { houseId: string; categories: Category[]; canWrite: boolean }) {
  const toast = useToast()
  const [editing, setEditing] = useState<Editing>(null)
  const payees = usePayees(houseId)
  const actions = usePayeeActions(houseId)

  const all = useMemo(() => [...(payees.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')), [payees.data])
  const active = all.filter((p) => !p.archived)
  const archived = all.filter((p) => p.archived)
  const categoryName = (id?: string | null) => categoryPath(categories.find((c) => c.id === id), categories)
  const selected = editing?.kind === 'edit' ? all.find((p) => p.id === editing.id) : undefined
  const close = () => setEditing(null)

  const meta = (p: Payee) => [p.legalName, p.cnpj ? formatCnpj(p.cnpj) : 'sem CNPJ', categoryName(p.defaultCategoryId)].filter(Boolean).join(' · ')
  const row = (p: Payee) => (
    <li key={p.id} className="border-t border-ink/10 first:border-t-0">
      <button aria-label={`Abrir favorecido ${p.name}`} onClick={() => setEditing({ kind: 'edit', id: p.id })} className="flex min-h-14 w-full min-w-0 flex-col justify-center px-1 py-2 text-left">
        <span className={`block truncate text-[15px] font-medium ${p.archived ? 'text-ink/70' : ''}`}>{p.name}</span>
        <span className="block truncate text-xs text-ink/75">{meta(p)}</span>
      </button>
    </li>
  )

  return (
    <section aria-label="Favorecidos" className="min-w-0 flex-1 rounded-md border border-ink/20 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-[24px] font-bold text-structure font-stretch-condensed">Favorecidos</h2>
        {canWrite && (
          <Button onClick={() => setEditing({ kind: 'new' })} className="flex items-center gap-2">
            <span aria-hidden="true" className="text-xl leading-none">+</span> Novo favorecido
          </Button>
        )}
      </div>
      <p className="mt-1 text-sm text-ink/80">
        Quem recebe seus pagamentos, com o nome que vocês usam (a distribuidora pode ser o “Gás”). O CNPJ é opcional e ajuda a reconhecer o boleto.
      </p>

      {payees.isPending && <p role="status" className="mt-3 text-sm text-ink/70">carregando…</p>}
      {payees.isError && (
        <p role="alert" className="mt-3 rounded-md border border-alert/60 bg-alert/10 px-3 py-2 text-sm">
          <span className="font-mono text-alert">[ ✖ ]</span> Não foi possível carregar os favorecidos.{' '}
          <button className="h-11 font-semibold underline" onClick={() => void payees.refetch()}>Tentar de novo</button>
        </p>
      )}
      {payees.isSuccess && active.length === 0 && (
        <p className="mt-3 rounded-md border border-dashed border-ink/25 p-4 text-sm text-ink/75">
          Nenhum favorecido ainda{canWrite ? '. Crie o primeiro em Novo favorecido.' : '.'}
        </p>
      )}

      <ul aria-label="Favorecidos ativos" className="mt-3 flex flex-col">{active.map(row)}</ul>

      {archived.length > 0 && (
        <details className="mt-4 border-t border-line pt-2">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-ink/85">arquivados ({archived.length})</summary>
          <ul aria-label="Favorecidos arquivados" className="flex flex-col">{archived.map(row)}</ul>
        </details>
      )}

      {(editing?.kind === 'new' || selected) && (
        <Sheet title={editing?.kind === 'new' ? 'Novo favorecido' : (selected?.name ?? 'Favorecido')} onClose={close}>
          <PayeeForm
            key={selected?.id ?? 'novo'}
            payee={selected}
            categories={categories.filter((c) => !c.archived)}
            canWrite={canWrite}
            onCreate={(body) => actions.create.mutateAsync(body)}
            onUpdate={(id, body) => actions.update.mutateAsync({ id, body })}
            onDone={(message) => { close(); toast({ message }) }}
          />
        </Sheet>
      )}
    </section>
  )
}
