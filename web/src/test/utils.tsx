import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

import App from '../App'
import { api } from '../api/client'
import type { Category, Invoice, Me, Problem } from '../api/types'
import { AuthProvider } from '../auth/AuthContext'
import { ToastProvider } from '../components/Toast'

export type Reply = { data?: unknown; error?: Problem; response?: { ok: boolean } }
export const ok = (data?: unknown): Reply => ({ data, response: { ok: true } })
export const fail = (status: number, code: string, fields?: Record<string, string>): Reply => ({
  error: { title: code, status, code, fields },
  response: { ok: false },
})

export const me: Me = {
  id: 'u1', name: 'Pedro', email: 'pedro@exemplo.com',
  households: [{ id: 'h1', name: 'Casa do Pedro', role: 'admin' }],
}
export const viewerMe: Me = { ...me, households: [{ id: 'h1', name: 'Casa do Pedro', role: 'viewer' }] }

export const categories: Category[] = [
  { id: 'c1', name: 'Moradia', isEssential: true, sortOrder: 0, archived: false },
  { id: 'c2', name: 'Mercado', defaultWallet: 'benefit', isEssential: true, sortOrder: 1, archived: false },
]

type Routes = {
  me?: Reply
  invoices?: Reply
  categories?: Reply
  login?: Reply | Error
  register?: Reply
  logout?: Reply
  pay?: Reply
  unpay?: Reply
  create?: Reply
  update?: Reply
  remove?: Reply
  restore?: Reply
}

/** Simula a API por rota (o cliente tipado é espionado). Rotas omitidas: me=401, listas vazias, ações ok. */
export function mockApi(r: Routes = {}) {
  const unauth = fail(401, 'unauthenticated')
  vi.spyOn(api, 'GET').mockImplementation((async (url: string) => {
    if (url === '/auth/me') return r.me ?? unauth
    if (url === '/households/{householdId}/categories') return r.categories ?? ok(categories)
    if (url === '/households/{householdId}/invoices') return r.invoices ?? ok({ items: [] })
    throw new Error('GET inesperado: ' + url)
  }) as never)
  vi.spyOn(api, 'POST').mockImplementation((async (url: string) => {
    const pick: Record<string, Reply | Error | undefined> = {
      '/auth/login': r.login, '/auth/register': r.register, '/auth/logout': r.logout,
      '/households/{householdId}/invoices': r.create,
      '/households/{householdId}/invoices/{invoiceId}/pay': r.pay,
      '/households/{householdId}/invoices/{invoiceId}/restore': r.restore,
    }
    const reply = pick[url]
    if (reply instanceof Error) throw reply
    return reply ?? ok()
  }) as never)
  vi.spyOn(api, 'PATCH').mockImplementation((async () => r.update ?? ok()) as never)
  vi.spyOn(api, 'DELETE').mockImplementation((async (url: string) => {
    if (url.endsWith('/pay')) return r.unpay ?? ok()
    return r.remove ?? { response: { ok: true } }
  }) as never)
}

export function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

export function invoice(over: Partial<Invoice> & Pick<Invoice, 'id' | 'description'>): Invoice {
  return {
    categoryId: 'c1', amountCents: 10000, dueDate: '2026-10-20', competenceMonth: '2026-10-01', status: 'pending',
    ...over,
  }
}
