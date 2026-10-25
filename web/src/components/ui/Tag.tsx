import type { ReactNode } from 'react'

/**
 * Selo pequeno de metadado (só exceções: VR, essencial, 3/6, padrão). Mono de 11 px sobre `sunken`, texto `muted`:
 * informa sem disputar atenção com o valor. `title` vira a dica (ex.: "Benefício").
 */
export function Tag({ children, title, className = '' }: { children: ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={`inline-flex h-5 shrink-0 items-center rounded-sm bg-sunken px-1.5 font-mono text-caption text-muted ${className}`}>
      {children}
    </span>
  )
}
