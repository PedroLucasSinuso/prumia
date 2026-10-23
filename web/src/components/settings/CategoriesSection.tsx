import { Archive, ArchiveRestore, ArrowUpDown, Check, ChevronDown, ChevronUp, FolderInput, GripVertical, Pencil, Plus } from 'lucide-react'
import { useMemo, useState, type DragEvent, type KeyboardEvent } from 'react'

import { useCategories, useCategoryActions } from '../../api/queries'
import type { Category } from '../../api/types'
import { buildTree } from '../../lib/categories'
import { ICON } from '../../lib/navigation'
import { ActionMenu } from '../ActionMenu'
import { Button } from '../Button'
import { CategoryForm } from '../CategoryForm'
import { Sheet } from '../Sheet'
import { useToast } from '../toastContext'
import { DetailLayout, DetailPanel } from './DetailPanel'
import { LoadError, SectionHeader, Tag } from './ui'

type Editing = { kind: 'new'; parentId?: string } | { kind: 'edit'; id: string } | null
type Drop = { id: string; after: boolean } | null

const sameGroup = (a: Category, b: Category) => (a.parentId ?? '') === (b.parentId ?? '')

/** Só as exceções viram selo: benefício (VR) e essencial. "Carteira livre" é o normal e não aparece. */
function Meta({ c }: { c: Category }) {
  if (c.defaultWallet !== 'benefit' && !c.isEssential) return null
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {c.defaultWallet === 'benefit' && <Tag><span title="Sugere a carteira de benefício (VR/VA) ao pagar">VR</span></Tag>}
      {c.isEssential && <Tag>essencial</Tag>}
    </span>
  )
}

/**
 * Ajustes > Categorias: árvore (mãe → subcategorias) na ordem em que aparecem ao lançar uma conta.
 * Reordenar: computador arrasta pela alça (ou foca a alça e usa ↑ ↓); celular liga o modo "Reordenar" (setas grandes).
 * Ações de cada linha no menu "⋯". Arquivadas ficam recolhidas no fim.
 */
