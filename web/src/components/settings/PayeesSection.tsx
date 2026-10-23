import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'

import { usePayeeActions, usePayees } from '../../api/queries'
import type { Category, Payee } from '../../api/types'
import { categoryPath } from '../../lib/categories'
import { formatCnpj } from '../../lib/cnpj'
import { ICON } from '../../lib/navigation'
import { Button } from '../Button'
import { PayeeForm } from '../PayeeForm'
import { useToast } from '../toastContext'
import { DetailLayout, DetailPanel } from './DetailPanel'
import { LoadError, SectionHeader } from './ui'

type Editing = { kind: 'new' } | { kind: 'edit'; id: string } | null

/**
 * Ajustes > Favorecidos: apelido, nome oficial, CNPJ e categoria sugerida. Computador: tabela + painel lateral;
 * celular: lista + painel que sobe.
 */
export function PayeesSection({ houseId, categories, canWrite, desktop }: { houseId: string; categories: Category[]; canWrite: boolean; desktop: boolean }) {
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
  const panelOpen = editing?.kind === 'new' || selected !== undefined
  const open = (p: Payee) => setEditing({ kind: 'edit', id: p.id })

  // Celular: uma linha com o apelido e, embaixo, só o que existe (nada de "sem CNPJ").
  const meta = (p: Payee) => [p.legalName, p.cnpj ? formatCnpj(p.cnpj) : null, categoryName(p.defaultCategoryId)].filter(Boolean).join(' · ')
  const item = (p: Payee) => (
    <li key={p.id} className={`border-t border-line/60 first:border-t-0 ${selected?.id === p.id ? 'bg-accent/8' : ''}`}>
      <button aria-label={`Abrir favorecido ${p.name}`} onClick={() => open(p)} className="flex min-h-14 w-full min-w-0 flex-col justify-center px-2 py-2 text-left">
        <span className={`block truncate text-[15px] font-medium ${p.archived ? 'text-ink/70' : ''}`}>{p.name}</span>
        {meta(p) && <span className="block truncate text-xs text-ink/75">{meta(p)}</span>}
      </button>
    </li>
  )

  const table = (list: Payee[], label: string) => (
    <table aria-label={label} className="w-full table-fixed border-collapse text-sm">
      <thead>
        <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-ink/65">
          <th scope="col" className="w-[24%] px-3 py-2 font-medium">apelido</th>
          <th scope="col" className="px-3 py-2 font-medium">nome oficial</th>
          <th scope="col" className="w-44 px-3 py-2 font-medium">CNPJ</th>
          <th scope="col" className="w-[22%] px-3 py-2 font-medium">categoria sugerida</th>
        </tr>
      </thead>
      <tbody>
        {list.map((p) => (
          <tr
            key={p.id}
            onClick={() => open(p)}
            className={`cursor-pointer border-b border-line/60 last:border-b-0 ${selected?.id === p.id ? 'bg-accent/8' : 'hover:bg-ink/4'}`}
          >
            <td className="truncate px-3 py-2">
              <button aria-label={`Abrir favorecido ${p.name}`} className={`max-w-full truncate text-left font-medium ${p.archived ? 'text-ink/70' : ''}`}>{p.name}</button>
            </td>
            <td className="truncate px-3 py-2 text-ink/80">{p.legalName ?? <span className="text-ink/40">—</span>}</td>
            <td className="px-3 py-2 font-mono text-[13px] tabular-nums text-ink/80">{p.cnpj ? formatCnpj(p.cnpj) : <span className="text-ink/40">—</span>}</td>
            <td className="truncate px-3 py-2 text-ink/80">{categoryName(p.defaultCategoryId) ?? <span className="text-ink/40">—</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  return (
    <div>
      <SectionHeader
        title="Favorecidos"
        description="Quem recebe seus pagamentos, com o nome que vocês usam (a distribuidora pode ser o “Gás”). O CNPJ é opcional e ajuda a reconhecer o boleto."
        actions={
          canWrite && (
            <Button onClick={() => setEditing({ kind: 'new' })} className="flex items-center gap-2 md:h-9">
              <Plus aria-hidden="true" size={18} strokeWidth={ICON.strokeWidth} /> Novo favorecido
            </Button>
          )
        }
      />

      <DetailLayout open={desktop && panelOpen}>
        <div className="min-w-0">
          {payees.isPending && <p role="status" className="text-sm text-ink/70">carregando…</p>}
          {payees.isError && <LoadError what="os favorecidos" onRetry={() => void payees.refetch()} />}
          {payees.isSuccess && active.length === 0 && (
            <p className="rounded-md border border-dashed border-ink/25 p-4 text-sm text-ink/75">
              Nenhum favorecido ainda{canWrite ? '. Crie o primeiro em Novo favorecido.' : '.'}
            </p>
          )}

          {active.length > 0 &&
            (desktop ? (
              <div className="overflow-hidden rounded-md border border-line">{table(active, 'Favorecidos ativos')}</div>
            ) : (
              <ul aria-label="Favorecidos ativos" className="flex flex-col rounded-md border border-line">{active.map(item)}</ul>
            ))}

          {archived.length > 0 && (
            <details className="mt-4 rounded-md border border-line px-3">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-ink/85 md:min-h-10">arquivados ({archived.length})</summary>
              {desktop ? <div className="pb-2">{table(archived, 'Favorecidos arquivados')}</div> : <ul aria-label="Favorecidos arquivados" className="flex flex-col">{archived.map(item)}</ul>}
            </details>
          )}
        </div>

        {panelOpen && (
          <DetailPanel desktop={desktop} title={editing?.kind === 'new' ? 'Novo favorecido' : (selected?.name ?? 'Favorecido')} onClose={close}>
            <PayeeForm
              key={selected?.id ?? 'novo'}
              payee={selected}
              categories={categories.filter((c) => !c.archived)}
              canWrite={canWrite}
              onCreate={(body) => actions.create.mutateAsync(body)}
              onUpdate={(id, body) => actions.update.mutateAsync({ id, body })}
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
