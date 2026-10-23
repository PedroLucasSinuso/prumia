import { lazy, Suspense } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'

import { RedirectIfAuthenticated, RequireAuth } from './auth/RequireAuth'
import { AppShell } from './components/AppShell'
import { PageSkeleton } from './components/PageSkeleton'
import LoginPage from './pages/LoginPage'
import MonthPage from './pages/MonthPage'

// O mês (tela inicial) e o login vêm no pacote principal; as demais telas são baixadas na primeira visita
// (code splitting: o celular não paga por telas que talvez nem abra).
const ImportPage = lazy(() => import('./pages/ImportPage'))
const IncomesPage = lazy(() => import('./pages/IncomesPage'))
const InvitePage = lazy(() => import('./pages/InvitePage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const SeriesPage = lazy(() => import('./pages/SeriesPage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage'))
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'))
const SummaryPage = lazy(() => import('./pages/SummaryPage'))

/**
 * Telas logadas carregadas sob demanda: enquanto o código da tela chega, a moldura (barra lateral/inferior) já aparece
 * e só o conteúdo mostra o esqueleto. Nada de tela em branco.
 */
function LoggedInSuspense() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <PageSkeleton />
        </AppShell>
      }
    >
      <Outlet />
    </Suspense>
  )
}

export default function App() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route element={<RedirectIfAuthenticated />}>
          <Route path="/entrar" element={<LoginPage />} />
          <Route path="/cadastro" element={<RegisterPage />} />
        </Route>
        {/* Links recebidos de outra pessoa: valem com ou sem sessão */}
        <Route path="/convite" element={<InvitePage />} />
        <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<LoggedInSuspense />}>
            <Route path="/" element={<MonthPage />} />
            <Route path="/receitas" element={<IncomesPage />} />
            <Route path="/resumo" element={<SummaryPage />} />
            <Route path="/importar" element={<ImportPage />} />
            {/* Fora da navegação principal: aberta a partir do Mês e do Resumo */}
            <Route path="/parcelas" element={<SeriesPage />} />
            <Route path="/ajustes" element={<SettingsPage />} />
            <Route path="/ajustes/:secao" element={<SettingsPage />} />
            {/* Endereços antigos continuam funcionando (favoritos, links mandados) */}
            <Route path="/casa" element={<Navigate to="/ajustes/casa" replace />} />
            <Route path="/configuracoes" element={<Navigate to="/ajustes" replace />} />
          </Route>
        </Route>
        <Route path="*" element={<RequireAuth />} />
      </Routes>
    </Suspense>
  )
}
