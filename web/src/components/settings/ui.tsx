import type { ReactNode } from 'react'

/** Cabeçalho de uma seção de Ajustes: título, explicação curta e ações (à direita no computador). */
export function SectionHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h2 className="font-display text-[26px] font-bold leading-tight text-structure font-stretch-condensed">{title}</h2>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink/80">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

/** Bloco com borda fina. `label` vira o nome da região para leitor de tela e o título pequeno do bloco. */
export function Card({ label, title, children, tone = 'default', className = '' }: { label: string; title?: string; children: ReactNode; tone?: 'default' | 'danger'; className?: string }) {
  return (
    <section aria-label={label} className={`rounded-md border p-4 md:p-5 ${tone === 'danger' ? 'border-alert/50' : 'border-line'} ${className}`}>
      {title && <h3 className="text-xs font-medium uppercase tracking-wider text-ink/75">{title}</h3>}
      {children}
    </section>
  )
}

/** Aviso de erro de carregamento com "Tentar de novo". */
export function LoadError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <p role="alert" className="mt-3 rounded-md border border-alert/60 bg-alert/10 px-3 py-2 text-sm">
      <span className="font-mono text-alert">[ ✖ ]</span> Não foi possível carregar {what}.{' '}
      <button className="h-11 font-semibold underline md:h-9" onClick={onRetry}>
        Tentar de novo
      </button>
    </p>
  )
}

/** Selo pequeno de metadado (só exceções: VR, essencial). */
export function Tag({ children }: { children: ReactNode }) {
  return <span className="inline-flex h-5 items-center rounded-sm border border-line px-1.5 font-mono text-[11px] text-ink/80">{children}</span>
}
