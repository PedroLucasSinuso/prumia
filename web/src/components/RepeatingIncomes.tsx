import { ChevronDown } from 'lucide-react'
import { useId, useState } from 'react'

import type { Income, IncomeSource, Member } from '../api/types'
import { monthLabel } from '../lib/dates'
import { kindShort, netOf, ruleText, untilText } from '../lib/income'
import { formatCents } from '../lib/money'
import { Button } from './Button'
import { DeleteRepetitionConfirm } from './DeleteRepetitionConfirm'

type Props = {
  sources: IncomeSource[]
  members: Member[]
  /** Mês exibido ("AAAA-MM-01"): "Encerrar" mantém este mês e remove os seguintes ainda não recebidos. */
  month: string
  /** A receita desta repetição no mês exibido (para "Editar" abrir o formulário já em "este e os seguintes"). */
  incomeOf: (sourceId: string) => Income | undefined
  canWrite: boolean
  busy: boolean
  onEdit: (income: Income) => void
  onEnd: (source: IncomeSource) => void
  /** Exclui a repetição: os próximos meses (previstos) somem, os já recebidos ficam. A tela mostra o Desfazer. */
  onDelete: (source: IncomeSource) => void
}

/**
 * Acordeão discreto no fim da página: as receitas que se repetem todo mês (o "molde"). Dá para ver a regra e o valor de
 * cada uma, abrir a edição (o formulário normal, já em "este e os seguintes") e encerrar a repetição.
 */
export function RepeatingIncomes({ sources, members, month, incomeOf, canWrite, busy, onEdit, onEnd, onDelete }: Props) {
  const [open, setOpen] = useState(false)
  const [ending, setEnding] = useState<string>()
  const [deleting, setDeleting] = useState<string>()
  const panelId = useId()
  const person = (id: string) => members.find((m) => m.userId === id)?.name ?? 'Pessoa'
  if (sources.length === 0) return null

  return (
    <section aria-label="Receitas que se repetem" className="rounded-md border border-line">
      <h2>
        <button
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
          className="flex h-11 w-full items-center gap-2 rounded-md px-3 text-left transition-colors hover:bg-ink/4"
        >
          <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" className={`transition-transform motion-reduce:transition-none ${open ? '' : '-rotate-90'}`} />
          <span className="text-xs font-semibold uppercase tracking-wider">
            Receitas que se repetem <span className="font-mono font-medium text-ink/75">({sources.length})</span>
          </span>
        </button>
      </h2>
      {open && (
        <ul id={panelId} className="border-t border-line">
          {sources.map((s) => {
            const finished = s.endMonth != null && s.endMonth < month
            const canEnd = canWrite && !finished && month >= s.startMonth && (s.endMonth == null || month < s.endMonth)
            const current = incomeOf(s.id)
            const value =
              s.amountMode === 'per_unit' && s.unitPriceCents != null
                ? `${formatCents(s.unitPriceCents)} por ${s.unitLabel ?? 'unidade'}`
                : formatCents(netOf(s.grossAmountCents, s.deductions))
            return (
              <li key={s.id} className="flex flex-col gap-2 border-t border-line px-3 py-2.5 first:border-t-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`truncate text-sm font-medium ${finished ? 'text-ink/60' : ''}`}>{s.name}</p>
                    <p className="truncate text-xs text-ink/75">
                      {person(s.userId)} · {kindShort[s.kind]} · {ruleText(s.dateRule)}
                    </p>
                    <p className="text-xs text-ink/75">
                      {finished ? `encerrada em ${s.endMonth!.slice(5, 7)}/${s.endMonth!.slice(0, 4)}` : untilText(s.endMonth)}
                    </p>
                  </div>
                  <span className="shrink-0 text-right font-mono text-sm font-semibold tabular-nums">{value}</span>
                </div>
                {canWrite && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    {!finished && (
                      <button
                        disabled={!current}
                        title={current ? undefined : 'Esta repetição não tem receita neste mês: troque de mês para editar.'}
                        onClick={() => current && onEdit(current)}
                        className="h-11 text-sm font-semibold text-accent underline underline-offset-4 disabled:text-ink/40 disabled:no-underline md:h-9"
                      >
                        Editar
                      </button>
                    )}
                    {canEnd && ending !== s.id && (
                      <button onClick={() => { setEnding(s.id); setDeleting(undefined) }} className="h-11 text-sm font-semibold underline underline-offset-4 md:h-9">
                        Encerrar
                      </button>
                    )}
                    {deleting !== s.id && (
                      <button onClick={() => { setDeleting(s.id); setEnding(undefined) }} aria-label={`Excluir ${s.name}`} className="h-11 text-sm font-semibold underline underline-offset-4 md:h-9">
                        Excluir
                      </button>
                    )}
                    {ending === s.id && (
                      <div role="group" aria-label={`Encerrar ${s.name}`} className="flex w-full flex-col gap-2 rounded-md bg-alert/10 px-3 py-2 text-sm">
                        <p>
                          Encerrar depois de {monthLabel(month)}? As receitas dos meses seguintes que ainda não caíram deixam de existir.
                        </p>
                        <div className="flex gap-2">
                          <Button type="button" disabled={busy} onClick={() => { onEnd(s); setEnding(undefined) }} className="md:h-9">
                            Encerrar a repetição
                          </Button>
                          <Button type="button" variant="ghost" onClick={() => setEnding(undefined)} className="md:h-9">
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    )}
                    {deleting === s.id && (
                      <DeleteRepetitionConfirm name={s.name} busy={busy} onConfirm={() => { onDelete(s); setDeleting(undefined) }} onCancel={() => setDeleting(undefined)} />
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
