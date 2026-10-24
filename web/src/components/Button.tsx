import type { ButtonHTMLAttributes } from 'react'

import { Spinner } from './ui/Spinner'

type Variant = 'primary' | 'ghost'

const styles: Record<Variant, string> = {
  primary: 'bg-structure text-on-structure hover:bg-structure/90 active:bg-structure/80 disabled:bg-structure/50',
  ghost: 'border border-ink/25 text-ink hover:border-ink/45 hover:bg-ink/5 active:bg-ink/10 disabled:opacity-50 disabled:hover:border-ink/25 disabled:hover:bg-transparent',
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  /** Operação em andamento: desabilita, mostra o spinner e troca o texto por `loadingLabel`. */
  loading?: boolean
  /** Texto enquanto carrega (padrão "Salvando…"). */
  loadingLabel?: string
}

/**
 * Botão da marca: raio de 6px (nunca pílula). Celular: 44px de altura (alvo de toque); computador: 36px.
 * Estados: hover, active (afunda 2% com `motion-safe`), foco visível (global), disabled e `loading`.
 * Uso: `<Button loading={busy} loadingLabel="Criando…">Criar</Button>`.
 */
export function Button({ variant = 'primary', loading, loadingLabel = 'Salvando…', className = '', children, disabled, ...props }: Props) {
  return (
    <button
      className={`h-11 rounded-md px-4 text-sm font-semibold transition-colors motion-safe:active:scale-[0.99] disabled:cursor-not-allowed md:h-9 ${styles[variant]} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <span className="inline-flex items-center justify-center gap-2">
          <Spinner />
          {loadingLabel}
        </span>
      ) : (
        children
      )}
    </button>
  )
}
