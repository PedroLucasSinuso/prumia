import { ChevronDown } from 'lucide-react'

import type { Income, Member } from '../api/types'
import { weekdayShort } from '../lib/dates'
import { kindShort, stateMark, stateOf, stateText, stateTone, type IncomeSection, type SectionId } from '../lib/income'
import { formatCents } from '../lib/money'

type RowActions = {
  members: Member[]
  today: string
  selectedId?: string
  canWrite: boolean
  busy: boolean
  /** "Caiu" / "Não caiu" (ação rápida ao passar o mouse). */
  onReceive: (income: Income) => void
  onHold: (income: Income) => void
  onOpen: (income: Income) => void
}

type Props = RowActions & {
  sections: IncomeSection[]
  collapsed: SectionId[]
  onToggle: (id: SectionId) => void
}

/**
 * A lista do computador em seções recolhíveis (acordeão): "A receber" e "Recebidas" (ou uma seção por pessoa). Colunas:
 * data · descrição (com os selos `repete` e `por unidade`) · pessoa · tipo · estado · líquido. O recebimento é automático,
 * então não há "check" na linha: o estado vem do servidor e a ação rápida ao passar o mouse é "Não caiu" / "Caiu".
 */
export function IncomeSections({ sections, collapsed, onToggle, ...rows }: Props) {
  return (
    <div className="flex flex-col gap-3">
      {sections.map((s) => {
        const open = !collapsed.includes(s.id)
        const panelId = `secao-receitas-${s.id}`
        return (
          <section key={s.id} aria-label={s.title} className="rounded-md border border-line">
            <h3>
              <button
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => onToggle(s.id)}
                className="flex h-10 w-full items-center gap-2 rounded-md px-3 text-left transition-colors hover:bg-ink/4"
              >
                <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" className={`transition-transform motion-reduce:transition-none ${open ? '' : '-rotate-90'}`} />
                <span className="text-meta font-semibold uppercase tracking-wider">
                  {s.title} <span className="font-mono font-medium text-muted">({s.items.length})</span>
                </span>
                <span className="ml-auto font-mono text-ui font-semibold tabular-nums text-muted">{formatCents(s.totalCents)}</span>
              </button>
            </h3>
            {open && (
              <ul id={panelId} className="border-t border-line pb-1">
                {s.items.map((i) => (
                  <IncomeRow key={i.id} income={i} {...rows} />
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}

/** Selos pequenos ao lado da descrição. */
export function IncomeBadges({ income }: { income: Income }) {
  return (
    <>
      {income.repeats && <span className="shrink-0 rounded-xs border border-line-strong px-1 font-mono text-caption text-muted">repete</span>}
      {income.amountMode === 'per_unit' && <span className="shrink-0 rounded-xs border border-line-strong px-1 font-mono text-caption text-muted">por unidade</span>}
    </>
  )
}

function IncomeRow({ income: i, members, today, selectedId, canWrite, busy, onReceive, onHold, onOpen }: RowActions & { income: Income }) {
  const state = stateOf(i)
  const person = members.find((m) => m.userId === i.userId)?.name ?? 'Pessoa'
  const open = i.id === selectedId
  return (
    <li className={`group relative grid min-h-12 grid-cols-[64px_minmax(0,1fr)_96px] items-center border-l-2 pl-1.5 transition-colors ${open ? 'border-structure bg-structure/7' : 'border-transparent hover:bg-ink/4'}`}>
      <span className="flex items-baseline justify-end gap-1 pr-3 leading-tight">
        <span className="font-mono text-body font-semibold tabular-nums">{i.expectedDate.slice(8, 10)}</span>
        <span className="text-caption text-muted">{weekdayShort(i.expectedDate)}</span>
      </span>
      <button
        aria-label={`Detalhes de ${i.description}`}
        data-row-id={i.id}
        onClick={() => onOpen(i)}
        className="grid min-h-12 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-1.5 pl-1 text-left outline-offset-[-2px] @lg:grid-cols-[minmax(0,1fr)_11rem_7.5rem] @3xl:grid-cols-[minmax(0,1fr)_6rem_5.5rem_11.5rem_7.5rem]"
      >
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium">{i.description}</span>
            <IncomeBadges income={i} />
          </span>
          <span className="block truncate text-meta text-muted @3xl:hidden">
            {person} · {kindShort[i.kind]}
            <span className="@lg:hidden"> · {stateText(i, today)}</span>
          </span>
        </span>
        <span className="hidden truncate text-ui text-muted @3xl:block">{person}</span>
        <span className="hidden truncate text-ui text-muted @3xl:block">{kindShort[i.kind]}</span>
        <span className="hidden items-center gap-1.5 text-ui @lg:flex">
          <span aria-hidden="true" className={`shrink-0 whitespace-nowrap font-mono text-meta ${stateTone[state]}`}>{stateMark[state]}</span>
          <span className="truncate">{stateText(i, today)}</span>
        </span>
        <span className={`text-right font-mono text-sm font-semibold tabular-nums ${state === 'received' ? 'text-accent' : state === 'held' ? 'text-ink' : 'text-muted'}`}>
          {formatCents(i.netAmountCents)}
        </span>
      </button>
      {/* Atalho visual para o mouse; teclado e leitor de tela usam o painel de detalhe (Caiu / Não caiu). */}
      <span className="flex justify-center">
        {canWrite && (
          <button
            tabIndex={-1}
            aria-hidden="true"
            disabled={busy}
            onClick={() => (state === 'received' ? onHold(i) : onReceive(i))}
            className="h-8 rounded-sm px-2 text-meta font-semibold text-accent underline underline-offset-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 disabled:text-muted"
          >
            {state === 'received' ? 'não caiu' : 'caiu'}
          </button>
        )}
      </span>
    </li>
  )
}
