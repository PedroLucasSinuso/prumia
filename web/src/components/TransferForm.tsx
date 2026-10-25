import { useState, type FormEvent } from 'react'

import { ApiError } from '../api/errors'
import type { TransferInput, TransferResult, Wallet } from '../api/types'
import { networkErrorMessage, problemFields, problemMessage } from '../auth/errors'
import { monthOf, todayISO } from '../lib/dates'
import { activeWallets, defaultWallet } from '../lib/wallets'
import { Button } from './ui/Button'
import { Field } from './Field'
import { FormError } from './FormError'
import { MoneyInput } from './MoneyInput'
import { Combobox } from './ui/Combobox'
import { DatePicker } from './ui/DatePicker'
import { PanelFooter } from './ui/Panel'

type Props = {
  wallets: Wallet[]
  /** Mês que está aberto no Resumo: a data começa hoje, se hoje cai nele; senão, no dia 1 dele. */
  month: string
  onCreate: (body: TransferInput) => Promise<TransferResult>
  /** Chamado depois de salvar, com o resultado (inclui o aviso de saldo) e o que foi enviado. */
  onDone: (result: TransferResult, sent: TransferInput) => void
}

/**
 * Transferir dinheiro entre carteiras (guardar na Reserva, tirar de lá): De, Para, valor, data e observação opcional.
 * Não é receita nem despesa, só muda o saldo das duas. Só carteiras ativas aparecem; origem e destino devem ser diferentes.
 * O servidor avisa (sem bloquear) se o saldo da origem ficar negativo: quem trata o aviso é `onDone`.
 */
export function TransferForm({ wallets, month, onCreate, onDone }: Props) {
  const options = activeWallets(wallets).map((w) => ({ value: w.id, label: w.name }))
  const firstFrom = defaultWallet(activeWallets(wallets))?.id ?? options[0]?.value ?? ''
  const [from, setFrom] = useState(firstFrom)
  const [to, setTo] = useState(options.find((o) => o.value !== firstFrom)?.value ?? '')
  const [cents, setCents] = useState(0)
  const today = todayISO()
  const [date, setDate] = useState(monthOf(today) === month ? today : month)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string>()
  const [fields, setFields] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const clear = (f: string) => setFields(({ [f]: _removed, ...rest }) => rest)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const problems: Record<string, string> = {}
    if (!from) problems.fromWalletId = 'Escolha a carteira de origem.'
    if (!to) problems.toWalletId = 'Escolha a carteira de destino.'
    else if (to === from) problems.toWalletId = 'Escolha uma carteira diferente da origem.'
    if (cents <= 0) problems.amountCents = 'Informe um valor maior que zero.'
    if (!date) problems.transferDate = 'Informe a data.'
    setFields(problems)
    setError(undefined)
    if (Object.keys(problems).length > 0) return

    const body: TransferInput = {
      fromWalletId: from, toWalletId: to, amountCents: cents, transferDate: date,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    }
    setBusy(true)
    try {
      onDone(await onCreate(body), body)
    } catch (err) {
      if (!(err instanceof ApiError) || err.network) {
        setError(networkErrorMessage)
      } else {
        setFields(problemFields(err.problem))
        setError(problemMessage(err.problem))
      }
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex min-h-full flex-col gap-4" noValidate>
      <FormError message={error} />
      <MoneyInput label="Valor" value={cents} onChange={(v) => { setCents(v); clear('amountCents') }} error={fields.amountCents} hero autoFocus />
      <Combobox label="De" options={options} value={from} onChange={(v) => { setFrom(v); clear('fromWalletId') }} error={fields.fromWalletId} />
      <Combobox label="Para" options={options} value={to} placeholder="escolha a carteira" onChange={(v) => { setTo(v); clear('toWalletId') }} error={fields.toWalletId} />
      <DatePicker label="Data" value={date} onChange={(v) => { setDate(v); clear('transferDate') }} error={fields.transferDate} />
      <Field label="Observação (opcional)" name="notes" autoComplete="off" maxLength={500} value={notes} onChange={(e) => { setNotes(e.target.value); clear('notes') }} error={fields.notes} />
      <p className="text-meta text-muted">Transferir não é receita nem conta: só move o saldo de uma carteira para a outra.</p>
      <PanelFooter>
        <Button type="submit" loading={busy} loadingLabel="Transferindo…">
          Transferir
        </Button>
      </PanelFooter>
    </form>
  )
}
