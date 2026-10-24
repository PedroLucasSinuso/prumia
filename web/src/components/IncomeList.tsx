import type { Income, Member } from '../api/types'
import { weekdayShort } from '../lib/dates'
import { kindShort, stateMark, stateOf, stateText, stateTone } from '../lib/income'
import { formatCents } from '../lib/money'
import { IncomeBadges } from './IncomeSections'

type Props = {
  incomes: Income[]
  members: Member[]
  today: string
  onOpen: (income: Income) => void
}

/**
 * A lista do CELULAR: uma linha por receita, alvo de toque inteiro (≥ 56 px). Sem "check": o recebimento é automático;
 * o estado aparece como marcador da marca (`[ ▪ ]` recebida, `[ ▫ ]` a receber, `[ ✖ ]` não caiu) e "Caiu / Não caiu" fica
 * no detalhe. O computador usa `IncomeSections`.
 */
export function IncomeList({ incomes, members, today, onOpen }: Props) {
  const person = (id: string) => members.find((m) => m.userId === id)?.name ?? 'Pessoa'
  return (
    <ul>
      {incomes.map((i) => {
        const state = stateOf(i)
        return (
          <li key={i.id} className="border-t border-line first:border-t-0">
            <button aria-label={`Detalhes de ${i.description}`} onClick={() => onOpen(i)} className="grid min-h-16 w-full grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-x-3 py-2 text-left">
              <span className="flex flex-col items-end leading-tight">
                <span className="font-mono text-[15px] font-semibold tabular-nums">{i.expectedDate.slice(8, 10)}</span>
                <span className="text-[11px] text-ink/75">{weekdayShort(i.expectedDate)}</span>
              </span>
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[15px] font-medium">{i.description}</span>
                  <IncomeBadges income={i} />
                </span>
                <span className="mt-0.5 block truncate text-xs text-ink/80">
                  {person(i.userId)} · {kindShort[i.kind]}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-xs">
                  <span aria-hidden="true" className={`font-mono ${stateTone[state]}`}>{stateMark[state]}</span>
                  {stateText(i, today)}
                </span>
              </span>
              <span className={`shrink-0 font-mono text-[15px] font-semibold tabular-nums ${state === 'received' ? 'text-accent' : ''}`}>{formatCents(i.netAmountCents)}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
