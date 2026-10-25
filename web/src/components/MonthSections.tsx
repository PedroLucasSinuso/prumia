import type { ComponentProps } from 'react'

import type { Section, SectionId } from '../lib/monthList'
import { formatCents } from '../lib/money'
import { Timeline } from './Timeline'
import { SectionRule } from './ui/SectionRule'

type Props = Omit<ComponentProps<typeof Timeline>, 'invoices' | 'marker' | 'columns'> & {
  sections: Section[]
  collapsed: SectionId[]
  onToggle: (id: SectionId) => void
}

/**
 * A lista do computador em seções recolhíveis (acordeão): Atrasadas · Daqui pra frente (com o losango HOJE) · Pagas (N).
 * Sem caixa em volta: cada seção abre com um `SectionRule` (rótulo, contagem, filete de 1px e total); "Atrasadas" em
 * `alert-text`. Pagas continuam visíveis e riscadas; recolher é escolha da pessoa e fica lembrado no aparelho (quem guarda
 * é a página).
 */
export function MonthSections({ sections, collapsed, onToggle, ...timeline }: Props) {
  return (
    <div className="flex flex-col gap-4">
      {sections.map((s) => {
        const open = !collapsed.includes(s.id)
        const panelId = `secao-${s.id}`
        return (
          <section key={s.id} aria-label={s.title}>
            <SectionRule
              title={s.title}
              count={s.items.length}
              total={formatCents(s.totalCents)}
              tone={s.id === 'overdue' ? 'alert' : 'default'}
              onToggle={() => onToggle(s.id)}
              expanded={open}
              controls={panelId}
            />
            {open && (
              // Abre crescendo a altura (grid 0fr -> 1fr, `motion-safe`); fechar é instantâneo para não deixar linhas focáveis escondidas.
              <div id={panelId} className="grid motion-safe:animate-expand">
                <div className="min-h-0 overflow-hidden pb-1">
                  <Timeline {...timeline} invoices={s.items} marker={s.id === 'upcoming'} columns />
                </div>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
