import { useMemo, useState } from 'react'

import { useCategories, useCategoryActions } from '../api/queries'
import type { Category } from '../api/types'
import { useActiveHouse } from '../auth/useActiveHouse'
import { AppShell } from '../components/AppShell'
import { Button } from '../components/Button'
import { AppearanceSection } from '../components/AppearanceSection'
import { CategoryForm } from '../components/CategoryForm'
import { PayeesSection } from '../components/PayeesSection'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/toastContext'
import { buildTree } from '../lib/categories'
import { useIsDesktop } from '../lib/useIsDesktop'

type Editing = { kind: 'new'; parentId?: string } | { kind: 'edit'; id: string } | null

const label = 'text-xs font-medium uppercase tracking-wider'
const walletText = { free: 'carteira livre', benefit: 'carteira de benefício' } as const
const arrow = 'flex size-11 shrink-0 items-center justify-center rounded-md border border-ink/20 font-mono text-base hover:bg-ink/5 disabled:opacity-30'

const meta = (c: Category) => [c.defaultWallet ? walletText[c.defaultWallet] : 'sem carteira padrão', c.isEssential ? 'essencial' : null].filter(Boolean).join(' · ')

/**
 * Ajustes da casa: o lugar onde cada família molda o app ao seu jeito. Organizada em seções para crescer;
 * categorias (criar, editar, reordenar, arquivar/restaurar) e favorecidos. Computador: lista + detalhe ao lado; celular: Sheet.
 */
export default function SettingsPage() {
  const { house } = useActiveHouse()
  // key: trocar de casa remonta a tela (o painel aberto de uma categoria não vaza para a outra casa)
  return <SettingsView key={house?.id ?? 'sem-casa'} />
}

