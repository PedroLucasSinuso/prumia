import { createContext, useContext } from 'react'

import type { Me, Problem } from '../api/types'

// Estado da sessão: 'loading' enquanto perguntamos ao servidor quem somos; depois o usuário ou null.
export type Session = { status: 'loading' } | { status: 'anonymous' } | { status: 'authenticated'; me: Me }

/** Resultado das ações: sucesso, ou o problema devolvido pela API (network = falha de rede). */
export type ActionResult = { ok: true } | { ok: false; problem?: Problem; network?: boolean }

export type AuthValue = {
  session: Session
  login: (email: string, password: string) => Promise<ActionResult>
  register: (input: { name: string; email: string; password: string; householdName?: string; inviteToken?: string }) => Promise<ActionResult>
  logout: () => Promise<void>
  /** Relê /auth/me (ex.: depois de entrar numa casa ou renomeá-la). Devolve o Me novo (ou undefined sem rede). */
  refresh: () => Promise<Me | undefined>
  /** Id da casa escolhida (pode não existir mais: use useActiveHouse, que cai na 1ª casa). */
  activeHouseId?: string
  /** Troca a casa ativa: guarda a escolha (por usuário) e limpa o cache de dados da casa anterior. */
  selectHouse: (houseId: string) => void
}

export const AuthContext = createContext<AuthValue | null>(null)

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>')
  return ctx
}
