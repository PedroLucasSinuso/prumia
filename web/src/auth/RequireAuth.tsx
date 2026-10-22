import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from './context'

/** Protege rotas: sem sessão, manda para /entrar (lembrando para onde a pessoa queria ir). */
export function RequireAuth() {
  const { session } = useAuth()
  const location = useLocation()
  if (session.status === 'loading') return <p role="status" className="p-6 text-sm text-graphite/70">carregando…</p>
  if (session.status === 'anonymous') return <Navigate to="/entrar" replace state={{ from: location.pathname }} />
  return <Outlet />
}

/**
 * Telas de entrada/cadastro: quem já está logado vai direto para o app, ou para onde queria ir
 * (ex.: o convite que mandou entrar antes de aceitar; o `from` vem do estado da navegação, não da URL).
 */
export function RedirectIfAuthenticated() {
  const { session } = useAuth()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  if (session.status === 'loading') return <p role="status" className="p-6 text-sm text-graphite/70">carregando…</p>
  if (session.status === 'authenticated') return <Navigate to={from?.startsWith('/') ? from : '/'} replace />
  return <Outlet />
}