export function CategoriesSection({ houseId, canWrite, desktop }: { houseId: string; canWrite: boolean; desktop: boolean }) {
  const toast = useToast()
  const [editing, setEditing] = useState<Editing>(null)
  const [moving, setMoving] = useState<Category>()
  const [reordering, setReordering] = useState(false)
  const [dragId, setDragId] = useState<string>()
  const [armed, setArmed] = useState<string>()
  const [drop, setDrop] = useState<Drop>(null)
  const [announce, setAnnounce] = useState('')

  const categories = useCategories(houseId)
  const actions = useCategoryActions(houseId)

  const all = useMemo(() => [...(categories.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'pt-BR')), [categories.data])
  const active = useMemo(() => all.filter((c) => !c.archived), [all])
  const archived = all.filter((c) => c.archived)
  const tree = useMemo(() => buildTree(active), [active])
  const tops = tree.map((n) => n.category)
  const siblingsOf = (c: Category) => (c.parentId ? (tree.find((n) => n.category.id === c.parentId)?.children ?? []) : tops)

  const selected = editing?.kind === 'edit' ? all.find((c) => c.id === editing.id) : undefined
  const close = () => setEditing(null)
  const panelOpen = editing?.kind === 'new' || selected !== undefined

  function reorder(next: Category[], moved: Category) {
    const pos = next.findIndex((c) => c.id === moved.id) + 1
    setAnnounce(`${moved.name}: posição ${pos} de ${next.length}.`)
    actions.reorder.mutate(next, { onError: () => toast({ message: 'Não foi possível mudar a ordem. Tente de novo.' }) })
  }

  function move(c: Category, delta: -1 | 1) {
    const siblings = siblingsOf(c)
    const i = siblings.findIndex((s) => s.id === c.id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= siblings.length) return
    const next = [...siblings]
    next.splice(i, 1)
    next.splice(j, 0, c)
    reorder(next, c)
  }

  function onHandleKey(e: KeyboardEvent, c: Category) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      if (!actions.reorder.isPending) move(c, e.key === 'ArrowUp' ? -1 : 1)
    }
  }

  // Arrastar (HTML5 drag and drop, só computador): solta antes/depois de uma irmã (mesma mãe, ou entre as de topo).
  function onDragOver(e: DragEvent<HTMLLIElement>, target: Category) {
    const dragged = active.find((c) => c.id === dragId)
    if (!dragged || dragged.id === target.id || !sameGroup(dragged, target)) return
    e.preventDefault()
    const r = e.currentTarget.getBoundingClientRect()
    const after = e.clientY > r.top + r.height / 2
    if (drop?.id !== target.id || drop.after !== after) setDrop({ id: target.id, after })
  }

  function onDrop(e: DragEvent<HTMLLIElement>, target: Category) {
    e.preventDefault()
    const dragged = active.find((c) => c.id === dragId)
    const where = drop
    endDrag()
    if (!dragged || !where || !sameGroup(dragged, target)) return
    const next = siblingsOf(target).filter((c) => c.id !== dragged.id)
    const at = next.findIndex((c) => c.id === where.id) + (where.after ? 1 : 0)
    next.splice(at, 0, dragged)
    if (next.every((c, i) => c.id === siblingsOf(target)[i]?.id)) return // não mudou
    reorder(next, dragged)
  }

  function endDrag() {
    setDragId(undefined)
    setArmed(undefined)
    setDrop(null)
  }

  function archive(c: Category, value: boolean) {
    actions.update.mutate(
      { id: c.id, body: { archived: value } },
      {
        onSuccess: () =>
          toast({
            message: `${c.name} ${value ? 'arquivada' : 'restaurada'}.`,
            actionLabel: 'Desfazer',
            onAction: () => actions.update.mutate({ id: c.id, body: { archived: !value } }),
          }),
        onError: () => toast({ message: 'Não foi possível salvar. Tente de novo.' }),
      },
    )
  }

  const dragEnabled = desktop && canWrite

  const row = (c: Category, child: boolean) => {
    const siblings = c.archived ? [] : siblingsOf(c)
    const index = siblings.findIndex((s) => s.id === c.id)
    const hasChildren = all.some((x) => x.parentId === c.id && !x.archived)
    const indicator = drop?.id === c.id ? (drop.after ? 'shadow-[inset_0_-2px_0_var(--color-accent)]' : 'shadow-[inset_0_2px_0_var(--color-accent)]') : ''
    return (
      <li
        key={c.id}
        draggable={dragEnabled && armed === c.id && !c.archived}
        onDragStart={(e) => {
          setDragId(c.id)
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', c.name)
        }}
        onDragOver={(e) => onDragOver(e, c)}
        onDrop={(e) => onDrop(e, c)}
        onDragEnd={endDrag}
        className={`group flex items-center gap-1 border-t border-line/60 first:border-t-0 ${selected?.id === c.id ? 'bg-accent/8' : 'hover:bg-ink/3'} ${
          child ? 'ml-6 border-l-2 border-l-ink/15 pl-2' : ''
        } ${dragId === c.id ? 'opacity-50' : ''} ${indicator}`}
      >
        {dragEnabled && !c.archived && (
          <button
            type="button"
            aria-label={`Reordenar ${c.name}`}
            aria-describedby="dica-reordenar"
            title="Arraste para mudar a ordem (ou use ↑ ↓)"
            onPointerDown={() => setArmed(c.id)}
            onPointerUp={() => !dragId && setArmed(undefined)}
            onKeyDown={(e) => onHandleKey(e, c)}
            className="flex h-9 w-7 shrink-0 cursor-grab items-center justify-center rounded-sm text-ink/45 hover:bg-ink/6 hover:text-ink active:cursor-grabbing"
          >
            <GripVertical aria-hidden="true" size={16} strokeWidth={ICON.strokeWidth} />
          </button>
        )}
        <button
          type="button"
          aria-label={`Abrir ${c.name}`}
          onClick={() => setEditing({ kind: 'edit', id: c.id })}
          className="flex min-h-12 min-w-0 flex-1 items-center gap-3 px-1.5 py-1.5 text-left md:min-h-10"
        >
          <span className={`min-w-0 flex-1 truncate text-[15px] md:text-sm ${child ? '' : 'font-medium'} ${c.archived ? 'text-ink/65' : ''}`}>{c.name}</span>
          <Meta c={c} />
        </button>
        {reordering && !c.archived ? (
          <span className="flex shrink-0 gap-1">
            <button type="button" aria-label={`Subir ${c.name}`} disabled={index <= 0 || actions.reorder.isPending} onClick={() => move(c, -1)}
              className="flex size-11 items-center justify-center rounded-md border border-line hover:bg-ink/5 disabled:opacity-30">
              <ChevronUp aria-hidden="true" size={ICON.size} strokeWidth={ICON.strokeWidth} />
            </button>
            <button type="button" aria-label={`Descer ${c.name}`} disabled={index === siblings.length - 1 || actions.reorder.isPending} onClick={() => move(c, 1)}
              className="flex size-11 items-center justify-center rounded-md border border-line hover:bg-ink/5 disabled:opacity-30">
              <ChevronDown aria-hidden="true" size={ICON.size} strokeWidth={ICON.strokeWidth} />
            </button>
          </span>
        ) : (
          canWrite && (
            <ActionMenu
              label={`Ações de ${c.name}`}
              actions={[
                { label: 'Editar', icon: Pencil, onSelect: () => setEditing({ kind: 'edit', id: c.id }) },
                { label: 'Nova subcategoria', icon: Plus, onSelect: () => setEditing({ kind: 'new', parentId: c.id }), hidden: child || c.archived },
                { label: 'Mover para…', icon: FolderInput, onSelect: () => setMoving(c), hidden: c.archived || hasChildren },
                { label: 'Arquivar', icon: Archive, onSelect: () => archive(c, true), hidden: c.archived },
                { label: 'Restaurar', icon: ArchiveRestore, onSelect: () => archive(c, false), hidden: !c.archived },
              ]}
            />
          )
        )}
      </li>
    )
  }

  const panelTitle = editing?.kind === 'new' ? (editing.parentId ? 'Nova subcategoria' : 'Nova categoria') : (selected?.name ?? 'Categoria')
  const subCount = active.filter((c) => c.parentId).length

  return (
    <div>
      <SectionHeader
        title="Categorias"
        description="A ordem daqui é a ordem em que aparecem ao lançar uma conta. Categoria em uso não se apaga: arquive, e as contas antigas continuam com o nome."
        actions={
          canWrite && (
            <>
              {!desktop && (
                <Button variant="ghost" aria-pressed={reordering} onClick={() => setReordering((r) => !r)} className="flex items-center gap-2">
                  {reordering ? <Check aria-hidden="true" size={18} strokeWidth={ICON.strokeWidth} /> : <ArrowUpDown aria-hidden="true" size={18} strokeWidth={ICON.strokeWidth} />}
                  {reordering ? 'Concluir' : 'Reordenar'}
                </Button>
              )}
              <Button onClick={() => setEditing({ kind: 'new' })} className="flex items-center gap-2 md:h-9">
                <Plus aria-hidden="true" size={18} strokeWidth={ICON.strokeWidth} /> Nova categoria
              </Button>
            </>
          )
        }
      />

      <DetailLayout open={desktop && panelOpen}>
        <div className="min-w-0">
          {categories.isPending && <p role="status" className="text-sm text-ink/70">carregando…</p>}
          {categories.isError && <LoadError what="as categorias" onRetry={() => void categories.refetch()} />}
          {categories.isSuccess && active.length === 0 && (
            <p className="rounded-md border border-dashed border-ink/25 p-4 text-sm text-ink/75">
              Nenhuma categoria ativa{canWrite ? '. Crie a primeira em Nova categoria.' : '.'}
            </p>
          )}

          {active.length > 0 && (
            <div className="rounded-md border border-line">
              <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2 text-xs text-ink/70">
                <span>
                  {tops.length} {tops.length === 1 ? 'categoria' : 'categorias'}
                  {subCount > 0 && ` · ${subCount} ${subCount === 1 ? 'subcategoria' : 'subcategorias'}`}
                </span>
                {dragEnabled && <span id="dica-reordenar">Arraste pela alça ou foque a alça e use ↑ ↓</span>}
              </div>
              <ul aria-label="Categorias ativas" className="flex flex-col px-1 py-1">
                {tree.flatMap((n) => [row(n.category, false), ...n.children.map((c) => row(c, true))])}
              </ul>
            </div>
          )}
          <p aria-live="polite" className="sr-only">{announce}</p>

          {archived.length > 0 && (
            <details className="mt-4 rounded-md border border-line px-3">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-ink/85 md:min-h-10">arquivadas ({archived.length})</summary>
              <ul aria-label="Categorias arquivadas" className="flex flex-col pb-1">
                {archived.map((c) => row(c, false))}
              </ul>
            </details>
          )}
        </div>

        {panelOpen && (
          <DetailPanel desktop={desktop} title={panelTitle} onClose={close}>
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
          </DetailPanel>
        )}
      </DetailLayout>

      {moving && (
        <Sheet title={`Mover ${moving.name}`} onClose={() => setMoving(undefined)}>
          <p className="mb-3 text-sm text-ink/80">Escolha onde {moving.name} fica. Dentro de outra, ela vira subcategoria e entra na soma da principal.</p>
          <ul className="flex flex-col gap-1.5">
            {[{ id: '', name: 'Categoria principal (topo)' }, ...tops.filter((t) => t.id !== moving.id)].map((target) => {
              const current = (moving.parentId ?? '') === target.id
              return (
                <li key={target.id || 'topo'}>
                  <button
                    type="button"
                    aria-current={current ? 'true' : undefined}
                    disabled={current || actions.update.isPending}
                    onClick={() =>
                      actions.update.mutate(
                        { id: moving.id, body: { parentId: target.id || null } },
                        {
                          onSuccess: () => {
                            toast({ message: target.id ? `${moving.name} agora fica dentro de ${target.name}.` : `${moving.name} agora é uma categoria principal.` })
                            setMoving(undefined)
                          },
                          onError: () => toast({ message: 'Não foi possível mover. Tente de novo.' }),
                        },
                      )
                    }
                    className={`flex min-h-11 w-full items-center gap-3 rounded-md border px-3 text-left text-sm ${current ? 'border-structure bg-structure/8' : 'border-line hover:bg-ink/5'}`}
                  >
                    <span aria-hidden="true" className="font-mono text-xs text-ink/70">{current ? '[ ▪ ]' : '[ ▫ ]'}</span>
                    {target.name}
                  </button>
                </li>
              )
            })}
          </ul>
        </Sheet>
      )}
    </div>
  )
}
