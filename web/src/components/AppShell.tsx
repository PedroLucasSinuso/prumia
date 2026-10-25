import type { ReactNode } from 'react'
import { NavLink, useLocation, useSearchParams } from 'react-router-dom'

import { useAuth } from '../auth/context'
import { ICON, NAV_ITEMS, isActive } from '../lib/navigation'
import { HouseSwitcher } from './HouseSwitcher'
import { Logo } from './Logo'
import { UserMenu } from './UserMenu'

/**
 * Moldura do app logado. Os destinos vêm de NAV_ITEMS (lib/navigation.ts).
 *
 * - Computador (lg+): barra lateral `structure` com símbolo, destinos (ícone + rótulo) e, no rodapé, casa e conta.
 * - Tela média (md): a mesma barra, recolhida só aos ícones (o rótulo continua para leitor de tela e no title).
 * - Celular: faixa no topo (símbolo, casa, conta) e barra inferior com os destinos. O conteúdo ganha folga embaixo do
 *   tamanho da barra (e da área segura do iPhone), para nada ficar escondido atrás dela.
 *
 * Ao trocar de tela, o mês escolhido (?mes=) acompanha.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const [params] = useSearchParams()
  const { pathname } = useLocation()
  if (session.status !== 'authenticated') return null
  const mes = params.get('mes')
  const search = mes ? `?mes=${mes}` : ''
  const mobileItems = NAV_ITEMS.filter((i) => i.mobile !== false)

  return (
    <div className="min-h-dvh md:flex">
      {/* Barra lateral (computador) */}
      <aside className="hidden shrink-0 flex-col bg-structure px-2 py-4 text-on-structure md:sticky md:top-0 md:flex md:h-dvh md:w-16 lg:w-60 lg:px-3">
        <div className="flex items-center gap-2.5 px-1.5 pb-6 lg:px-2">
          <Logo size={32} tone="inverse" />
          <span className="hidden font-display text-2xl font-semibold tracking-tight lg:inline">prumia</span>
        </div>
        <nav aria-label="Principal" className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item, pathname)
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={{ pathname: item.to, search }}
                aria-current={active ? 'page' : undefined}
                title={item.label}
                className={`group flex h-10 items-center gap-3 rounded-md px-2.5 text-sm transition-colors duration-150 lg:px-3 ${
                  active ? 'bg-on-structure/12 font-semibold' : 'text-on-structure/80 hover:bg-on-structure/8 hover:text-on-structure'
                }`}
              >
                <Icon aria-hidden="true" size={ICON.size} strokeWidth={ICON.strokeWidth} className="shrink-0" />
                <span className="sr-only lg:not-sr-only lg:flex-1">{item.label}</span>
                {active && (
                  <span aria-hidden="true" className="hidden font-mono text-caption text-on-structure/70 lg:inline">
                    [ ▪ ]
                  </span>
                )}
              </NavLink>
            )
          })}
        </nav>
        <div className="mt-auto flex flex-col gap-2 border-t border-on-structure/20 pt-3">
          <div className="hidden px-1 lg:block">
            <HouseSwitcher tone="inverse" />
          </div>
          <UserMenu tone="inverse" placement="above" />
        </div>
      </aside>

      <div className="min-w-0 flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        {/* Faixa superior (celular) */}
        <header className="flex items-center justify-between gap-3 px-4 pt-3 md:hidden">
          <div className="flex min-w-0 items-center gap-2.5">
            <Logo size={30} />
            <HouseSwitcher />
          </div>
          <UserMenu />
        </header>
        {children}
      </div>

      {/* Navegação inferior (celular): ícone + rótulo, alvo de toque inteiro (≥ 44 px) */}
      <nav
        aria-label="Principal"
        style={{ gridTemplateColumns: `repeat(${mobileItems.length}, minmax(0, 1fr))` }}
        className="fixed inset-x-0 bottom-0 z-20 grid border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {mobileItems.map((item) => {
          const active = isActive(item, pathname)
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={{ pathname: item.to, search }}
              aria-current={active ? 'page' : undefined}
              className={`relative flex h-16 flex-col items-center justify-center gap-1 text-caption tracking-wide transition-colors duration-150 ${
                active ? 'font-semibold text-heading' : 'font-medium text-muted'
              }`}
            >
              {active && <span aria-hidden="true" className="absolute inset-x-[24%] -top-px h-[3px] bg-structure" />}
              <Icon aria-hidden="true" size={22} strokeWidth={active ? 2 : ICON.strokeWidth} />
              {item.label}
            </NavLink>
          )
        })}
      </nav>
    </div>
  )
}
