import { useState } from 'react'
import { Check, Pencil, Trash2, X } from 'lucide-react'

import type { Income, SeriesScope } from '../api/types'
import { fullDate, monthLabel, weekdayShort } from '../lib/dates'
import { kindLabel, ruleText, stateMark, stateOf, stateText, stateTone, sumDeductions, unitText, untilText } from '../lib/income'
import { formatCents } from '../lib/money'
import { useWalletName } from '../lib/useWalletName'
import { Button } from './ui/Button'
import { DeleteRepetitionConfirm } from './DeleteRepetitionConfirm'

type Props = {
  income: Income
  personName: string
  /** Hoje (AAAA-MM-DD): "cai em 3 dias", "não caiu · atrasada 2 dias". */
  today: string
  canWrite: boolean
  busy: boolean
  /** "Caiu": desfaz o "não caiu" (ou marca como recebida antes da data). */
  onReceive: (income: Income) => void
  /** "Não caiu": o dinheiro previsto ainda não entrou. */
  onHold: (income: Income) => void
  onEdit: () => void
  onDelete: (income: Income, scope: SeriesScope) => void
  /** Excluir a repetição inteira (os previstos somem; recebidos ficam). Só aparece em receita que vem de uma repetição. */
  onDeleteRepetition?: (income: Income) => void
}

const label = 'text-caption font-medium uppercase tracking-wider text-muted'

/**
 * Detalhe da receita em modo LEITURA: o líquido, a situação (derivada: o recebimento é automático), quando cai em
 * linguagem natural, a repetição e as ações (Não caiu / Caiu, Editar, Excluir com escopo). Editar abre o formulário.
 */
export function IncomeDetail({ income, personName, today, canWrite, busy, onReceive, onHold, onEdit, onDelete, onDeleteRepetition }: Props) {
  const nameOf = useWalletName()
  const [confirming, setConfirming] = useState(false)
  const state = stateOf(income)
  const discounts = sumDeductions(income.deductions)
  const unit = unitText(income)

  const rows: Array<[string, string]> = [
    ['Cai em', `${fullDate(income.expectedDate)} · ${weekdayShort(income.expectedDate)}`],
    ['Regra', ruleText(income.dateRule)],
    ['Repetição', income.repeats ? `todo mês, ${untilText(income.repeatsUntil)}` : income.sourceId ? 'último mês da repetição' : 'não se repete'],
    ['Pessoa', personName],
    ['Tipo', `${kindLabel[income.kind]} · carteira ${nameOf(income.walletId)}`],
    ['Competência', monthLabel(income.competenceMonth)],
  ]
  if (income.notes) rows.push(['Observação', income.notes])

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className={label}>líquido</p>
        <p className="font-mono text-[40px] font-semibold leading-tight tracking-tight tabular-nums text-heading">{formatCents(income.netAmountCents)}</p>
        <p className="mt-1 flex items-center gap-2 text-sm font-medium">
          <span aria-hidden="true" className={`font-mono ${stateTone[state]}`}>{stateMark[state]}</span>
          {stateText(income, today)}
        </p>
        {state === 'held' && <p className="mt-1 text-meta text-muted">Fora do saldo até você dizer que caiu.</p>}
      </div>

      <dl className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] gap-x-4 gap-y-2.5 border-t border-line pt-4 text-sm">
        <div className="contents">
          <dt className="text-muted">Valor bruto</dt>
          <dd className="font-mono font-medium tabular-nums">
            {formatCents(income.grossAmountCents)}
            {unit && <span className="block font-sans text-meta font-normal text-muted">{unit}</span>}
          </dd>
        </div>
        <div className="contents">
          <dt className="text-muted">Descontos</dt>
          <dd className="font-medium">
            {discounts > 0 ? (
              <>
                <span className="font-mono tabular-nums">− {formatCents(discounts)}</span>
                <ul className="mt-0.5 text-meta font-normal text-muted">
                  {income.deductions.map((d, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span>{d.name}</span>
                      <span className="font-mono tabular-nums">{formatCents(d.amountCents)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              'sem descontos'
            )}
          </dd>
        </div>
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="whitespace-pre-line break-words font-medium">{v}</dd>
          </div>
        ))}
      </dl>

      {canWrite && (
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <div className="flex flex-wrap gap-2">
            {state === 'received' ? (
              <Button type="button" variant="secondary" disabled={busy} onClick={() => onHold(income)} className="flex flex-1 items-center justify-center gap-2 md:h-9">
                <X size={16} strokeWidth={1.5} aria-hidden="true" /> Não caiu
              </Button>
            ) : (
              <Button type="button" disabled={busy} onClick={() => onReceive(income)} className="flex flex-1 items-center justify-center gap-2 md:h-9">
                <Check size={16} strokeWidth={1.5} aria-hidden="true" /> Caiu
              </Button>
            )}
            <Button type="button" variant="secondary" onClick={onEdit} className="flex flex-1 items-center justify-center gap-2 md:h-9">
              <Pencil size={16} strokeWidth={1.5} aria-hidden="true" /> Editar
            </Button>
          </div>
          <div className="flex flex-wrap gap-x-4">
            <button type="button" onClick={() => onDelete(income, 'this')} className="flex h-11 items-center gap-1.5 text-sm font-semibold underline underline-offset-4 md:h-9">
              <Trash2 size={15} strokeWidth={1.5} aria-hidden="true" />
              {income.repeats ? 'Excluir só este mês' : 'Excluir receita'}
            </button>
            {income.repeats && (
              <button type="button" onClick={() => onDelete(income, 'following')} className="h-11 text-sm font-semibold underline underline-offset-4 md:h-9">
                Excluir este e os seguintes
              </button>
            )}
            {income.sourceId && onDeleteRepetition && !confirming && (
              <button type="button" onClick={() => setConfirming(true)} className="h-11 text-sm font-semibold underline underline-offset-4 md:h-9">
                Excluir esta repetição
              </button>
            )}
          </div>
          {confirming && (
            <DeleteRepetitionConfirm
              name={income.description}
              busy={busy}
              onConfirm={() => { setConfirming(false); onDeleteRepetition?.(income) }}
              onCancel={() => setConfirming(false)}
            />
          )}
        </div>
      )}
    </div>
  )
}
