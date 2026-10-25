import type { ReactNode } from 'react'

/** Classes do rótulo pequeno em caixa alta (para quando ele precisa ser outro elemento, como um <dt> ou <legend>). */
export const eyebrowCls = 'text-caption font-medium uppercase tracking-wider text-muted'

/**
 * Rótulo de 11 px em caixa alta, com espaçamento aberto, em `text-muted`: o "olho" acima de um número ou de uma seção
 * ("a pagar no mês", "próximos 7 dias"). Substitui as cópias de `text-meta uppercase tracking-wider`.
 * `as="h2"`/`"h3"` quando ele é o título da região; `tone="inherit"` sobre o painel `structure`.
 */
export function Eyebrow({ children, as: Tag = 'p', tone = 'muted', className = '', id }: { children: ReactNode; as?: 'p' | 'span' | 'h2' | 'h3' | 'dt'; tone?: 'muted' | 'inherit' | 'alert'; className?: string; id?: string }) {
  const color = tone === 'muted' ? 'text-muted' : tone === 'alert' ? 'text-alert-text' : ''
  return (
    <Tag id={id} className={`text-caption font-medium uppercase tracking-wider ${color} ${className}`}>
      {children}
    </Tag>
  )
}
