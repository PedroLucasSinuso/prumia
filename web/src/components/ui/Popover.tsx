import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

type Props = {
  open: boolean
  /** Elemento de referência (o gatilho). O popover aparece abaixo dele, ou acima se faltar espaço. */
  anchorRef: RefObject<HTMLElement | null>
  /** Esc, clique fora ou Tab para fora pedem para fechar. */
  onClose: () => void
  children: ReactNode
  /** Igual à largura do gatilho (listas de Combobox). Padrão: largura do conteúdo. */
  matchWidth?: boolean
  /** `role` do contêiner (ex.: "dialog" para o calendário). Sem papel = só um contêiner visual. */
  role?: string
  'aria-label'?: string
  id?: string
  className?: string
  /** Esc dentro do popover chama `onClose` e NÃO sobe para o painel que o contém. Padrão: sim. */
  trapEscape?: boolean
}

const GAP = 4
const MARGIN = 8

/**
 * Base de DatePicker, MonthPicker e Combobox: uma caixa flutuante ancorada a um elemento.
 *
 * - Renderiza num portal (`document.body`) com `position: fixed`, então não é cortada por painéis com rolagem.
 * - Posiciona abaixo do gatilho; se não couber, vai para cima; nunca sai da tela na horizontal.
 * - Fecha com Esc (sem fechar o painel/Sheet em volta) e ao clicar fora do popover e do gatilho.
 * - Reposiciona ao rolar/redimensionar. Entrada com fade curto, só em `motion-safe`.
 * - Foco: o Popover NÃO mexe no foco. Quem o usa decide (o calendário foca o dia; o Combobox mantém o foco no campo).
 *
 * Uso: `<Popover open={open} anchorRef={btnRef} onClose={() => setOpen(false)}>…</Popover>`.
 * Em PHP/Laravel seria o "dropdown" do Alpine/Bootstrap, só que sem biblioteca.
 */
export function Popover({ open, anchorRef, onClose, children, matchWidth, role, id, className = '', trapEscape = true, ...rest }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', top: 0, left: 0, visibility: 'hidden' })
  // Já nasce `fixed`: medido como bloco comum, o popover ocupava a largura da tela e o cálculo de `left` o jogava para a
  // borda esquerda sempre que o pai não re-renderizava logo depois (ex.: o calendário dentro do modal de importação).
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const a = anchorRef.current?.getBoundingClientRect()
      const b = box.current
      if (!a || !b) return
      const h = b.offsetHeight
      const w = matchWidth ? a.width : b.offsetWidth
      const below = window.innerHeight - a.bottom - GAP - MARGIN
      const above = a.top - GAP - MARGIN
      const up = h > below && above > below
      const maxHeight = Math.max(160, up ? above : below)
      const top = up ? Math.max(MARGIN, a.top - GAP - Math.min(h, maxHeight)) : a.bottom + GAP
      const left = Math.min(Math.max(MARGIN, a.left), Math.max(MARGIN, window.innerWidth - w - MARGIN))
      setStyle({ position: 'fixed', top, left, maxHeight, ...(matchWidth ? { width: a.width } : {}) })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, anchorRef, matchWidth, children])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node
      if (box.current?.contains(t) || anchorRef.current?.contains(t)) return
      close.current()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [open, anchorRef])

  if (!open) return null

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && trapEscape) {
      e.stopPropagation()
      e.nativeEvent.stopImmediatePropagation()
      close.current()
    }
  }

  return createPortal(
    <div
      ref={box}
      id={id}
      role={role}
      aria-label={rest['aria-label']}
      data-popover=""
      style={style}
      onKeyDown={onKeyDown}
      // evita que clicar no popover tire o foco do campo (Combobox) e que o clique chegue ao fundo do painel
      onMouseDown={(e) => e.stopPropagation()}
      className={`z-[60] overflow-y-auto rounded-md border border-line bg-surface text-ink shadow-lg motion-safe:animate-pop-in ${className}`}
    >
      {children}
    </div>,
    document.body,
  )
}
