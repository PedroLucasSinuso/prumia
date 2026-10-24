import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'

type Props = {
  /** O texto da dica ("Fechar"). Curto: é uma dica, não um parágrafo. */
  label: string
  /** Atalho de teclado, mostrado ao lado em mono ("Esc", "N", "P"). */
  shortcut?: string
  /** Um único elemento focável (botão, link). Ele ganha `aria-describedby` enquanto a dica está visível. */
  children: ReactElement<{ 'aria-describedby'?: string }>
  /** Classes do invólucro (padrão `inline-flex`; use `flex w-full` para botões de largura total). */
  className?: string
  /** Atraso antes de aparecer com o mouse (ms). O foco por teclado mostra na hora. */
  delay?: number
}

const MARGIN = 8

/** Foco vindo do teclado (`:focus-visible`); se o navegador não souber responder, trata como teclado. */
function keyboardFocus(el: EventTarget): boolean {
  try {
    return (el as Element).matches(':focus-visible')
  } catch {
    return true
  }
}

/**
 * Dica ao passar o mouse ou focar com o teclado. Pensada para botões só de ícone e atalhos.
 *
 * - Aparece após ~400 ms de hover (e na hora com foco de teclado); some com Esc, ao sair, ao clicar ou ao perder o foco.
 * - Só reage a mouse/caneta: no toque (celular) não aparece, porque não há hover e atrapalharia.
 * - `role="tooltip"` num portal, posicionado acima do elemento (abaixo se faltar espaço) e sempre dentro da tela.
 * - Não substitui o `aria-label` do botão: o nome acessível continua sendo dele; a dica complementa (atalho, contexto).
 *
 * Uso: `<Tooltip label="Fechar" shortcut="Esc"><button aria-label="Fechar">…</button></Tooltip>`.
 */
export function Tooltip({ label, shortcut, children, delay = 400, className = 'inline-flex' }: Props) {
  const id = useId()
  const wrap = useRef<HTMLSpanElement>(null)
  const tip = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [show, setShow] = useState(false)
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' })

  const hide = () => {
    clearTimeout(timer.current)
    setShow(false)
  }
  const reveal = (wait: number) => {
    clearTimeout(timer.current)
    if (wait <= 0) setShow(true)
    else timer.current = setTimeout(() => setShow(true), wait)
  }
  useEffect(() => () => clearTimeout(timer.current), [])

  // Esc fecha só a dica (sem fechar o painel em volta, já que ela é a "coisa aberta" mais interna).
  useEffect(() => {
    if (!show) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        hide()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [show])

  useLayoutEffect(() => {
    if (!show) return
    const a = wrap.current?.getBoundingClientRect()
    const t = tip.current
    if (!a || !t) return
    const above = a.top - t.offsetHeight - 6 >= MARGIN
    const top = above ? a.top - t.offsetHeight - 6 : a.bottom + 6
    const center = a.left + a.width / 2 - t.offsetWidth / 2
    const left = Math.min(Math.max(MARGIN, center), Math.max(MARGIN, window.innerWidth - t.offsetWidth - MARGIN))
    setStyle({ position: 'fixed', top, left })
  }, [show, label, shortcut])

  return (
    <span
      ref={wrap}
      className={className}
      onPointerEnter={(e) => e.pointerType !== 'touch' && reveal(delay)}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(e) => keyboardFocus(e.target) && reveal(0)}
      onBlur={hide}
    >
      {cloneElement(children, show ? { 'aria-describedby': id } : {})}
      {show &&
        createPortal(
          <div
            ref={tip}
            id={id}
            role="tooltip"
            style={style}
            className="pointer-events-none z-[70] flex items-center gap-2 whitespace-nowrap rounded-sm bg-ink px-2 py-1 text-xs font-medium text-surface motion-safe:animate-fade-in"
          >
            {label}
            {shortcut && <kbd className="rounded-xs border border-surface/40 px-1 font-mono text-[11px] leading-4">{shortcut}</kbd>}
          </div>,
          document.body,
        )}
    </span>
  )
}
