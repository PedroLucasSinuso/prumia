import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'

type Props = {
  /** Rótulo da seção ("Atrasadas", "Pagas"). */
  title: string
  /** Quantos itens (aparece entre parênteses, em mono). */
  count?: number
  /** Total à direita ("R$ 1.500,00"), em mono. */
  total?: ReactNode
  /** `alert`: o rótulo em `alert-text` (seção de atrasadas). */
  tone?: 'default' | 'alert'
  /** Nível do cabeçalho (a estrutura da página decide). */
  as?: 'h2' | 'h3' | 'h4'
  /** Com `onToggle`, o cabeçalho vira um botão de recolher (acordeão): `expanded` + `controls` vão para o ARIA. */
  onToggle?: () => void
  expanded?: boolean
  controls?: string
  className?: string
}

/**
 * Cabeçalho de seção TIPOGRÁFICO: rótulo + (contagem) + um filete de 1px que ocupa o resto da linha + total à direita.
 * Substitui as caixas com borda em volta de cada seção: a separação vem do filete e do espaço, não de um contorno.
 *
 *   ATRASADAS (2) ───────────────────────────── R$ 1.700,00
 *
 * Com `onToggle`, a linha inteira é um botão (`aria-expanded`), com a seta à esquerda.
 * Uso: `<SectionRule title="Pagas" count={3} total="R$ 300,00" onToggle={…} expanded={open} controls="secao-pagas" />`.
 */
export function SectionRule({ title, count, total, tone = 'default', as: Tag = 'h3', onToggle, expanded, controls, className = '' }: Props) {
  const body = (
    <>
      {onToggle && (
        <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" className={`shrink-0 text-muted transition-transform motion-reduce:transition-none ${expanded ? '' : '-rotate-90'}`} />
      )}
      <span className={`shrink-0 text-meta font-semibold uppercase tracking-wider ${tone === 'alert' ? 'text-alert-text' : 'text-ink'}`}>
        {title}
        {count !== undefined && <span className="ml-1 font-mono font-medium text-muted">({count})</span>}
      </span>
      <span aria-hidden="true" className="h-px min-w-4 flex-1 bg-line" />
      {total !== undefined && <span className="shrink-0 font-mono text-ui font-semibold tabular-nums text-ink">{total}</span>}
    </>
  )
  return (
    <Tag className={className}>
      {onToggle ? (
        <button type="button" aria-expanded={expanded} aria-controls={controls} onClick={onToggle} className="-mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center gap-2 rounded-sm px-2 text-left transition-colors hover:bg-raised md:min-h-9">
          {body}
        </button>
      ) : (
        <span className="flex min-h-9 items-center gap-2">{body}</span>
      )}
    </Tag>
  )
}
