import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

import App from '../App'
import { api } from '../api/client'
import type { Category, Income, IncomeSource, Invoice, Me, Member, MonthlySummary, Problem } from '../api/types'
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

export const members: Member[] = [
  { userId: 'u1', name: 'Pedro', email: 'pedro@exemplo.com', role: 'admin', joinedAt: '2026-01-01T00:00:00Z' },
  { userId: 'u2', name: 'Ana', email: 'ana@exemplo.com', role: 'member', joinedAt: '2026-01-02T00:00:00Z' },
]

export const emptySummary: MonthlySummary = {
  month: '2026-10-01',
  wallets: {
    free: { expectedIncomeCents: 0, receivedIncomeCents: 0, paidCents: 0, balanceCents: 0 },
    benefit: { expectedIncomeCents: 0, receivedIncomeCents: 0, paidCents: 0, balanceCents: 0 },
  },
  totalPaidCents: 0, totalPendingCents: 0, byCategory: [],
}

export function income(over: Partial<Income> & Pick<Income, 'id' | 'description'>): Income {
  return {
    userId: 'u1', kind: 'salary', wallet: 'free', competenceMonth: '2026-10-01', expectedDate: '2026-10-05',
    grossAmountCents: 500000, deductions: [], netAmountCents: 500000, received: false, ...over,
  }
}

export function source(over: Partial<IncomeSource> & Pick<IncomeSource, 'id' | 'name'>): IncomeSource {
  return { userId: 'u1', kind: 'salary', wallet: 'free', grossAmountCents: 500000, dayOfMonth: 5, startMonth: '2026-01-01', deductions: [], ...over }
}

type Routes = {
  members?: Reply
  incomes?: Reply
  sources?: Reply
  summary?: Reply
  createIncome?: Reply
  updateIncome?: Reply
  removeIncome?: Reply
  receive?: Reply
  unreceive?: Reply
  createSource?: Reply
  updateSource?: Reply
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
  invite?: Reply
  resetLink?: Reply
  passwordReset?: Reply
  setRole?: Reply
  removeMember?: Reply
  /** Leitura de boleto: resposta fixa ou calculada pelo corpo (ex.: pedir senha só se ela não veio). */
  extract?: Reply | ((body: { file: File; password?: string }) => Reply)
  invoiceDetail?: Reply
}

/** Simula a API por rota (o cliente tipado é espionado). Rotas omitidas: me=401, listas vazias, ações ok. */
export function mockApi(r: Routes = {}) {
  const unauth = fail(401, 'unauthenticated')
  vi.spyOn(api, 'GET').mockImplementation((async (url: string) => {
    if (url === '/auth/me') return r.me ?? unauth
    if (url === '/households/{householdId}/categories') return r.categories ?? ok(categories)
    if (url === '/households/{householdId}/invoices') return r.invoices ?? ok({ items: [] })
    if (url === '/households/{householdId}/members') return r.members ?? ok(members)
    if (url === '/households/{householdId}/incomes') return r.incomes ?? ok([])
    if (url === '/households/{householdId}/income-sources') return r.sources ?? ok([])
    if (url === '/households/{householdId}/summary') return r.summary ?? ok(emptySummary)
    if (url === '/households/{householdId}/invoices/{invoiceId}') return r.invoiceDetail ?? fail(404, 'not_found')
    throw new Error('GET inesperado: ' + url)
  }) as never)
  vi.spyOn(api, 'POST').mockImplementation((async (url: string, init?: { body?: unknown }) => {
    if (url === '/households/{householdId}/boletos/extract') {
      const body = init?.body as { file: File; password?: string }
      return (typeof r.extract === 'function' ? r.extract(body) : r.extract) ?? fail(422, 'boleto_unreadable')
    }
    const pick: Record<string, Reply | Error | undefined> = {
      '/auth/login': r.login, '/auth/register': r.register, '/auth/logout': r.logout,
      '/households/{householdId}/invoices': r.create,
      '/households/{householdId}/invoices/{invoiceId}/pay': r.pay,
      '/households/{householdId}/invoices/{invoiceId}/restore': r.restore,
      '/households/{householdId}/incomes': r.createIncome,
      '/households/{householdId}/incomes/{incomeId}/receive': r.receive,
      '/households/{householdId}/income-sources': r.createSource,
      '/households/{householdId}/invites': r.invite,
      '/households/{householdId}/members/{userId}/password-reset-link': r.resetLink,
      '/auth/password-reset': r.passwordReset,
    }
    const reply = pick[url]
    if (reply instanceof Error) throw reply
    // o pagamento devolve { invoice, warnings }, como a API de verdade
    if (!reply && url.endsWith('/pay')) return ok({ invoice: {}, warnings: [] })
    return reply ?? ok()
  }) as never)
  vi.spyOn(api, 'PATCH').mockImplementation((async (url: string) => {
    if (url === '/households/{householdId}/members/{userId}') return r.setRole ?? ok()
    if (url === '/households/{householdId}/incomes/{incomeId}') return r.updateIncome ?? ok()
    if (url === '/households/{householdId}/income-sources/{sourceId}') return r.updateSource ?? ok()
    return r.update ?? ok()
  }) as never)
  vi.spyOn(api, 'DELETE').mockImplementation((async (url: string) => {
    if (url === '/households/{householdId}/members/{userId}') return r.removeMember ?? { response: { ok: true } }
    if (url.endsWith('/pay')) return r.unpay ?? ok()
    if (url.endsWith('/receive')) return r.unreceive ?? ok()
    if (url === '/households/{householdId}/incomes/{incomeId}') return r.removeIncome ?? { response: { ok: true } }
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
