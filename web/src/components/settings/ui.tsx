import type { ReactNode } from 'react'

import { Notice } from '../ui/Notice'
import { SectionTitle } from '../ui/SectionTitle'
import { Tag as UiTag } from '../ui/Tag'

/** Cabeçalho de uma seção de Ajustes: título, explicação curta e ações (à direita no computador). */
export function SectionHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <SectionTitle className="leading-tight">{title}</SectionTitle>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

/**
 * Bloco de Ajustes: superfície `raised` (profundidade por TOM, sem borda). `danger` (zona de risco) ganha só um filete
 * coral à esquerda. `label` vira o nome da região para leitor de tela e o título pequeno do bloco.
 */
export function Card({ label, title, children, tone = 'default', className = '' }: { label: string; title?: string; children: ReactNode; tone?: 'default' | 'danger'; className?: string }) {
  return (
    <section aria-label={label} className={`rounded-md bg-raised p-4 md:p-5 ${tone === 'danger' ? 'border-l-2 border-alert' : ''} ${className}`}>
      {title && <h3 className="text-meta font-medium uppercase tracking-wider text-muted">{title}</h3>}
      {children}
    </section>
  )
}

/** Aviso de erro de carregamento com "Tentar de novo". */
export function LoadError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <Notice className="mt-3" onRetry={onRetry}>
      Não foi possível carregar {what}.
    </Notice>
  )
}

/** Selo pequeno de metadado (só exceções: VR, essencial). Mesmo visual do `Tag` das primitivas. */
export function Tag({ children }: { children: ReactNode }) {
  return <UiTag>{children}</UiTag>
}
