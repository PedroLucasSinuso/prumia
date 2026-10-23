import { useState, type FormEvent } from 'react'

import { ApiError } from '../api/errors'
import type { Category, CategoryInput, CategoryPatch, Wallet } from '../api/types'
import { networkErrorMessage, problemFields, problemMessage } from '../auth/errors'
import { Button } from './Button'
import { Field } from './Field'
import { FormError } from './FormError'

type Props = {
  /** Sem categoria = criar uma nova. */
  category?: Category
  /** Todas as categorias (para escolher a categoria principal). */
  all: Category[]
  /** Ao criar: já nasce dentro desta categoria (botão "+ subcategoria"). */
  defaultParentId?: string
  canWrite: boolean
  onCreate: (body: CategoryInput) => Promise<unknown>
  onUpdate: (id: string, body: CategoryPatch) => Promise<unknown>
  /** Chamado depois de salvar, arquivar ou restaurar com sucesso (a tela fecha o painel e avisa). */
  onDone: (message: string) => void
}

const label = 'text-xs font-medium uppercase tracking-wider text-ink/70'
const chip = (on: boolean) =>
  `flex min-h-11 flex-1 items-center justify-center rounded-md border px-3 text-[13px] ${
    on ? 'border-structure bg-structure font-semibold text-on-structure' : 'border-ink/30 font-medium text-ink hover:bg-ink/5'
  }`

const wallets: { value: Wallet | null; text: string }[] = [
  { value: 'free', text: 'livre' },
  { value: 'benefit', text: 'benefício' },
  { value: null, text: 'nenhuma' },
]

/**
 * Criar ou editar uma categoria: nome, carteira sugerida ao pagar e se é gasto essencial.
 * Arquivar/restaurar ficam aqui também. Quem só lê (viewer) vê os dados, sem botões de escrita.
 */
export function CategoryForm({ category, all, defaultParentId, canWrite, onCreate, onUpdate, onDone }: Props) {
  const [name, setName] = useState(category?.name ?? '')
  // Subcategoria nasce com a carteira e o "essencial" da mãe (a pessoa pode mudar): menos coisa para preencher.
  const initialParent = category?.parentId ?? defaultParentId ?? ''
  const parentOf = (id: string) => all.find((c) => c.id === id)
  const [parentId, setParentId] = useState(initialParent)
  const [wallet, setWallet] = useState<Wallet | null>(category ? (category.defaultWallet ?? null) : (parentOf(initialParent)?.defaultWallet ?? null))
  const [essential, setEssential] = useState(category ? category.isEssential : (parentOf(initialParent)?.isEssential ?? false))
  const [error, setError] = useState<string>()
  const [nameError, setNameError] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function run(call: () => Promise<unknown>, message: string) {
    setBusy(true)
    setError(undefined)
    setNameError(undefined)
    try {
      await call()
      onDone(message)
    } catch (e) {
      if (!(e instanceof ApiError) || e.network) {
        setError(networkErrorMessage)
      } else if (e.problem?.code === 'category_exists') {
        setNameError(problemMessage(e.problem))
      } else {
        const fields = problemFields(e.problem)
        if (fields.name) setNameError(fields.name)
        setError(problemMessage(e.problem))
      }
    } finally {
      setBusy(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const clean = name.trim()
    if (!clean) {
      setNameError('Dê um nome à categoria.')
      return
    }
    if (category) {
      // parentId só vai se mudou (ausente = não mexe; null = volta ao topo)
      const moved = parentId !== (category.parentId ?? '') ? { parentId: parentId || null } : {}
      void run(() => onUpdate(category.id, { name: clean, defaultWallet: wallet, isEssential: essential, ...moved }), `${clean} salva.`)
    } else {
      void run(() => onCreate({ name: clean, defaultWallet: wallet, isEssential: essential, ...(parentId ? { parentId } : {}) }), `${clean} criada.`)
    }
  }

  const archived = category?.archived ?? false
  const hasChildren = category ? all.some((c) => c.parentId === category.id) : false
  // Mães possíveis: categorias de topo, ativas, que não sejam ela mesma (só dois níveis).
  const parents = all.filter((c) => !c.parentId && !c.archived && c.id !== category?.id)

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <FormError message={error} />
      <Field
        label="Nome"
        value={name}
        maxLength={60}
        disabled={!canWrite}
        error={nameError}
        onChange={(e) => {
          setName(e.target.value)
          setNameError(undefined)
        }}
      />

      {hasChildren ? (
        <p className="text-sm text-ink/80">Esta categoria tem subcategorias, então é uma categoria principal.</p>
      ) : (
        parents.length > 0 && (
          <div className="flex flex-col gap-1">
            <label htmlFor="category-parent" className={label}>dentro de</label>
            <select
              id="category-parent"
              value={parentId}
              disabled={!canWrite}
              onChange={(e) => {
                const next = e.target.value
                setParentId(next)
                const mother = parentOf(next)
                if (!category && mother) { setWallet(mother.defaultWallet ?? null); setEssential(mother.isEssential) }
              }}
              className="h-11 rounded-md border border-ink/25 bg-white/40 px-3 text-base text-ink"
            >
              <option value="">nenhuma (categoria principal)</option>
              {parents.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <p className="text-xs text-ink/70">Ex.: Gás dentro de Moradia. O gráfico de Moradia soma o gás.</p>
          </div>
        )
      )}

      <fieldset className="flex flex-col gap-1" disabled={!canWrite}>
        <legend className={label}>carteira padrão</legend>
        <div className="mt-1 flex gap-2">
          {wallets.map((w) => (
            <button key={w.text} type="button" aria-pressed={wallet === w.value} onClick={() => setWallet(w.value)} className={chip(wallet === w.value)}>
              {w.text}
            </button>
          ))}
        </div>
        <p className="text-xs text-ink/70">Ao pagar uma conta desta categoria, o app já sugere esta carteira.</p>
      </fieldset>

      <fieldset className="flex flex-col gap-1" disabled={!canWrite}>
        <legend className={label}>gasto essencial?</legend>
        <div className="mt-1 flex gap-2">
          <button type="button" aria-pressed={essential} onClick={() => setEssential(true)} className={chip(essential)}>sim</button>
          <button type="button" aria-pressed={!essential} onClick={() => setEssential(false)} className={chip(!essential)}>não</button>
        </div>
        <p className="text-xs text-ink/70">Essencial é o que não dá para cortar: moradia, mercado, saúde.</p>
      </fieldset>

      {canWrite && (
        <Button type="submit" disabled={busy}>
          {busy ? 'Salvando…' : category ? 'Salvar categoria' : 'Criar categoria'}
        </Button>
      )}

      {category && canWrite && (
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          {archived ? (
            <>
              <p className="text-sm text-ink/80">Arquivada: não aparece ao lançar contas novas. Restaure para voltar a usar.</p>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => void run(() => onUpdate(category.id, { archived: false }), `${category.name} restaurada.`)}>
                Restaurar categoria
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-ink/80">
                Arquivar tira a categoria da lista ao lançar contas novas. As contas que já usam ela continuam com o mesmo nome. Por isso uma
                categoria em uso nunca é apagada, só arquivada.
                {hasChildren && ' As subcategorias são arquivadas junto e voltam quando você restaurar esta.'}
              </p>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => void run(() => onUpdate(category.id, { archived: true }), `${category.name} arquivada.`)}>
                Arquivar categoria
              </Button>
            </>
          )}
        </div>
      )}
    </form>
  )
}
