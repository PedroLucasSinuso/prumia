import type { ReactNode } from 'react'

import { Button } from './Button'

type Props = {
  /** A frase do problema ("Não foi possível carregar as contas."). */
  children: ReactNode
  /** Mostra "Tentar de novo" (ou `retryLabel`) e chama isto. */
  onRetry?: () => void
  retryLabel?: string
  className?: string
}

/**
 * Aviso de erro (carregar, salvar): `role="alert"` (o leitor de tela anuncia), o marcador `[ ✖ ]` no coral (marca, não texto)
 * e a frase em `alert-text`, sobre `raised` com um filete coral à esquerda (`alert-text` sobre `sunken` não passa 4,5:1 no Marfim). Com `onRetry`, o botão "Tentar de novo".
 * Substitui as 7 cópias de "Não foi possível… Tentar de novo". Para o erro de um campo, use o `error` do próprio campo.
 * Uso: `<Notice onRetry={() => void q.refetch()}>Não foi possível carregar as contas.</Notice>`.
 */
export function Notice({ children, onRetry, retryLabel = 'Tentar de novo', className = '' }: Props) {
  return (
    <div role="alert" className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border-l-2 border-alert bg-raised px-3 py-2 ${className}`}>
      <p className="flex min-w-0 flex-1 items-baseline gap-2 text-sm font-medium text-alert-text">
        <span aria-hidden="true" className="shrink-0 font-mono text-alert">[ ✖ ]</span>
        <span>{children}</span>
      </p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  )
}
