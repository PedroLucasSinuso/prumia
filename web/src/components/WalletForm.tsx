import { useState, type FormEvent } from 'react'

import { ApiError } from '../api/errors'
import type { Member, Wallet, WalletInput, WalletPatch } from '../api/types'
import { networkErrorMessage, problemFields, problemMessage } from '../auth/errors'
import { Button } from './ui/Button'
import { Field } from './Field'
import { FormError } from './FormError'
import { MoneyInput } from './MoneyInput'
import { Combobox } from './ui/Combobox'
import { MonthPicker } from './ui/MonthPicker'
import { PanelFooter } from './ui/Panel'
import { Segmented } from './ui/Segmented'

type Props = {
  /** Sem carteira = criar uma nova. */
  wallet?: Wallet
  members: Member[]
  /** Só o Responsável da casa cria e altera carteiras. */
  canWrite: boolean
  onCreate: (body: WalletInput) => Promise<unknown>
  onUpdate: (id: string, body: WalletPatch) => Promise<unknown>
  onArchive: (id: string) => Promise<unknown>
  onRestore: (id: string) => Promise<unknown>
  /** Chamado depois de salvar, arquivar ou restaurar com sucesso. */
  onDone: (message: string) => void
}

/**
 * Carteira: nome, de quem é (só uma etiqueta: todo mundo da casa usa), saldo inicial, aviso de saldo insuficiente e,
 * em carteira existente, tornar padrão / arquivar. A carteira padrão recebe os lançamentos quando ninguém escolhe outra.
 */
export function WalletForm({ wallet, members, canWrite, onCreate, onUpdate, onArchive, onRestore, onDone }: Props) {
  const [name, setName] = useState(wallet?.name ?? '')
  const [ownerId, setOwnerId] = useState(wallet?.ownerUserId ?? '')
  const [opening, setOpening] = useState(Math.max(wallet?.openingBalanceCents ?? 0, 0))
  // Mês em que o saldo inicial passa a valer, "AAAA-MM" ('' = desde o início).
  const [startMonth, setStartMonth] = useState(wallet?.openingBalanceMonth?.slice(0, 7) ?? '')
  const [warn, setWarn] = useState(wallet?.warnOnOverdraft ?? true)
  const [error, setError] = useState<string>()
  const [fields, setFields] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

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
      } else if (e.problem?.code === 'wallet_exists') {
        setFields({ name: 'Já existe uma carteira com esse nome.' })
      } else if (e.problem?.code === 'wallet_is_default') {
        setError('A carteira padrão não pode ser arquivada. Escolha outra como padrão primeiro.')
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
      setFields({ name: 'Dê um nome à carteira.' })
      return
    }
    // Saldo inicial negativo vindo de fora é preservado: só mexe nele se a pessoa digitou outro valor.
    const openingChanged = opening !== Math.max(wallet?.openingBalanceCents ?? 0, 0)
    const startChanged = startMonth !== (wallet?.openingBalanceMonth?.slice(0, 7) ?? '')
    if (wallet) {
      void run(
        () =>
          onUpdate(wallet.id, {
            name: clean, ownerUserId: ownerId || null, warnOnOverdraft: warn,
            ...(openingChanged ? { openingBalanceCents: opening } : {}),
            // null no PATCH limpa o mês de início ("sem data: conta desde o início").
            ...(startChanged ? { openingBalanceMonth: startMonth ? `${startMonth}-01` : null } : {}),
          }),
        `${clean} salva.`,
      )
    } else {
      void run(() => onCreate({ name: clean, ...(ownerId ? { ownerUserId: ownerId } : {}), warnOnOverdraft: warn, openingBalanceCents: opening, ...(startMonth ? { openingBalanceMonth: `${startMonth}-01` } : {}) }), `${clean} criada.`)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex min-h-full flex-col gap-4">
      <FormError message={error} />
      <Field label="Nome" value={name} maxLength={40} disabled={!canWrite} hint="Ex.: Geral, Benefício, Reserva." error={fields.name}
        onChange={(e) => { setName(e.target.value); clear('name') }} />
      <Combobox
        label="de quem é (opcional)"
        options={members.map((m) => ({ value: m.userId, label: m.name }))}
        value={ownerId}
        emptyLabel="de todos"
        placeholder="de todos"
        disabled={!canWrite}
        onChange={(v) => { setOwnerId(v); clear('ownerUserId') }}
        error={fields.ownerUserId}
      />
      <p className="-mt-2 text-meta text-muted">É só uma etiqueta: quem pode lançar usa qualquer carteira.</p>
      <fieldset disabled={!canWrite} className="flex flex-col gap-1">
        <MoneyInput label="Saldo inicial" value={opening} onChange={setOpening} error={fields.openingBalanceCents} />
        <p className="text-meta text-muted">Quanto já havia nesta carteira antes do primeiro lançamento. Opcional.</p>
        <MonthPicker
          label="Saldo inicial vale a partir de" clearable placeholder="sem data: conta desde o início" value={startMonth}
          onChange={(m) => { setStartMonth(m); clear('openingBalanceMonth') }} error={fields.openingBalanceMonth}
          hint="Os meses antes deste aparecem normalmente, mas não entram no saldo que vem de trás. Use para começar do saldo real da sua conta."
        />
      </fieldset>
      <Segmented
        label="Avisar se o saldo ficar negativo ao pagar" value={warn ? 'yes' : 'no'} disabled={!canWrite}
        onChange={(v) => setWarn(v === 'yes')} options={[{ value: 'yes', label: 'sim' }, { value: 'no', label: 'não' }]}
      />

      {wallet && canWrite && (
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          {wallet.isDefault ? (
            <p className="text-sm text-muted">Esta é a carteira padrão: recebe os lançamentos quando você não escolhe outra. Para trocar, abra a carteira que será a padrão.</p>
          ) : wallet.archived ? (
            <>
              <p className="text-sm text-muted">Arquivada: não aparece ao lançar. O histórico e o saldo continuam. Restaure para voltar a usar.</p>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void run(() => onRestore(wallet.id), `${wallet.name} restaurada.`)}>
                Restaurar carteira
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void run(() => onUpdate(wallet.id, { isDefault: true }), `${wallet.name} agora é a padrão.`)}>
                Tornar padrão
              </Button>
              <p className="text-sm text-muted">Arquivar tira a carteira da lista ao lançar. O que já foi lançado nela continua.</p>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void run(() => onArchive(wallet.id), `${wallet.name} arquivada.`)}>
                Arquivar carteira
              </Button>
            </>
          )}
        </div>
      )}
      {canWrite && (
        <PanelFooter>
          <Button type="submit" loading={busy}>
            {wallet ? 'Salvar carteira' : 'Criar carteira'}
          </Button>
        </PanelFooter>
      )}
    </form>
  )
}
