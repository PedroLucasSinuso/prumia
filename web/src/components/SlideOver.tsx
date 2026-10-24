import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'

type Props = {
  title: string
  onClose: () => void
  children: ReactNode
  /** Seletor do elemento que recebe o foco ao abrir (padrão: o marcado com `data-autofocus`; sem ele, o próprio painel). */
  initialFocus?: string
}

const focusable = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Painel lateral de altura total, à direita (computador). Fecha com Esc, com o × ou clicando fora. Enquanto aberto,
 * o Tab circula só dentro dele (foco preso) e, ao fechar, o foco volta para quem o abriu.
 * `role="dialog"` + `aria-modal` para leitores de tela. Celular usa o `Sheet` (sobe da base).
 */
export function SlideOver({ title, onClose, children, initialFocus }: Props) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  // onClose muda a cada render de quem chama; o ref evita reinstalar os ouvintes (e perder o foco) a cada tecla.
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const el = panel.current
    const first = el?.querySelector<HTMLElement>(initialFocus ?? '[data-autofocus]') || el
    first?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close.current()
        return
      }
      if (e.key !== 'Tab' || !el) return
      const items = Array.from(el.querySelectorAll<HTMLElement>(focusable))
      if (items.length === 0) return
      const [head, tail] = [items[0], items[items.length - 1]]
      if (e.shiftKey && document.activeElement === head) {
        e.preventDefault()
        tail.focus()
      } else if (!e.shiftKey && document.activeElement === tail) {
        e.preventDefault()
        head.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (opener && document.contains(opener)) opener.focus()
    }
  }, [initialFocus])

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/40 motion-safe:animate-fade-in" onMouseDown={() => close.current()}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex h-dvh w-full max-w-[480px] flex-col border-l border-line bg-surface outline-none motion-safe:animate-slide-in"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 border-b border-line px-6 py-4">
          <h2 id={titleId} className="font-display text-2xl font-bold text-heading font-stretch-condensed">
            {title}
          </h2>
          <button aria-label="Fechar" title="Fechar (Esc)" onClick={() => close.current()} className="flex size-9 items-center justify-center rounded-md text-ink hover:bg-ink/5">
            <X size={20} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  )
}
