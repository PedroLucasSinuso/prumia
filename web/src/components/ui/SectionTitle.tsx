import type { ReactNode } from 'react'

const sizes = { page: 'text-page-sm md:text-page', section: 'text-section', title: 'text-title' } as const

/**
 * Título de seção em Archivo condensada (`font-display font-stretch-condensed`), cor `heading`.
 * `size`: `section` (28 px, padrão: "Contas do mês", seções de Ajustes), `title` (22 px: painéis e modais),
 * `page` (36/40 px: o título da tela). O nível do cabeçalho (`as`) é escolhido pela estrutura da página, não pelo tamanho.
 */
export function SectionTitle({ children, as: Tag = 'h2', size = 'section', className = '', id }: { children: ReactNode; as?: 'h1' | 'h2' | 'h3'; size?: keyof typeof sizes; className?: string; id?: string }) {
  return (
    <Tag id={id} className={`font-display font-bold text-heading font-stretch-condensed ${sizes[size]} ${className}`}>
      {children}
    </Tag>
  )
}
