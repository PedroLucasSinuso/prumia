import { useMemo, useState } from 'react'

import { useAllCategories, useCategoryActions } from '../api/queries'
import type { Category } from '../api/types'
import { useAuth } from '../auth/context'
import { AppShell } from '../components/AppShell'
import { Button } from '../components/Button'
import { CategoryForm } from '../components/CategoryForm'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/toastContext'
import { useIsDesktop } from '../lib/useIsDesktop'

type Editing = { kind: 'new' } | { kind: 'edit'; id: string } | null

const label = 'text-xs font-medium uppercase tracking-wider'
const walletText = { free: 'carteira livre', benefit: 'carteira de benefício' } as const
const arrow = 'flex size-11 shrink-0 items-center justify-center rounded-md border border-graphite/20 font-mono text-base hover:bg-graphite/5 disabled:opacity-30'

const meta = (c: Category) => [c.defaultWallet ? walletText[c.defaultWallet] : 'sem carteira padrão', c.isEssential ? 'essencial' : null].filter(Boolean).join(' · ')

/**
 * Ajustes da casa: o lugar onde cada família molda o app ao seu jeito. Organizada em seções para crescer;
 * por enquanto, categorias (criar, editar, reordenar, arquivar/restaurar). Computador: lista + detalhe ao lado; celular: Sheet.
 */
export default function SettingsPage() {
  const { session } = useAuth()
  const toast = useToast()
  const desktop = useIsDesktop()
  const [editing, setEditing] = useState<Editing>(null)

  const me = session.status === 'authenticated' ? session.me : undefined
  const house = me?.households[0]
  const houseId = house?.id ?? ''

  const categories = useAllCategories(houseId)
  const actions = useCategoryActions(houseId)

  const all = useMemo(() => [...(categories.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'pt-BR')), [categories.data])
  const active = all.filter((c) => !c.archived)
  const archived = all.filter((c) => c.archived)

  if (!me || !house) return null
  const canWrite = house.role !== 'viewer'
  const selected = editing?.kind === 'edit' ? all.find((c) => c.id === editing.id) : undefined
  const close = () => setEditing(null)

  function move(index: number, delta: -1 | 1) {
    const next = [...active]
    const [item] = next.splice(index, 1)
    next.splice(index + delta, 0, item)
    actions.reorder.mutate(next, { onError: () => toast({ message: 'Não foi possível mudar a ordem. Tente de novo.' }) })
  }

  const form =
    editing?.kind === 'new' || selected ? (
      <CategoryForm
        key={selected?.id ?? 'nova'}
        category={selected}
        canWrite={canWrite}
        onCreate={(body) => actions.create.mutateAsync(body)}
        onUpdate={(id, body) => actions.update.mutateAsync({ id, body })}
        onDone={(message) => {
          close()
          toast({ message })
        }}
      />
    ) : null
  const panelTitle = editing?.kind === 'new' ? 'Nova categoria' : (selected?.name ?? 'Categoria')

  const row = (c: Category, index?: number) => (
    <li key={c.id} className={`flex items-center gap-2 border-t border-graphite/10 first:border-t-0 ${selected?.id === c.id ? 'bg-cobalt/8' : ''}`}>
      <button aria-label={`Abrir ${c.name}`} onClick={() => setEditing({ kind: 'edit', id: c.id })} className="flex min-h-14 min-w-0 flex-1 flex-col justify-center px-1 py-2 text-left">
        <span className={`block truncate text-[15px] font-medium ${c.archived ? 'text-graphite/70' : ''}`}>{c.name}</span>
        <span className="block truncate text-xs text-graphite/75">{meta(c)}</span>
      </button>
      {canWrite && index !== undefined && (
        <span className="flex shrink-0 gap-1">
          <button aria-label={`Subir ${c.name}`} disabled={index === 0 || actions.reorder.isPending} onClick={() => move(index, -1)} className={arrow}>↑</button>
          <button aria-label={`Descer ${c.name}`} disabled={index === active.length - 1 || actions.reorder.isPending} onClick={() => move(index, 1)} className={arrow}>↓</button>
        </span>
      )}
    </li>
  )

  return (
    <AppShell>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-36 pt-4 md:max-w-none md:px-10 md:pb-10 md:pt-8">
        <header>
          <h1 className="font-display text-[32px] font-bold leading-none text-teal font-stretch-condensed">Ajustes</h1>
          <p className="mt-1 text-sm text-graphite/80">Molde o prumia ao jeito da sua casa.</p>
        </header>

        <div className="flex flex-col gap-6 md:flex-row md:items-start">
          <section aria-label="Categorias" className="min-w-0 flex-1 rounded-md border border-graphite/20 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-display text-[24px] font-bold text-teal font-stretch-condensed">Categorias</h2>
              {canWrite && (
                <Button onClick={() => setEditing({ kind: 'new' })} className="flex items-center gap-2">
                  <span aria-hidden="true" className="text-xl leading-none">+</span> Nova categoria
                </Button>
              )}
            </div>
            <p className="mt-1 text-sm text-graphite/80">
              A ordem daqui é a ordem em que elas aparecem ao lançar uma conta. Categoria em uso não se apaga: arquive, e as contas antigas continuam com o nome.
            </p>

            {categories.isPending && <p role="status" className="mt-3 text-sm text-graphite/70">carregando…</p>}
            {categories.isError && (
              <p role="alert" className="mt-3 rounded-md border border-signal/60 bg-signal/10 px-3 py-2 text-sm">
                <span className="font-mono text-signal">[ ✖ ]</span> Não foi possível carregar as categorias.{' '}
                <button className="h-11 font-semibold underline" onClick={() => void categories.refetch()}>Tentar de novo</button>
              </p>
            )}
            {categories.isSuccess && active.length === 0 && (
              <p className="mt-3 rounded-md border border-dashed border-graphite/25 p-4 text-sm text-graphite/75">
                Nenhuma categoria ativa{canWrite ? '. Crie a primeira em Nova categoria.' : '.'}
              </p>
            )}

            <ul aria-label="Categorias ativas" className="mt-3 flex flex-col">
              {active.map((c, i) => row(c, i))}
            </ul>

            {archived.length > 0 && (
              <details className="mt-4 border-t border-graphite/15 pt-2">
                <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-graphite/85">arquivadas ({archived.length})</summary>
                <ul aria-label="Categorias arquivadas" className="flex flex-col">
                  {archived.map((c) => row(c))}
                </ul>
              </details>
            )}
          </section>

          {desktop && (
            <aside className="w-full shrink-0 md:sticky md:top-6 md:w-[380px] lg:w-[420px]">
              {form ? (
                <section aria-label="Detalhes" className="rounded-md border-2 border-teal bg-white/30 p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h2 className="font-display text-[22px] font-bold text-teal font-stretch-condensed">{panelTitle}</h2>
                    <button aria-label="Fechar detalhes" onClick={close} className="flex size-11 items-center justify-center rounded-md text-xl hover:bg-graphite/5">×</button>
                  </div>
                  {form}
                </section>
              ) : (
                <p className="rounded-md border border-dashed border-graphite/25 p-4 text-sm text-graphite/75">
                  Toque numa categoria para {canWrite ? 'editar, arquivar ou restaurar' : 'ver os detalhes'}.
                </p>
              )}
            </aside>
          )}
        </div>

        <p className={`${label} text-graphite/60`}>em breve: mais ajustes para a casa</p>
      </main>

      {!desktop && form && <Sheet title={panelTitle} onClose={close}>{form}</Sheet>}
    </AppShell>
  )
}
