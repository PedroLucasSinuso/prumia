import type { ReactNode } from 'react'
import { NavLink, useSearchParams } from 'react-router-dom'

import { useAuth } from '../auth/context'
import { HouseSwitcher } from './HouseSwitcher'
import { Logo } from './Logo'
import { UserMenu } from './UserMenu'

// Ícones de traço quadrado (mesma família dos nós e do medidor): calendário, entrada, barras, casa, controles deslizantes.
const icons = {
  mes: 'M4 6 H20 V20 H4 Z M4 10 H20 M8 3 V7 M16 3 V7',
  receitas: 'M12 3 V15 M6 10 L12 16 L18 10 M4 20 H20',
  resumo: 'M5 20 V12 M12 20 V5 M19 20 V9',
  parcelas: 'M4 5 H20 M4 12 H20 M4 19 H20 M8 3 V7 M15 10 V14 M10 17 V21',
  casa: 'M4 11 L12 4 L20 11 M6 10 V20 H18 V10',
  ajustes: 'M4 7 H20 M4 17 H20 M9 4 V10 M15 14 V20',
} as const

// Destinos do app. Só entra aqui o que já existe: a navegação cresce junto com as telas.
const destinations = [
  { to: '/', label: 'mês', icon: icons.mes },
  { to: '/receitas', label: 'receitas', icon: icons.receitas },
  { to: '/resumo', label: 'resumo', icon: icons.resumo },
  { to: '/parcelas', label: 'parcelas', icon: icons.parcelas },
  { to: '/casa', label: 'casa', icon: icons.casa },
  { to: '/configuracoes', label: 'ajustes', icon: icons.ajustes },
]

/**
 * Moldura do app logado. Computador (md+): barra lateral teal com símbolo, destinos e conta.
 * Celular: faixa no topo com símbolo, casa e conta, e navegação inferior com os destinos.
 * Ao trocar de tela, o mês escolhido (?mes=) acompanha.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { session, logout } = useAuth()
  const [params] = useSearchParams()
  if (session.status !== 'authenticated') return null
  const { me } = session
  const mes = params.get('mes')
  const search = mes ? `?mes=${mes}` : ''

  return (
    <div className="min-h-dvh md:flex">
      {/* Barra lateral (computador) */}
      <aside className="hidden w-61 shrink-0 flex-col bg-structure px-4 py-6 text-on-structure md:sticky md:top-0 md:flex md:h-dvh">
        <div className="flex items-center gap-3 px-2 pb-8">
          <Logo size={40} tone="inverse" />
          <span className="font-display text-3xl font-semibold tracking-tight">prumia</span>
        </div>
        <nav aria-label="Principal" className="flex flex-col gap-1">
          {destinations.map((d) => (
            <NavLink
              key={d.to}
              to={{ pathname: d.to, search }}
              end
              className={({ isActive }) =>
                `flex h-11 items-center gap-3 rounded-md px-3 text-base ${isActive ? 'bg-on-structure/12 font-semibold' : 'text-on-structure/85 hover:bg-on-structure/8'}`
              }
            >
              {({ isActive }) => (
                <>
                  <span className="font-mono text-xs" aria-hidden="true">
                    {isActive ? '[ ▪ ]' : '[ ▫ ]'}
                  </span>
                  {d.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto border-t border-on-structure/20 px-1 pt-4">
          <HouseSwitcher tone="inverse" />
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 px-2">
          <p className="min-w-0 truncate text-sm font-semibold">{me.name}</p>
          <button onClick={() => void logout()} className="h-11 shrink-0 rounded-sm px-2 text-sm font-semibold underline underline-offset-4">
            sair
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Faixa superior (celular) */}
        <header className="flex items-center justify-between px-4 pt-3 md:hidden">
          <div className="flex min-w-0 items-center gap-2.5">
            <Logo size={30} />
            <HouseSwitcher />
          </div>
          <UserMenu />
        </header>
        {children}
      </div>

      {/* Navegação inferior (celular) */}
      <nav aria-label="Principal" className="fixed inset-x-0 bottom-0 z-20 grid h-18 grid-flow-col auto-cols-fr border-t border-ink/20 bg-surface md:hidden">
        {destinations.map((d) => (
          <NavLink
            key={d.to}
            to={{ pathname: d.to, search }}
            end
            className={({ isActive }) =>
              `relative flex flex-col items-center justify-center gap-1 text-[11px] tracking-wide ${isActive ? 'font-semibold text-structure' : 'font-medium text-ink/80'}`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span aria-hidden="true" className="absolute inset-x-[22%] -top-px h-[3px] bg-structure" />}
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" aria-hidden="true">
                  <path d={d.icon} />
                </svg>
                {d.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
