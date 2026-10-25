import { useState, type FormEvent } from 'react'

import { ApiError } from '../api/errors'
import type { WalletAdjustment, WalletAdjustmentInput, WalletBalance } from '../api/types'
import { networkErrorMessage, problemFields, problemMessage } from '../auth/errors'
import { monthName } from '../lib/dates'
import { formatCents, formatSignedCents } from '../lib/money'
import { Field } from './Field'
import { FormError } from './FormError'
import { MoneyInput } from './MoneyInput'
import { Button } from './ui/Button'
import { PanelFooter } from './ui/Panel'
import { Stat } from './ui/Stat'

type Props = {
  /** A carteira no mês aberto no Resumo (o `balanceCents` é o saldo calculado até o fim do mês). */
  balance: WalletBalance
  /** Mês conferido ("AAAA-MM-01"): o mesmo aberto no Resumo. */
  month: string
  onCreate: (body: WalletAdjustmentInput) => Promise<WalletAdjustment>
  onDone: (adjustment: WalletAdjustment) => void
}

/**
 * Conferir saldo: a pessoa olha o extrato e digita quanto há de verdade na carteira no fim do mês. A diferença para o
 * saldo calculado vira um ajuste naquele mês (não é receita nem conta) e os meses seguintes partem do saldo real.
 * O servidor recalcula a diferença na hora de gravar (a prévia aqui é só para a pessoa conferir antes).
 */
export function BalanceCheckForm({ balance, month, onCreate, onDone }: Props) {
  const [cents, setCents] = useState(0)
  const [negative, setNegative] = useState(false)
  const [touched, setTouched] = useState(false)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string>()
  const [fields, setFields] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const actual = negative ? -cents : cents
  const diff = actual - balance.balanceCents
  const name = monthName(month)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    setError(undefined)
    if (diff === 0) {
      setFields({ actualBalanceCents: 'O saldo já confere: não há diferença para ajustar.' })
      return
    }
    setFields({})
    const body: WalletAdjustmentInput = {
      walletId: balance.walletId, competenceMonth: month, actualBalanceCents: actual,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    }
    setBusy(true)
    try {
      onDone(await onCreate(body))
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
      <Stat label={`saldo calculado até o fim de ${name}`} value={formatCents(balance.balanceCents)} size="sm" note="recebido − pago ± transferências, desde o saldo inicial" />
      <MoneyInput
        label="Saldo real (o que o extrato mostra)"
        value={cents}
        onChange={(v) => { setCents(v); setTouched(true); setFields({}) }}
        error={fields.actualBalanceCents}
        hero
        autoFocus
      />
      <label className="flex min-h-11 items-center gap-2.5 text-sm text-ink md:min-h-9">
        <input type="checkbox" checked={negative} onChange={(e) => { setNegative(e.target.checked); setFields({}) }} className="size-4 accent-[var(--color-accent)]" />
        O saldo está negativo (cheque especial)
      </label>
      {touched && (
        <p aria-live="polite" className="rounded-md bg-sunken px-3 py-2 text-sm text-ink">
          {diff === 0 ? (
            <>
              <span aria-hidden="true" className="font-mono text-accent">[ ▪ ]</span> O saldo já confere.
            </>
          ) : (
            <>
              Diferença: <span className="font-mono font-semibold tabular-nums">{formatSignedCents(diff)}</span>. Vira um ajuste em {name}; os meses
              seguintes partem do saldo real.
            </>
          )}
        </p>
      )}
      <Field label="Observação (opcional)" name="notes" autoComplete="off" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} error={fields.notes} />
      <p className="text-meta text-muted">
        O ajuste não é receita nem conta: só corrige o saldo. Se depois você lançar um gasto esquecido deste mês, confira o saldo de novo.
      </p>
      <PanelFooter>
        <Button type="submit" loading={busy} loadingLabel="Conferindo…">
          Conferir saldo
        </Button>
      </PanelFooter>
    </form>
  )
}
