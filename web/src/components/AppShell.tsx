import type { ReactNode } from 'react'
import { NavLink, useSearchParams } from 'react-router-dom'

import { useAuth } from '../auth/context'
import { Logo } from './Logo'
import { UserMenu } from './UserMenu'

// Ícones de traço quadrado (mesma família dos nós e do medidor): calendário, entrada, barras.
const icons = {
  mes: 'M4 6 H20 V20 H4 Z M4 10 H20 M8 3 V7 M16 3 V7',
  receitas: 'M12 3 V15 M6 10 L12 16 L18 10 M4 20 H20',
  resumo: 'M5 20 V12 M12 20 V5 M19 20 V9',
  casa: 'M4 11 L12 4 L20 11 M6 10 V20 H18 V10',
} as const

// Destinos do app. Só entra aqui o que já existe: a navegação cresce junto com as telas.
const destinations = [
  { to: '/', label: 'mês', icon: icons.mes },
  { to: '/receitas', label: 'receitas', icon: icons.receitas },
  { to: '/resumo', label: 'resumo', icon: icons.resumo },
  { to: '/casa', label: 'casa', icon: icons.casa },
]

const roleLabel = { admin: 'admin', member: 'membro', viewer: 'leitura' } as const

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
  const house = me.households[0]
  const mes = params.get('mes')
  const search = mes ? `?mes=${mes}` : ''

  return (
    <div className="min-h-dvh md:flex">
      {/* Barra lateral (computador) */}
      <aside className="hidden w-61 shrink-0 flex-col bg-teal px-4 py-6 text-ivory md:sticky md:top-0 md:flex md:h-dvh">
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
                `flex h-11 items-center gap-3 rounded-md px-3 text-base ${isActive ? 'bg-ivory/12 font-semibold' : 'text-ivory/85 hover:bg-ivory/8'}`
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
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-ivory/20 px-2 pt-4">
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold">{me.name}</p>
            <p className="truncate text-xs text-ivory/75">{house ? `${roleLabel[house.role]} · ${house.name}` : 'sem casa'}</p>
          </div>
          <button onClick={() => void logout()} className="h-11 shrink-0 rounded-sm px-2 text-sm font-semibold underline underline-offset-4">
            sair
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Faixa superior (celular) */}
        <header className="flex items-center justify-between px-4 pt-3 md:hidden">
          <div className="flex items-center gap-2.5">
            <Logo size={30} />
            <div className="leading-tight">
              <p className="text-[11px] uppercase tracking-wider text-graphite/70">casa</p>
              <p className="text-base font-semibold">{house?.name ?? 'Sem casa'}</p>
            </div>
          </div>
          <UserMenu />
        </header>
        {children}
      </div>

      {/* Navegação inferior (celular) */}
      <nav aria-label="Principal" className="fixed inset-x-0 bottom-0 z-20 grid h-18 grid-flow-col auto-cols-fr border-t border-graphite/20 bg-ivory md:hidden">
        {destinations.map((d) => (
          <NavLink
            key={d.to}
            to={{ pathname: d.to, search }}
            end
            className={({ isActive }) =>
              `relative flex flex-col items-center justify-center gap-1 text-[11px] tracking-wide ${isActive ? 'font-semibold text-teal' : 'font-medium text-graphite/80'}`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span aria-hidden="true" className="absolute inset-x-[22%] -top-px h-[3px] bg-teal" />}
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
