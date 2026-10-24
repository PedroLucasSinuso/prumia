import { X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

import { canAnimate, EXIT_MS } from '../../lib/motion'
import { useBodyScrollLock } from '../../lib/scrollLock'
import { trapTab } from './focus'
import { Tooltip } from './Tooltip'

export type PanelProps = {
  title: string
  /** Linha de apoio sob o título ("Outubro de 2026", "Vence dia 20"). */
  subtitle?: string
  onClose: () => void
  children: ReactNode
  /** Rodapé FIXO (sempre visível, fora da rolagem): ação primária e secundária. Formulários podem usar `PanelFooter` no corpo. */
  footer?: ReactNode
  /** Seletor do elemento que recebe o foco ao abrir (padrão: o marcado com `data-autofocus`; sem ele, o próprio painel). */
  initialFocus?: string
  /** `side`: lateral de altura total, à direita (computador). `sheet`: sobe da base no celular e fica centralizado a partir de `sm`. */
  variant: 'side' | 'sheet'
}

/**
 * Cromo dos painéis modais (base de `SlideOver` e `Sheet`; prefira esses dois). Entrega:
 *
 * - cabeçalho (título, subtítulo opcional, botão fechar com dica "Esc"), corpo rolável e rodapé fixo opcional;
 * - `role="dialog"` + `aria-modal`, foco preso (Tab circula só dentro), foco inicial no `data-autofocus` e,
 *   ao fechar, o foco volta a quem abriu;
 * - fecha com Esc, com o × ou clicando no fundo. Popovers abertos dentro (calendário, lista) tratam o Esc antes;
 * - entrada e saída animadas (deslocamento + fade de 150-200 ms) e fade do fundo, tudo `motion-safe`. A saída vale para
 *   Esc/×/fundo: o painel toca a animação e SÓ ENTÃO chama `onClose`. Se o pai o desmontar sozinho (ex.: após salvar),
 *   sai sem animação.
 *
 * Em PHP/Laravel seria o "modal" do Bootstrap/Livewire, só que com acessibilidade de teclado de graça.
 */
export function Panel({ title, subtitle, onClose, children, footer, initialFocus, variant }: PanelProps) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const [closing, setClosing] = useState(false)
  // onClose muda a cada render de quem chama; o ref evita reinstalar os ouvintes (e perder o foco) a cada tecla.
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })
  useBodyScrollLock()
  const exit = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  function requestClose() {
    if (exit.current) return
    if (!canAnimate()) return close.current()
    setClosing(true)
    exit.current = setTimeout(() => close.current(), EXIT_MS)
  }
  const requestRef = useRef(requestClose)
  useEffect(() => {
    requestRef.current = requestClose
  })
  useEffect(() => () => clearTimeout(exit.current), [])

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const el = panel.current
    const first = el?.querySelector<HTMLElement>(initialFocus ?? '[data-autofocus]') || el
    first?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        requestRef.current()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (opener && document.contains(opener)) opener.focus()
    }
  }, [initialFocus])

  const side = variant === 'side'
  const backdrop = `fixed inset-0 z-40 flex bg-scrim/50 ${closing ? 'motion-safe:animate-fade-out' : 'motion-safe:animate-fade-in'} ${
    side ? 'justify-end' : 'items-end justify-center sm:items-center'
  }`
  const box = side
    ? `h-dvh max-h-dvh w-full max-w-[480px] border-l ${closing ? 'motion-safe:animate-slide-out' : 'motion-safe:animate-slide-in'}`
    : `max-h-[92dvh] min-h-0 w-full max-w-md rounded-t-md border sm:rounded-md ${closing ? 'motion-safe:animate-rise-out' : 'motion-safe:animate-rise-in'}`

  return (
    <div className={backdrop} onMouseDown={() => requestClose()}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`flex flex-col border-line bg-surface outline-none ${box}`}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => trapTab(e, panel.current)}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-2xl font-bold leading-tight text-heading font-stretch-condensed">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-sm text-ink/70">{subtitle}</p>}
          </div>
          <Tooltip label="Fechar" shortcut="Esc">
            <button
              type="button"
              aria-label="Fechar"
              onClick={() => requestClose()}
              className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-md text-ink transition-colors hover:bg-ink/8 active:bg-ink/12 md:size-9"
            >
              <X size={20} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
        {/* ÚNICO contêiner que rola: min-h-0 deixa o flex encolher, overscroll-contain impede a rolagem de vazar para a
            página e scroll-pb-24 faz o foco num campo do fim rolar até ele ficar acima do rodapé fixo. */}
        <div
          data-panel-body
          className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain scroll-pb-24 px-5 py-5"
          onFocus={(e) => e.target.scrollIntoView?.({ block: 'nearest' })}
        >
          {children}
        </div>
        {footer && (
          <div className="flex shrink-0 flex-col gap-2 border-t border-line bg-surface px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-6px_8px_-6px] shadow-ink/15 sm:flex-row-reverse sm:justify-start">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Rodapé de formulário que gruda no fim do painel (`sticky` dentro do corpo rolável, nunca `fixed` sobre a página; ocupa espaço no fluxo, então não cobre o último campo): a ação primária fica sempre à vista, mesmo
 * com o formulário comprido. Coloque como último filho de um `<form className="min-h-full flex flex-col …">`.
 * Fora de um painel (página comum) é só uma barra comum.
 */
export function PanelFooter({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-5 -mb-5 mt-auto flex flex-col gap-2 border-t border-line bg-surface px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-6px_8px_-6px] shadow-ink/15">
      {children}
    </div>
  )
}
