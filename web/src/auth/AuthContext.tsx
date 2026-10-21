import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { api } from '../api/client'
import { AuthContext, type AuthValue, type Session } from './context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ status: 'loading' })

  // Ao abrir o app: o cookie de sessão (httpOnly, invisível ao JS) vai sozinho; 200 = logado, 401 = não.
  useEffect(() => {
    let cancelled = false
    api
      .GET('/auth/me')
      .then(({ data }) => {
        if (!cancelled) setSession(data ? { status: 'authenticated', me: data } : { status: 'anonymous' })
      })
      .catch(() => !cancelled && setSession({ status: 'anonymous' }))
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback<AuthValue['login']>(async (email, password) => {
    try {
      const { data, error } = await api.POST('/auth/login', { body: { email, password } })
      if (data) {
        setSession({ status: 'authenticated', me: data })
        return { ok: true }
      }
      return { ok: false, problem: error }
    } catch {
      return { ok: false, network: true }
    }
  }, [])

  const register = useCallback<AuthValue['register']>(async (input) => {
    try {
      const { data, error } = await api.POST('/auth/register', { body: input })
      if (data) {
        setSession({ status: 'authenticated', me: data })
        return { ok: true }
      }
      return { ok: false, problem: error }
    } catch {
      return { ok: false, network: true }
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.POST('/auth/logout')
    } finally {
      // Mesmo se a rede falhar, o usuário sai da tela; o servidor encerra a sessão quando conseguir.
      setSession({ status: 'anonymous' })
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.GET('/auth/me')
      if (data) setSession({ status: 'authenticated', me: data })
    } catch {
      // sem rede: mantém o que já está na tela
    }
  }, [])

  const value = useMemo(() => ({ session, login, register, logout, refresh }), [session, login, register, logout, refresh])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
