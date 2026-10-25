import { useState, type FormEvent } from 'react'

import { ApiError } from '../api/errors'
import { useWallets } from '../api/queries'
import { useActiveHouse } from '../auth/useActiveHouse'
import type { Category, CategoryInput, CategoryPatch } from '../api/types'
import { spendableWallets } from '../lib/wallets'
import { networkErrorMessage, problemFields, problemMessage } from '../auth/errors'
import { Button } from './ui/Button'
import { Field } from './Field'
import { FormError } from './FormError'
import { Combobox } from './ui/Combobox'
import { PanelFooter } from './ui/Panel'
import { Segmented } from './ui/Segmented'

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

/**
 * Criar ou editar uma categoria: nome, carteira sugerida ao pagar e se é gasto essencial.
 * Arquivar/restaurar ficam aqui também. Quem só lê (viewer) vê os dados, sem botões de escrita.
 */
export function CategoryForm({ category, all, defaultParentId, canWrite, onCreate, onUpdate, onDone }: Props) {
  const { house } = useActiveHouse()
  const walletList = useWallets(house?.id ?? '').data
  const walletOptions = [...spendableWallets(walletList ?? []).map((w) => ({ value: w.id, label: w.name })), { value: 'none', label: 'nenhuma' }]
  const [name, setName] = useState(category?.name ?? '')
  // Subcategoria nasce com a carteira e o "essencial" da mãe (a pessoa pode mudar): menos coisa para preencher.
  const initialParent = category?.parentId ?? defaultParentId ?? ''
  const parentOf = (id: string) => all.find((c) => c.id === id)
  const [parentId, setParentId] = useState(initialParent)
  const [wallet, setWallet] = useState<string | null>(category ? (category.defaultWalletId ?? null) : (parentOf(initialParent)?.defaultWalletId ?? null))
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
      void run(() => onUpdate(category.id, { name: clean, defaultWalletId: wallet, isEssential: essential, ...moved }), `${clean} salva.`)
    } else {
      void run(() => onCreate({ name: clean, defaultWalletId: wallet, isEssential: essential, ...(parentId ? { parentId } : {}) }), `${clean} criada.`)
    }
  }

  const archived = category?.archived ?? false
  const hasChildren = category ? all.some((c) => c.parentId === category.id) : false
  // Mães possíveis: categorias de topo, ativas, que não sejam ela mesma (só dois níveis).
  const parents = all.filter((c) => !c.parentId && !c.archived && c.id !== category?.id)

  return (
    <form onSubmit={onSubmit} className="flex min-h-full flex-col gap-4">
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
        <p className="text-sm text-muted">Esta categoria tem subcategorias, então é uma categoria principal.</p>
      ) : (
        parents.length > 0 && (
          <Combobox
            label="dentro de"
            options={parents.map((c) => ({ value: c.id, label: c.name }))}
            value={parentId}
            emptyLabel="nenhuma (categoria principal)"
            placeholder="nenhuma (categoria principal)"
            disabled={!canWrite}
            hint="Ex.: Gás dentro de Moradia. O gráfico de Moradia soma o gás."
            onChange={(next) => {
              setParentId(next)
              const mother = parentOf(next)
              if (!category && mother) { setWallet(mother.defaultWalletId ?? null); setEssential(mother.isEssential) }
            }}
          />
        )
      )}

      <fieldset className="flex flex-col gap-1" disabled={!canWrite}>
        <Segmented label="carteira padrão" value={wallet ?? 'none'} onChange={(v) => setWallet(v === 'none' ? null : v)} options={walletOptions} />
        <p className="text-meta text-muted">Ao pagar uma conta desta categoria, o app já sugere esta carteira.</p>
      </fieldset>

      <fieldset className="flex flex-col gap-1" disabled={!canWrite}>
        <Segmented label="gasto essencial?" value={essential ? 'yes' : 'no'} onChange={(v) => setEssential(v === 'yes')} options={[{ value: 'yes', label: 'sim' }, { value: 'no', label: 'não' }]} />
        <p className="text-meta text-muted">Essencial é o que não dá para cortar: moradia, mercado, saúde.</p>
      </fieldset>

      {category && canWrite && (
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          {archived ? (
            <>
              <p className="text-sm text-muted">Arquivada: não aparece ao lançar contas novas. Restaure para voltar a usar.</p>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void run(() => onUpdate(category.id, { archived: false }), `${category.name} restaurada.`)}>
                Restaurar categoria
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">
                Arquivar tira a categoria da lista ao lançar contas novas. As contas que já usam ela continuam com o mesmo nome. Por isso uma
                categoria em uso nunca é apagada, só arquivada.
                {hasChildren && ' As subcategorias são arquivadas junto e voltam quando você restaurar esta.'}
              </p>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void run(() => onUpdate(category.id, { archived: true }), `${category.name} arquivada.`)}>
                Arquivar categoria
              </Button>
            </>
          )}
        </div>
      )}
      {canWrite && (
        <PanelFooter>
          <Button type="submit" loading={busy}>
            {category ? 'Salvar categoria' : 'Criar categoria'}
          </Button>
        </PanelFooter>
      )}

    </form>
  )
}
