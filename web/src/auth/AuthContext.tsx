import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { api } from '../api/client'
import { readActiveHouse, writeActiveHouse } from './activeHouseStorage'
import { AuthContext, type AuthValue, type Session } from './context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ status: 'loading' })
  const queryClient = useQueryClient()
  // Casa escolhida pelo usuário. Fica no localStorage por usuário (quem divide o aparelho não herda a escolha).
  const [chosen, setChosen] = useState<{ userId: string; houseId?: string }>()
  const userId = session.status === 'authenticated' ? session.me.id : undefined
  const activeHouseId = userId ? (chosen?.userId === userId ? chosen.houseId : readActiveHouse(userId)) : undefined

  const selectHouse = useCallback<AuthValue['selectHouse']>(
    (houseId) => {
      if (!userId) return
      writeActiveHouse(userId, houseId)
      setChosen({ userId, houseId })
      // Dados da casa anterior não podem aparecer na nova: descarta todo o cache do TanStack Query.
      queryClient.clear()
    },
    [userId, queryClient],
  )

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

  const refresh = useCallback<AuthValue['refresh']>(async () => {
    try {
      const { data } = await api.GET('/auth/me')
      if (data) setSession({ status: 'authenticated', me: data })
      return data
    } catch {
      // sem rede: mantém o que já está na tela
      return undefined
    }
  }, [])

  const value = useMemo(
    () => ({ session, login, register, logout, refresh, activeHouseId, selectHouse }),
    [session, login, register, logout, refresh, activeHouseId, selectHouse],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
