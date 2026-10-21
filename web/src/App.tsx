import { Route, Routes } from 'react-router-dom'

import { RedirectIfAuthenticated, RequireAuth } from './auth/RequireAuth'
import MonthPage from './pages/MonthPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'

export default function App() {
  return (
    <Routes>
      <Route element={<RedirectIfAuthenticated />}>
        <Route path="/entrar" element={<LoginPage />} />
        <Route path="/cadastro" element={<RegisterPage />} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route path="/" element={<MonthPage />} />
      </Route>
      <Route path="*" element={<RequireAuth />} />
    </Routes>
  )
}
