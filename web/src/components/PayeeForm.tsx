import { useState, type FormEvent } from 'react'

import { ApiError } from '../api/errors'
import { lookupCnpj } from '../api/queries'
import type { Category, CnpjInfo, Payee, PayeeInput, PayeePatch } from '../api/types'
import { networkErrorMessage, problemFields, problemMessage } from '../auth/errors'
import { buildTree } from '../lib/categories'
import { cnpjDigits, formatCnpj } from '../lib/cnpj'
import { Button } from './ui/Button'
import { Field } from './Field'
import { FormError } from './FormError'
import { Combobox } from './ui/Combobox'
import { PanelFooter } from './ui/Panel'

type Props = {
  /** Sem favorecido = criar um novo. */
  payee?: Payee
  /** Categorias ativas, para a categoria sugerida. */
  categories: Category[]
  canWrite: boolean
  onCreate: (body: PayeeInput) => Promise<unknown>
  onUpdate: (id: string, body: PayeePatch) => Promise<unknown>
  /** Chamado depois de salvar, arquivar ou restaurar com sucesso. */
  onDone: (message: string) => void
}


/**
 * Favorecido: o nome que a casa escolhe ("Gás") para quem recebe o pagamento, com CNPJ opcional (serve para
 * reconhecer o favorecido num boleto) e uma categoria sugerida. Quem só lê (viewer) vê os dados, sem botões de escrita.
 */
export function PayeeForm({ payee, categories, canWrite, onCreate, onUpdate, onDone }: Props) {
  const [name, setName] = useState(payee?.name ?? '')
  const [cnpj, setCnpj] = useState(payee?.cnpj ? formatCnpj(payee.cnpj) : '')
  const [legalName, setLegalName] = useState(payee?.legalName ?? '')
  const [categoryId, setCategoryId] = useState(payee?.defaultCategoryId ?? '')
  const [error, setError] = useState<string>()
  const [fields, setFields] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  // Empresa achada pelo CNPJ digitado (BrasilAPI): preenche a razão social e mostra o selo. Falha = silêncio.
  const [found, setFound] = useState<CnpjInfo>()

  const clear = (f: string) => setFields(({ [f]: _removed, ...rest }) => rest)

  async function run(call: () => Promise<unknown>, message: string) {
    setBusy(true)
    setError(undefined)
    setFields({})
    try {
      await call()
      onDone(message)
    } catch (e) {
      if (!(e instanceof ApiError) || e.network) {
        setError(networkErrorMessage)
      } else if (e.problem?.code === 'payee_exists') {
        setFields({ name: problemMessage(e.problem) })
      } else if (e.problem?.code === 'payee_cnpj_exists') {
        setFields({ cnpj: problemMessage(e.problem) })
      } else {
        setFields(problemFields(e.problem))
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
      setFields({ name: 'Dê um apelido ao favorecido.' })
      return
    }
    const digits = cnpjDigits(cnpj)
    if (digits && digits.length !== 14) {
      setFields({ cnpj: 'O CNPJ tem 14 dígitos.' })
      return
    }
    const body = { name: clean, cnpj: digits || null, legalName: legalName.trim() || null, defaultCategoryId: categoryId || null }
    if (payee) void run(() => onUpdate(payee.id, body), `${clean} salvo.`)
    else void run(() => onCreate(body), `${clean} criado.`)
  }

  const archived = payee?.archived ?? false

  return (
    <form onSubmit={onSubmit} className="flex min-h-full flex-col gap-4">
      <FormError message={error} />
      <Field label="Apelido" value={name} maxLength={60} disabled={!canWrite} hint="Como vocês chamam: Gás, Internet, Luz. Pode mudar quando quiser." error={fields.name}
        onChange={(e) => { setName(e.target.value); clear('name') }} />
      <Field label="CNPJ (opcional)" inputMode="numeric" autoComplete="off" value={cnpj} disabled={!canWrite} placeholder="00.000.000/0000-00"
        hint="Com o CNPJ, o prumia reconhece este favorecido nos boletos." error={fields.cnpj}
        onChange={(e) => {
          const masked = formatCnpj(e.target.value)
          setCnpj(masked)
          clear('cnpj')
          setFound(undefined)
          const digits = cnpjDigits(masked)
          if (digits.length === 14 && digits !== payee?.cnpj) {
            void lookupCnpj(digits).then((info) => {
              if (!info) return
              setFound(info)
              setLegalName((current) => current || info.legalName)
            })
          }
        }} />
      {found && (
        <p className="-mt-2 text-meta text-muted" aria-live="polite">
          <span aria-hidden="true" className="font-mono text-accent">[ ▪ ]</span> CNPJ conferido: {found.legalName}
          {found.tradeName ? ` (${found.tradeName})` : ''}
        </p>
      )}
      <Field label="Nome oficial (opcional)" value={legalName} maxLength={120} disabled={!canWrite} placeholder="GASCO DISTRIBUIDORA S/A" error={fields.legalName}
        onChange={(e) => { setLegalName(e.target.value); clear('legalName') }} />

      <Combobox
        label="categoria sugerida (opcional)"
        options={buildTree(categories).flatMap((n) => [
          { value: n.category.id, label: n.category.name },
          ...n.children.map((c) => ({ value: c.id, label: c.name, group: n.category.name })),
        ])}
        value={categoryId}
        emptyLabel="nenhuma"
        placeholder="nenhuma"
        disabled={!canWrite}
        onChange={(v) => { setCategoryId(v); clear('defaultCategoryId') }}
        error={fields.defaultCategoryId}
      />

      {payee && canWrite && (
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          {archived ? (
            <>
              <p className="text-sm text-muted">Arquivado: não aparece ao lançar contas novas. Restaure para voltar a usar.</p>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void run(() => onUpdate(payee.id, { archived: false }), `${payee.name} restaurado.`)}>
                Restaurar favorecido
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">Arquivar tira o favorecido da lista ao lançar contas novas. As contas antigas continuam com ele.</p>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void run(() => onUpdate(payee.id, { archived: true }), `${payee.name} arquivado.`)}>
                Arquivar favorecido
              </Button>
            </>
          )}
        </div>
      )}
      {canWrite && (
        <PanelFooter>
          <Button type="submit" loading={busy}>
            {payee ? 'Salvar favorecido' : 'Criar favorecido'}
          </Button>
        </PanelFooter>
      )}
    </form>
  )
}
