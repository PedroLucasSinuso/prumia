import { useState, type FormEvent } from 'react'

import { useReserve, useSetReserve } from '../../api/queries'
import { ApiError } from '../../api/errors'
import type { ReserveStatus, Wallet } from '../../api/types'
import { networkErrorMessage, problemMessage } from '../../auth/errors'
import { currentMonth } from '../../lib/dates'
import { Button } from '../ui/Button'
import { Notice } from '../ui/Notice'
import { useToast } from '../toastContext'
import { Card } from './ui'

const label = 'text-meta font-medium uppercase tracking-wider text-muted'
const select = 'h-11 rounded-md border border-line-strong bg-raised px-3 text-base text-ink md:h-9 md:text-sm'
const OPTIONS = [3, 6, 9, 12]

/**
 * Ajustes > Carteiras > Reserva de emergência (opcional): a meta em meses de gasto essencial e quais carteiras contam como
 * reserva. Só o Responsável altera; para os outros, aparece em leitura só quando há meta. O progresso aparece no Resumo.
 */
export function ReserveCard({ houseId, wallets, isAdmin }: { houseId: string; wallets: Wallet[]; isAdmin: boolean }) {
  const reserve = useReserve(houseId, currentMonth())
  if (!reserve.isSuccess) return null
  const configured = reserve.data.targetMonths != null
  if (!isAdmin && !configured) return null
  const names = wallets.filter((w) => reserve.data.walletIds.includes(w.id)).map((w) => w.name)

  if (!isAdmin) {
    return (
      <Card label="Reserva de emergência" title="reserva de emergência" className="mt-4">
        <p className="mt-1 text-sm text-ink">
          Meta: {reserve.data.targetMonths} meses de gasto essencial. Carteiras de reserva: {names.length ? names.join(', ') : 'nenhuma'}.
        </p>
        <p className="mt-1 text-meta text-muted">Só o Responsável da casa altera. O progresso aparece no Resumo.</p>
      </Card>
    )
  }
  // A key recria o formulário quando a configuração salva muda (o estado nasce dela, sem efeito para copiar).
  return <ReserveForm key={`${reserve.data.targetMonths ?? ''}|${reserve.data.walletIds.join(',')}`} houseId={houseId} wallets={wallets} reserve={reserve.data} />
}

function ReserveForm({ houseId, wallets, reserve }: { houseId: string; wallets: Wallet[]; reserve: ReserveStatus }) {
  const save = useSetReserve(houseId)
  const toast = useToast()
  const [target, setTarget] = useState(reserve.targetMonths == null ? '' : String(reserve.targetMonths))
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(reserve.walletIds))
  const [error, setError] = useState<string>()

  const options = Array.from(new Set([...OPTIONS, ...(reserve.targetMonths ? [reserve.targetMonths] : [])])).sort((a, b) => a - b)
  const active = wallets.filter((w) => !w.archived || chosen.has(w.id))

  async function onSave(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    try {
      await save.mutateAsync({ targetMonths: target === '' ? null : Number(target), walletIds: [...chosen] })
      toast({ message: target === '' ? 'Meta da reserva desligada.' : 'Meta da reserva salva. O progresso aparece no Resumo.' })
    } catch (err) {
      const api = err instanceof ApiError ? err : undefined
      setError(api?.network ? networkErrorMessage : problemMessage(api?.problem))
    }
  }

  return (
    <Card label="Reserva de emergência" title="reserva de emergência (opcional)" className="mt-4">
      <p className="mt-1 text-sm text-muted">
        Quantos meses de gasto essencial (moradia, mercado, saúde, transporte…) vocês querem guardados, e em quais carteiras esse
        dinheiro fica. O Resumo mostra quanto falta.
      </p>
      <form onSubmit={(e) => void onSave(e)} className="mt-3 flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className={label}>meta</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)} className={select}>
            <option value="">sem meta</option>
            {options.map((n) => (
              <option key={n} value={n}>
                {n} meses de gasto essencial
              </option>
            ))}
          </select>
        </label>
        <fieldset className="flex flex-col gap-1">
          <legend className={label}>carteiras que contam como reserva</legend>
          {active.map((w) => (
            <label key={w.id} className="flex min-h-11 items-center gap-2.5 text-sm text-ink md:min-h-9">
              <input
                type="checkbox"
                checked={chosen.has(w.id)}
                onChange={(e) => {
                  const next = new Set(chosen)
                  if (e.target.checked) next.add(w.id)
                  else next.delete(w.id)
                  setChosen(next)
                }}
                className="size-4 accent-[var(--color-accent)]"
              />
              {w.name}
            </label>
          ))}
        </fieldset>
        {error && <Notice>{error}</Notice>}
        <div>
          <Button type="submit" variant="secondary" loading={save.isPending}>
            Salvar reserva
          </Button>
        </div>
      </form>
    </Card>
  )
}
