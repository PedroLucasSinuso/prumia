import { Ellipsis, type LucideIcon } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

import { ICON } from '../lib/navigation'

export type Action = { label: string; icon?: LucideIcon; onSelect: () => void; hidden?: boolean }

type Props = {
  /** Nome acessível do botão, ex.: "Ações de Moradia". */
  label: string
  actions: Action[]
  /** Com mouse (computador), o botão só aparece ao passar o mouse na linha (`group`) ou com foco. */
  revealOnHover?: boolean
}

/**
 * Botão "⋯" que abre um menu de ações de uma linha (editar, mover, arquivar…): uma ação por linha visível em vez de
 * vários botões repetidos em todas as linhas. Teclado: setas percorrem, Esc fecha e devolve o foco.
 */
export function ActionMenu({ label, actions, revealOnHover = true }: Props) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const id = useId()
  const visible = actions.filter((a) => !a.hidden)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function onKey(e: KeyboardEvent) {
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    const at = items.indexOf(document.activeElement as HTMLElement)
    const focus = (i: number) => items[(i + items.length) % items.length]?.focus()
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation() // não fecha também o painel aberto ao lado
      setOpen(false)
      trigger.current?.focus()
    } else if (e.key === 'ArrowDown') { e.preventDefault(); focus(at + 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focus(at - 1) }
    else if (e.key === 'Tab') setOpen(false)
  }

  if (visible.length === 0) return null

  return (
    <div ref={root} className="relative shrink-0">
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        className={`flex size-11 items-center justify-center rounded-md text-ink/75 transition-opacity duration-150 hover:bg-ink/6 hover:text-ink md:size-9 ${
          revealOnHover ? 'pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-visible:opacity-100 aria-expanded:opacity-100' : ''
        }`}
      >
        <Ellipsis aria-hidden="true" size={ICON.size} strokeWidth={ICON.strokeWidth} />
      </button>
      {open && (
        <div
          ref={menu}
          id={id}
          role="menu"
          aria-label={label}
          onKeyDown={onKey}
          className="absolute right-0 top-full z-30 mt-1 w-52 rounded-md border border-line bg-surface p-1 text-ink shadow-lg"
        >
          {visible.map((a) => {
            const Icon = a.icon
            return (
              <button
                key={a.label}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  setOpen(false)
                  a.onSelect()
                }}
                className="flex min-h-11 w-full items-center gap-2.5 rounded-sm px-2.5 text-left text-sm hover:bg-ink/6 focus-visible:bg-ink/6 md:min-h-9"
              >
                {Icon && <Icon aria-hidden="true" size={16} strokeWidth={ICON.strokeWidth} className="shrink-0 text-ink/70" />}
                {a.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
