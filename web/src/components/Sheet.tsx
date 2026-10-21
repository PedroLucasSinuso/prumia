import { useEffect, useId, type ReactNode } from 'react'

type Props = { title: string; onClose: () => void; children: ReactNode }

/**
 * Painel que sobe da base da tela (celular) ou fica centralizado (desktop). Fecha com Esc, com o botão
 * ou tocando fora. `role="dialog"` + `aria-modal` para leitores de tela.
 */
export function Sheet({ title, onClose, children }: Props) {
  const titleId = useId()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-graphite/50 sm:items-center" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-md border border-graphite/15 bg-ivory p-4 sm:rounded-md"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 id={titleId} className="text-xl font-semibold tracking-tight">
            {title}
          </h2>
          <button aria-label="Fechar" onClick={onClose} className="h-11 w-11 rounded-md text-xl text-graphite hover:bg-graphite/5">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
