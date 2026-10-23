import { Check, ChevronsUpDown, LogOut, Palette, UserRound } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '../auth/context'
import { useActiveHouse } from '../auth/useActiveHouse'
import { ICON } from '../lib/navigation'
import { roleLabel } from '../lib/roles'

type Props = {
  /** `inverse` = sobre a barra lateral (`structure`). */
  tone?: 'light' | 'inverse'
  /** Onde o menu abre: abaixo do avatar (topo do celular) ou acima (rodapé da barra lateral). */
  placement?: 'below' | 'above'
}

const item = 'flex min-h-11 w-full items-center gap-3 rounded-sm px-2.5 text-left text-sm text-ink hover:bg-ink/6 focus-visible:bg-ink/6 md:min-h-9'

/**
 * Menu da conta (avatar com a inicial): nome e e-mail, troca de casa (com duas ou mais), Minha conta, Aparência e Sair.
 * Padrão "menu button" de acessibilidade: abre com clique, Enter ou seta; setas percorrem os itens; Esc fecha e devolve
 * o foco ao avatar; clicar fora fecha.
 */
export function UserMenu({ tone = 'light', placement = 'below' }: Props) {
  const { session, logout } = useAuth()
  const { house, houses, selectHouse } = useActiveHouse()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    // foco no primeiro item ao abrir (teclado continua de onde a pessoa está)
    menu.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus()
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (session.status !== 'authenticated') return null
  const { name, email } = session.me
  const inverse = tone === 'inverse'

  function close() {
    setOpen(false)
    trigger.current?.focus()
  }

  function go(path: string) {
    setOpen(false)
    navigate(path)
  }

  function onMenuKey(e: KeyboardEvent) {
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])
    const at = items.indexOf(document.activeElement as HTMLElement)
    const focus = (i: number) => items[(i + items.length) % items.length]?.focus()
    if (e.key === 'Escape') { e.preventDefault(); close() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); focus(at + 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focus(at - 1) }
    else if (e.key === 'Home') { e.preventDefault(); focus(0) }
    else if (e.key === 'End') { e.preventDefault(); focus(items.length - 1) }
    else if (e.key === 'Tab') setOpen(false)
  }

  const avatar = (
    <span
      aria-hidden="true"
      className={`flex size-9 shrink-0 items-center justify-center rounded-md border text-sm font-semibold ${
        inverse ? 'border-on-structure/40 text-on-structure' : 'border-ink/25 text-structure'
      }`}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  )

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-label={`Conta de ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true) }
        }}
        className={
          inverse
            ? 'flex h-11 w-full min-w-0 items-center gap-2.5 rounded-md px-1.5 text-left hover:bg-on-structure/8'
            : 'flex size-11 items-center justify-center rounded-md hover:bg-ink/5'
        }
      >
        {avatar}
        {inverse && (
          <>
            <span className="hidden min-w-0 flex-1 truncate text-sm font-semibold lg:block">{name}</span>
            <ChevronsUpDown aria-hidden="true" size={16} strokeWidth={ICON.strokeWidth} className="hidden shrink-0 text-on-structure/70 lg:block" />
          </>
        )}
      </button>

      {open && (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={`Conta de ${name}`}
          onKeyDown={onMenuKey}
          className={`absolute z-40 w-64 rounded-md border border-line bg-surface p-1.5 text-ink shadow-lg ${
            placement === 'above' ? 'bottom-full left-0 mb-2' : 'right-0 top-full mt-1'
          }`}
        >
          <div className="px-2.5 pb-2 pt-1.5">
            <p className="truncate text-sm font-semibold">{name}</p>
            <p className="truncate text-xs text-ink/70">{email}</p>
          </div>

          {houses.length > 1 && (
            <div role="group" aria-label="Casa" className="border-t border-line py-1">
              <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wider text-ink/65">casa</p>
              {houses.map((h) => {
                const active = h.id === house?.id
                return (
                  <button
                    key={h.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    tabIndex={-1}
                    onClick={() => {
                      if (!active) selectHouse(h.id)
                      setOpen(false)
                    }}
                    className={item}
                  >
                    <span className="flex size-5 shrink-0 items-center justify-center text-accent">
                      {active && <Check aria-hidden="true" size={16} strokeWidth={2} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{h.name}</span>
                    <span className="shrink-0 text-xs text-ink/65">{roleLabel[h.role]}</span>
                  </button>
                )
              })}
            </div>
          )}

          <div className="border-t border-line py-1">
            <button type="button" role="menuitem" tabIndex={-1} onClick={() => go('/ajustes/conta')} className={item}>
              <UserRound aria-hidden="true" size={18} strokeWidth={ICON.strokeWidth} /> Minha conta
            </button>
            <button type="button" role="menuitem" tabIndex={-1} onClick={() => go('/ajustes/aparencia')} className={item}>
              <Palette aria-hidden="true" size={18} strokeWidth={ICON.strokeWidth} /> Aparência
            </button>
          </div>
          <div className="border-t border-line pt-1">
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                setOpen(false)
                void logout()
              }}
              className={item}
            >
              <LogOut aria-hidden="true" size={18} strokeWidth={ICON.strokeWidth} /> Sair
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
