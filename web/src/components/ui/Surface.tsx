import type { HTMLAttributes, ReactNode } from 'react'

export type SurfaceTone = 'raised' | 'flat' | 'sunken' | 'structure'

const tones: Record<SurfaceTone, string> = {
  // Um tom acima do fundo: cartões e o bloco de destaque. É a profundidade padrão.
  raised: 'bg-raised',
  // Sem fundo próprio: agrupa sobre o `surface` (colunas de contexto, listas com filetes).
  flat: '',
  // Um tom abaixo: poço, trilho, área "de apoio".
  sunken: 'bg-sunken',
  // Bloco sólido da marca (barra de seleção, raros destaques). Texto em `on-structure`.
  structure: 'bg-structure text-on-structure',
}

const pads = { md: 'p-4 md:p-5', sm: 'p-3 md:p-4', none: '' } as const

type Props = HTMLAttributes<HTMLElement> & {
  tone?: SurfaceTone
  /** Respiro interno: `md` = 16/20 px (padrão), `sm` = 12/16 px, `none` = quem usa decide. */
  pad?: keyof typeof pads
  /** Elemento HTML: `section` (com `aria-label`, vira uma região), `div`, `article`, `aside`. */
  as?: 'section' | 'div' | 'article' | 'aside'
  children: ReactNode
}

/**
 * Superfície da direção "Instrumento calmo": a hierarquia vem do TOM (raised acima do fundo, sunken abaixo), não de borda
 * nem de sombra. Substitui os blocos `rounded-md border border-line`. Raio de 6px.
 * Uso: `<Surface as="section" aria-label="Pagamento">…</Surface>`, `<Surface tone="sunken" pad="sm">…</Surface>`.
 */
export function Surface({ tone = 'raised', pad = 'md', as: Tag = 'div', className = '', children, ...rest }: Props) {
  return (
    <Tag data-tone={tone} className={`rounded-md ${tones[tone]} ${pads[pad]} ${className}`} {...rest}>
      {children}
    </Tag>
  )
}