function SettingsView() {
  const toast = useToast()
  const desktop = useIsDesktop()
  const [editing, setEditing] = useState<Editing>(null)

  const { house } = useActiveHouse()
  const houseId = house?.id ?? ''

  const categories = useCategories(houseId)
  const actions = useCategoryActions(houseId)

  const all = useMemo(() => [...(categories.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'pt-BR')), [categories.data])
  const active = all.filter((c) => !c.archived)
  const archived = all.filter((c) => c.archived)
  const tree = useMemo(() => buildTree(active), [active])

  if (!house) return null
  const canWrite = house.role !== 'viewer'
  const selected = editing?.kind === 'edit' ? all.find((c) => c.id === editing.id) : undefined
  const close = () => setEditing(null)

  // Setas movem a categoria dentro das irmãs (mesma mãe, ou entre as de topo): `siblings` é o grupo.
  function move(siblings: Category[], index: number, delta: -1 | 1) {
    const next = [...siblings]
    const [item] = next.splice(index, 1)
    next.splice(index + delta, 0, item)
    actions.reorder.mutate(next, { onError: () => toast({ message: 'Não foi possível mudar a ordem. Tente de novo.' }) })
  }

  const form =
    editing?.kind === 'new' || selected ? (
      <CategoryForm
        key={selected?.id ?? `nova-${editing?.kind === 'new' ? (editing.parentId ?? '') : ''}`}
        category={selected}
        all={all}
        defaultParentId={editing?.kind === 'new' ? editing.parentId : undefined}
        canWrite={canWrite}
        onCreate={(body) => actions.create.mutateAsync(body)}
        onUpdate={(id, body) => actions.update.mutateAsync({ id, body })}
        onDone={(message) => {
          close()
          toast({ message })
        }}
      />
    ) : null
  const panelTitle = editing?.kind === 'new' ? (editing.parentId ? 'Nova subcategoria' : 'Nova categoria') : (selected?.name ?? 'Categoria')

  const row = (c: Category, siblings?: Category[], index?: number, child = false) => (
    <li key={c.id} className={`flex items-center gap-2 border-t border-ink/10 first:border-t-0 ${selected?.id === c.id ? 'bg-accent/8' : ''} ${child ? 'ml-5 border-l-2 border-l-ink/20 pl-2' : ''}`}>
      <button aria-label={`Abrir ${c.name}`} onClick={() => setEditing({ kind: 'edit', id: c.id })} className="flex min-h-14 min-w-0 flex-1 flex-col justify-center px-1 py-2 text-left">
        <span className={`block truncate text-[15px] font-medium ${c.archived ? 'text-ink/70' : ''}`}>{c.name}</span>
        <span className="block truncate text-xs text-ink/75">{meta(c)}</span>
      </button>
      {canWrite && !child && !c.archived && (
        <button aria-label={`Nova subcategoria em ${c.name}`} title="Nova subcategoria" onClick={() => setEditing({ kind: 'new', parentId: c.id })} className="flex h-11 shrink-0 items-center rounded-md border border-ink/20 px-2.5 text-xs font-medium hover:bg-ink/5">
          + sub
        </button>
      )}
      {canWrite && siblings && index !== undefined && (
        <span className="flex shrink-0 gap-1">
          <button aria-label={`Subir ${c.name}`} disabled={index === 0 || actions.reorder.isPending} onClick={() => move(siblings, index, -1)} className={arrow}>↑</button>
          <button aria-label={`Descer ${c.name}`} disabled={index === siblings.length - 1 || actions.reorder.isPending} onClick={() => move(siblings, index, 1)} className={arrow}>↓</button>
        </span>
      )}
    </li>
  )

  const tops = tree.map((n) => n.category)

  return (
    <AppShell>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-36 pt-4 md:max-w-none md:px-10 md:pb-10 md:pt-8">
        <header>
          <h1 className="font-display text-[32px] font-bold leading-none text-structure font-stretch-condensed">Ajustes</h1>
          <p className="mt-1 text-sm text-ink/80">Molde o prumia ao jeito da sua casa.</p>
        </header>

        <div className="flex flex-col gap-6 md:flex-row md:items-start">
          <section aria-label="Categorias" className="min-w-0 flex-1 rounded-md border border-ink/20 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-display text-[24px] font-bold text-structure font-stretch-condensed">Categorias</h2>
              {canWrite && (
                <Button onClick={() => setEditing({ kind: 'new' })} className="flex items-center gap-2">
                  <span aria-hidden="true" className="text-xl leading-none">+</span> Nova categoria
                </Button>
              )}
            </div>
            <p className="mt-1 text-sm text-ink/80">
              A ordem daqui é a ordem em que elas aparecem ao lançar uma conta. Categoria em uso não se apaga: arquive, e as contas antigas continuam com o nome.
            </p>

            {categories.isPending && <p role="status" className="mt-3 text-sm text-ink/70">carregando…</p>}
            {categories.isError && (
              <p role="alert" className="mt-3 rounded-md border border-alert/60 bg-alert/10 px-3 py-2 text-sm">
                <span className="font-mono text-alert">[ ✖ ]</span> Não foi possível carregar as categorias.{' '}
                <button className="h-11 font-semibold underline" onClick={() => void categories.refetch()}>Tentar de novo</button>
              </p>
            )}
            {categories.isSuccess && active.length === 0 && (
              <p className="mt-3 rounded-md border border-dashed border-ink/25 p-4 text-sm text-ink/75">
                Nenhuma categoria ativa{canWrite ? '. Crie a primeira em Nova categoria.' : '.'}
              </p>
            )}

            <ul aria-label="Categorias ativas" className="mt-3 flex flex-col">
              {tree.flatMap((n, i) => [
                row(n.category, tops, i),
                ...n.children.map((c, k) => row(c, n.children, k, true)),
              ])}
            </ul>

            {archived.length > 0 && (
              <details className="mt-4 border-t border-line pt-2">
                <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-ink/85">arquivadas ({archived.length})</summary>
                <ul aria-label="Categorias arquivadas" className="flex flex-col">
                  {archived.map((c) => row(c))}
                </ul>
              </details>
            )}
          </section>

          {desktop && (
            <aside className="w-full shrink-0 md:sticky md:top-6 md:w-[380px] lg:w-[420px]">
              {form ? (
                <section aria-label="Detalhes" className="rounded-md border-2 border-structure bg-white/30 p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h2 className="font-display text-[22px] font-bold text-structure font-stretch-condensed">{panelTitle}</h2>
                    <button aria-label="Fechar detalhes" onClick={close} className="flex size-11 items-center justify-center rounded-md text-xl hover:bg-ink/5">×</button>
                  </div>
                  {form}
                </section>
              ) : (
                <p className="rounded-md border border-dashed border-ink/25 p-4 text-sm text-ink/75">
                  Selecione uma categoria para {canWrite ? 'editar, arquivar ou restaurar' : 'ver os detalhes'}.
                </p>
              )}
            </aside>
          )}
        </div>

        <PayeesSection houseId={houseId} categories={all} canWrite={canWrite} />

        <AppearanceSection />

        <p className={`${label} text-ink/60`}>em breve: mais ajustes para a casa</p>
      </main>

      {!desktop && form && <Sheet title={panelTitle} onClose={close}>{form}</Sheet>}
    </AppShell>
  )
}
