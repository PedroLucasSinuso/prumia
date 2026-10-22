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
  canWrite: boolean
  onCreate: (body: CategoryInput) => Promise<unknown>
  onUpdate: (id: string, body: CategoryPatch) => Promise<unknown>
  /** Chamado depois de salvar, arquivar ou restaurar com sucesso (a tela fecha o painel e avisa). */
  onDone: (message: string) => void
}

const label = 'text-xs font-medium uppercase tracking-wider text-graphite/70'
const chip = (on: boolean) =>
  `flex min-h-11 flex-1 items-center justify-center rounded-md border px-3 text-[13px] ${
    on ? 'border-teal bg-teal font-semibold text-ivory' : 'border-graphite/30 font-medium text-graphite hover:bg-graphite/5'
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
export function CategoryForm({ category, canWrite, onCreate, onUpdate, onDone }: Props) {
  const [name, setName] = useState(category?.name ?? '')
  const [wallet, setWallet] = useState<Wallet | null>(category?.defaultWallet ?? null)
  const [essential, setEssential] = useState(category?.isEssential ?? false)
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
      void run(() => onUpdate(category.id, { name: clean, defaultWallet: wallet, isEssential: essential }), `${clean} salva.`)
    } else {
      void run(() => onCreate({ name: clean, defaultWallet: wallet, isEssential: essential }), `${clean} criada.`)
    }
  }

  const archived = category?.archived ?? false

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

      <fieldset className="flex flex-col gap-1" disabled={!canWrite}>
        <legend className={label}>carteira padrão</legend>
        <div className="mt-1 flex gap-2">
          {wallets.map((w) => (
            <button key={w.text} type="button" aria-pressed={wallet === w.value} onClick={() => setWallet(w.value)} className={chip(wallet === w.value)}>
              {w.text}
            </button>
          ))}
        </div>
        <p className="text-xs text-graphite/70">Ao pagar uma conta desta categoria, o app já sugere esta carteira.</p>
      </fieldset>

      <fieldset className="flex flex-col gap-1" disabled={!canWrite}>
        <legend className={label}>gasto essencial?</legend>
        <div className="mt-1 flex gap-2">
          <button type="button" aria-pressed={essential} onClick={() => setEssential(true)} className={chip(essential)}>sim</button>
          <button type="button" aria-pressed={!essential} onClick={() => setEssential(false)} className={chip(!essential)}>não</button>
        </div>
        <p className="text-xs text-graphite/70">Essencial é o que não dá para cortar: moradia, mercado, saúde.</p>
      </fieldset>

      {canWrite && (
        <Button type="submit" disabled={busy}>
          {busy ? 'Salvando…' : category ? 'Salvar categoria' : 'Criar categoria'}
        </Button>
      )}

      {category && canWrite && (
        <div className="flex flex-col gap-2 border-t border-graphite/15 pt-4">
          {archived ? (
            <>
              <p className="text-sm text-graphite/80">Arquivada: não aparece ao lançar contas novas. Restaure para voltar a usar.</p>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => void run(() => onUpdate(category.id, { archived: false }), `${category.name} restaurada.`)}>
                Restaurar categoria
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-graphite/80">
                Arquivar tira a categoria da lista ao lançar contas novas. As contas que já usam ela continuam com o mesmo nome. Por isso uma
                categoria em uso nunca é apagada, só arquivada.
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
