import { X } from 'lucide-react'
import { useEffect, useId, type ReactNode } from 'react'

import { ICON } from '../../lib/navigation'
import { Sheet } from '../Sheet'

type Props = { desktop: boolean; title: string; onClose: () => void; children: ReactNode }

/**
 * Detalhe/edição de um item de Ajustes (categoria, favorecido).
 * - Celular: painel que sobe da base (Sheet).
 * - Computador: painel lateral NÃO modal (a lista continua clicável: escolher outra linha troca o painel). Em telas
 *   largas (xl) ele ocupa a coluna da direita, ao lado da lista; abaixo disso, desliza por cima da borda direita.
 *   Esc fecha.
 * Use dentro de <DetailLayout>, que reserva a coluna.
 */
export function DetailPanel({ desktop, title, onClose, children }: Props) {
  const titleId = useId()
  useEffect(() => {
    if (!desktop) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [desktop, onClose])

  if (!desktop) return <Sheet title={title} onClose={onClose}>{children}</Sheet>
  return (
    <section
      aria-labelledby={titleId}
      className="fixed inset-y-0 right-0 z-30 w-full max-w-md overflow-y-auto border-l border-line bg-surface p-5 shadow-xl xl:sticky xl:top-6 xl:z-auto xl:max-h-[calc(100dvh-3rem)] xl:max-w-none xl:self-start xl:rounded-md xl:border xl:shadow-none"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 id={titleId} className="min-w-0 truncate font-display text-[22px] font-bold text-heading font-stretch-condensed">
          {title}
        </h3>
        <button type="button" aria-label="Fechar detalhes" onClick={onClose} className="flex size-9 shrink-0 items-center justify-center rounded-md hover:bg-ink/6">
          <X aria-hidden="true" size={ICON.size} strokeWidth={ICON.strokeWidth} />
        </button>
      </div>
      {children}
    </section>
  )
}

/** Lista + painel: com o painel aberto em tela larga, duas colunas (a lista não fica escondida atrás dele). */
export function DetailLayout({ open, children }: { open: boolean; children: ReactNode }) {
  return <div className={open ? 'xl:grid xl:grid-cols-[minmax(0,1fr)_400px] xl:items-start xl:gap-6' : ''}>{children}</div>
}
