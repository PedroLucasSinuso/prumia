import { Route, Routes } from 'react-router-dom'

import { RedirectIfAuthenticated, RequireAuth } from './auth/RequireAuth'
import HousePage from './pages/HousePage'
import IncomesPage from './pages/IncomesPage'
import MonthPage from './pages/MonthPage'
import LoginPage from './pages/LoginPage'
import InvitePage from './pages/InvitePage'
import SeriesPage from './pages/SeriesPage'
import RegisterPage from './pages/RegisterPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import SummaryPage from './pages/SummaryPage'

export default function App() {
  return (
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
      </Route>
      <Route path="*" element={<RequireAuth />} />
    </Routes>
  )
}
