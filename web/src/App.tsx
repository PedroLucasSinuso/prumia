import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'

import { RedirectIfAuthenticated, RequireAuth } from './auth/RequireAuth'
import { PageSkeleton } from './components/PageSkeleton'
import LoginPage from './pages/LoginPage'
import MonthPage from './pages/MonthPage'

// O mês (tela inicial) e o login vêm no pacote principal; as demais telas são baixadas na primeira visita
// (code splitting: o celular não paga por telas que talvez nem abra).
const HousePage = lazy(() => import('./pages/HousePage'))
const IncomesPage = lazy(() => import('./pages/IncomesPage'))
const InvitePage = lazy(() => import('./pages/InvitePage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const SeriesPage = lazy(() => import('./pages/SeriesPage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage'))
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'))
const SummaryPage = lazy(() => import('./pages/SummaryPage'))

export default function App() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Routes>
        <Route element={<RedirectIfAuthenticated />}>
          <Route path="/entrar" element={<LoginPage />} />
          <Route path="/cadastro" element={<RegisterPage />} />
        </Route>
        {/* Links recebidos de outra pessoa: valem com ou sem sessão */}
        <Route path="/convite" element={<InvitePage />} />
        <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<MonthPage />} />
          <Route path="/receitas" element={<IncomesPage />} />
          <Route path="/resumo" element={<SummaryPage />} />
          <Route path="/parcelas" element={<SeriesPage />} />
          <Route path="/casa" element={<HousePage />} />
          <Route path="/configuracoes" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<RequireAuth />} />
      </Routes>
    </Suspense>
  )
}
