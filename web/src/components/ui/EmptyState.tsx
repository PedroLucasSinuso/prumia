import type { ReactNode } from 'react'

type Props = {
  /** A frase principal ("Nenhuma conta neste mês."). */
  title: ReactNode
  /** Explicação curta opcional, em `text-muted`. */
  children?: ReactNode
  /** Ações (botões) que resolvem o vazio: "Lançar a primeira conta", "Importar". */
  actions?: ReactNode
  /** `compact`: uma linha só, para vazios dentro de cartões ("Nenhuma transferência neste mês."). */
  compact?: boolean
  className?: string
}

/**
 * Estado vazio: marcador `[ ▫ ]` (pendente/aguardando, do manual), a frase e o que fazer. Sobre um tom `sunken`, sem a
 * borda tracejada antiga: o vazio é calmo, não um "buraco". Substitui os 8 vazios tracejados.
 * Uso: `<EmptyState title="Nenhuma conta neste mês." actions={<Button>Lançar</Button>} />`.
 */
export function EmptyState({ title, children, actions, compact = false, className = '' }: Props) {
  if (compact) {
    return (
      <p className={`flex items-baseline gap-2 text-sm text-muted ${className}`}>
        <span aria-hidden="true" className="font-mono text-caption">[ ▫ ]</span>
        <span>{title}</span>
      </p>
    )
  }
  return (
    <div className={`flex flex-col items-start gap-3 rounded-md bg-sunken p-4 md:p-5 ${className}`}>
      <p className="flex items-baseline gap-2 text-body font-medium text-ink">
        <span aria-hidden="true" className="font-mono text-ui text-muted">[ ▫ ]</span>
        <span>{title}</span>
      </p>
      {children && <div className="max-w-prose text-sm text-muted">{children}</div>}
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}
