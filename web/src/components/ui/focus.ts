import type { KeyboardEvent } from 'react'

/** Seletor dos elementos que entram no Tab (foco preso em painéis e popovers). */
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Prende o Tab dentro de `container`: no último elemento volta ao primeiro (e Shift+Tab, o contrário).
 * Chame no `onKeyDown` do contêiner. Devolve true se tratou a tecla.
 */
export function trapTab(e: KeyboardEvent, container: HTMLElement | null): boolean {
  if (e.key !== 'Tab' || !container) return false
  const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
  if (items.length === 0) return false
  const [head, tail] = [items[0], items[items.length - 1]]
  if (e.shiftKey && document.activeElement === head) {
    e.preventDefault()
    tail.focus()
    return true
  }
  if (!e.shiftKey && document.activeElement === tail) {
    e.preventDefault()
    head.focus()
    return true
  }
  return false
}
