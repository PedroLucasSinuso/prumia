import { ChevronDown } from 'lucide-react'
import type { ComponentProps } from 'react'

import type { Section, SectionId } from '../lib/monthList'
import { formatCents } from '../lib/money'
import { Timeline } from './Timeline'

type Props = Omit<ComponentProps<typeof Timeline>, 'invoices' | 'marker' | 'columns'> & {
  sections: Section[]
  collapsed: SectionId[]
  onToggle: (id: SectionId) => void
}

/**
 * A lista do computador em seções recolhíveis (acordeão): Atrasadas · Daqui pra frente (com o losango HOJE) · Pagas (N).
 * Pagas continuam visíveis e riscadas; recolher é escolha da pessoa e fica lembrado no aparelho (quem guarda é a página).
 */
export function MonthSections({ sections, collapsed, onToggle, ...timeline }: Props) {
  return (
    <div className="flex flex-col gap-3">
      {sections.map((s) => {
        const open = !collapsed.includes(s.id)
        const panelId = `secao-${s.id}`
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
                <span className="text-xs font-semibold uppercase tracking-wider">
                  {s.title} <span className="font-mono font-medium text-ink/75">({s.items.length})</span>
                </span>
                {s.id === 'overdue' && <span aria-hidden="true" className="size-2 rounded-xs bg-alert" />}
                <span className="ml-auto font-mono text-[13px] font-semibold tabular-nums text-ink/85">{formatCents(s.totalCents)}</span>
              </button>
            </h3>
            {open && (
              <div id={panelId} className="border-t border-line pb-1">
                <Timeline {...timeline} invoices={s.items} marker={s.id === 'upcoming'} columns />
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
