import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

import App from '../App'
import { api } from '../api/client'
import type { BoletoExtraction, Category, Income, IncomeSource, Invoice, Me, Member, MonthlySummary, Problem, Transfer, Wallet, WalletBalance } from '../api/types'
import { AuthProvider } from '../auth/AuthContext'
import { addMonths } from '../lib/dates'
import { ToastProvider } from '../components/Toast'

export type Reply = { data?: unknown; error?: Problem; response?: { ok: boolean } }
export const ok = (data?: unknown): Reply => ({ data, response: { ok: true } })
export const fail = (status: number, code: string, fields?: Record<string, string>): Reply => ({
  error: { title: code, status, code, fields },
  response: { ok: false },
})

export const me: Me = {
  id: 'u1', name: 'Pedro', email: 'pedro@exemplo.com', theme: 'marfim',
  households: [{ id: 'h1', name: 'Casa do Pedro', role: 'admin' }],
}
/** Duas casas: a do Pedro (admin) e a da Ana, em que ele entrou como membro. */
export const twoHousesMe: Me = {
  ...me,
  households: [
    { id: 'h1', name: 'Casa do Pedro', role: 'admin' },
    { id: 'h2', name: 'Casa da Ana', role: 'member' },
  ],
}
export const viewerMe: Me = { ...me, households: [{ id: 'h1', name: 'Casa do Pedro', role: 'viewer' }] }

export const wallets: Wallet[] = [
  { id: 'w1', name: 'Geral', isDefault: true, warnOnOverdraft: false, openingBalanceCents: 0, openingBalanceMonth: null, sortOrder: 0, archived: false },
  { id: 'w2', name: 'Benefício', isDefault: false, warnOnOverdraft: true, openingBalanceCents: 0, openingBalanceMonth: null, sortOrder: 1, archived: false },
]

/** Item de `summary.wallets` (zerado); passe só o que o teste usa. */
export function walletBalance(walletId: string, over: Partial<WalletBalance> = {}): WalletBalance {
  const w = wallets.find((x) => x.id === walletId)!
  return {
    walletId, name: w.name, isDefault: w.isDefault, archived: false, openingBalanceCents: 0, openingBalanceMonth: null, carryOverCents: 0,
    expectedIncomeCents: 0, receivedIncomeCents: 0, paidCents: 0, transfersInCents: 0, transfersOutCents: 0, balanceCents: 0, monthBalanceCents: 0, pendingCents: 0, projectedCents: 0, ...over,
  }
}

export const categories: Category[] = [
  { id: 'c1', name: 'Moradia', isEssential: true, sortOrder: 0, archived: false },
  { id: 'c2', name: 'Mercado', defaultWalletId: 'w2', isEssential: true, sortOrder: 1, archived: false },
]

export const members: Member[] = [
  { userId: 'u1', name: 'Pedro', email: 'pedro@exemplo.com', role: 'admin', joinedAt: '2026-01-01T00:00:00Z' },
  { userId: 'u2', name: 'Ana', email: 'ana@exemplo.com', role: 'member', joinedAt: '2026-01-02T00:00:00Z' },
]

export const emptySummary: MonthlySummary = {
  month: '2026-10-01',
  wallets: [walletBalance('w1'), walletBalance('w2')],
  totalPaidCents: 0, totalPendingCents: 0, overdueCents: 0, overdueCount: 0, byCategory: [],
}

/** Transferência sintética de um mês (Geral -> Benefício por padrão). */
export function transfer(over: Partial<Transfer> & Pick<Transfer, 'id'>): Transfer {
  return { fromWalletId: 'w1', toWalletId: 'w2', amountCents: 50000, transferDate: '2026-10-12', competenceMonth: '2026-10-01', ...over }
}

export function income(over: Partial<Income> & Pick<Income, 'id' | 'description'>): Income {
  return {
    userId: 'u1', kind: 'salary', walletId: 'w1', competenceMonth: '2026-10-01', expectedDate: '2026-10-05',
    amountMode: 'fixed', grossAmountCents: 500000, deductions: [], netAmountCents: 500000, received: false, held: false, repeats: false, ...over,
  }
}

export function source(over: Partial<IncomeSource> & Pick<IncomeSource, 'id' | 'name'>): IncomeSource {
  return {
    userId: 'u1', kind: 'salary', walletId: 'w1', amountMode: 'fixed', grossAmountCents: 500000, dayOfMonth: 5,
    dateRule: { rule: 'day_of_month', n: 5, weekendAdjust: 'none' }, startMonth: '2026-01-01', deductions: [], ...over,
  }
}

type Routes = {
  members?: Reply
  incomes?: Reply
  sources?: Reply
  summary?: Reply
  /** GET /summary/categories: fixa ou calculada pelo intervalo pedido. Padrão: os meses do intervalo, sem séries. */
  history?: Reply | ((q: { from: string; to: string }) => Reply)
  createIncome?: Reply
  updateIncome?: Reply
  removeIncome?: Reply
  receive?: Reply
  unreceive?: Reply
  createSource?: Reply
  restoreIncome?: Reply
  /** GET /income-dates (prévia da regra de data): fixa ou calculada pela consulta. Padrão: dia 5 de cada mês, 21 dias úteis. */
  incomeDates?: Reply | ((q: { month: string; rule: string; n?: number; weekendAdjust?: string; count?: number }) => Reply)
  /** GET /tax/estimate (INSS e IRRF sugeridos). */
  taxEstimate?: Reply | ((q: { grossCents: number; dependents?: number }) => Reply)
  updateSource?: Reply
  /** /auth/me: resposta fixa ou calculada a cada chamada (ex.: o Me muda depois de aceitar um convite). */
  me?: Reply | (() => Reply)
  createHousehold?: Reply
  acceptInvite?: Reply
  invoices?: Reply
  categories?: Reply
  payees?: Reply
  wallets?: Reply
  createWallet?: Reply
  /** GET /transfers (lista do mês). Padrão: vazia. */
  transfers?: Reply
  createTransfer?: Reply
  removeTransfer?: Reply
  restoreTransfer?: Reply
  updateWallet?: Reply
  /** GET /cnpj/{cnpj} (BrasilAPI). Padrão: 503, a consulta fora do ar. */
  cnpj?: Reply
  createPayee?: Reply
  updatePayee?: Reply
  createCategory?: Reply
  updateCategory?: Reply
  login?: Reply | Error
  register?: Reply
  logout?: Reply
  pay?: Reply
  unpay?: Reply
  create?: Reply
  update?: Reply
  remove?: Reply
  restore?: Reply
  purchases?: Reply
  recurrences?: Reply
  createPurchase?: Reply
  createRecurrence?: Reply
  updateRecurrence?: Reply
  invite?: Reply
  resetLink?: Reply
  passwordReset?: Reply
  setRole?: Reply
  removeMember?: Reply
  /** Leitura de boleto: resposta fixa ou calculada pelo corpo (ex.: pedir senha só se ela não veio). */
  extract?: Reply | ((body: { file: File; password?: string }) => Reply)
  /** Leitura de documento (tela Importar e formulário): fixa ou calculada pelo corpo (nome do arquivo, senha). */
  extractDocument?: Reply | ((body: { file: File; password?: string }) => Reply)
  /** Leitura de texto colado (POST /documents/parse-text): fixa ou calculada pelo corpo. */
  parseText?: Reply | ((body: { text: string }) => Reply)
  /** POST /invoices/batch: fixa ou calculada pelos itens enviados. */
  createBatch?: Reply | ((body: { items: unknown[] }) => Reply)
  invoiceDetail?: Reply
  updateMe?: Reply
  changePassword?: Reply
  endOthers?: Reply
  /** GET /purchases/{id} (detalhe da compra no painel da parcela). Padrão: 404. */
  purchase?: Reply
}

/** Converte a resposta do /boletos/extract (formato antigo) no DocumentExtraction equivalente. */
function asDocument(reply: Reply): Reply {
  const d = reply.data as BoletoExtraction | undefined
  if (!d || !('boleto' in d)) return reply
  const b = d.boleto
  const opt = <T,>(v: T | null | undefined) => v ?? undefined
  return ok({
    kind: 'boleto', method: d.method,
    items: [{
      description: opt(b.beneficiaryName), amountCents: opt(b.documentAmountCents), dueDate: opt(b.documentDueDate),
      competenceMonth: opt(b.documentCompetenceMonth), beneficiaryName: opt(b.beneficiaryName), beneficiaryCnpj: opt(b.beneficiaryCnpj),
      beneficiaryVerified: b.beneficiaryVerified, boleto: b, duplicateOfInvoiceId: opt(d.duplicateOfInvoiceId), payee: opt(d.payee),
    }],
  })
}

/** Simula a API por rota (o cliente tipado é espionado). Rotas omitidas: me=401, listas vazias, ações ok. */
export function mockApi(r: Routes = {}) {
  const unauth = fail(401, 'unauthenticated')
  vi.spyOn(api, 'GET').mockImplementation((async (url: string, init?: { params?: { query?: Record<string, unknown> } }) => {
    if (url === '/auth/me') return (typeof r.me === 'function' ? r.me() : r.me) ?? unauth
    if (url === '/households/{householdId}/categories') {
      // como a API: sem includeArchived=true, as arquivadas ficam de fora
      const reply = r.categories ?? ok(categories)
      if (init?.params?.query?.includeArchived || !Array.isArray(reply.data)) return reply
      return { ...reply, data: (reply.data as Category[]).filter((c) => !c.archived) }
    }
    if (url === '/cnpj/{cnpj}') return r.cnpj ?? fail(503, 'lookup_unavailable')
    if (url === '/households/{householdId}/payees') return r.payees ?? ok([])
    if (url === '/households/{householdId}/wallets') return r.wallets ?? ok(wallets)
    if (url === '/households/{householdId}/transfers') return r.transfers ?? ok([])
    if (url === '/households/{householdId}/invoices') return r.invoices ?? ok({ items: [] })
    if (url === '/households/{householdId}/members') return r.members ?? ok(members)
    if (url === '/households/{householdId}/incomes') return r.incomes ?? ok([])
    if (url === '/households/{householdId}/income-sources') return r.sources ?? ok([])
    if (url === '/households/{householdId}/income-dates') {
      const q = (init?.params?.query ?? {}) as { month: string; rule: string; n?: number; weekendAdjust?: string; count?: number }
      if (typeof r.incomeDates === 'function') return r.incomeDates(q)
      if (r.incomeDates) return r.incomeDates
      return ok(monthsBetween(q.month, addMonths(q.month, (q.count ?? 3) - 1)).map((m) => ({ month: m, expectedDate: m.slice(0, 8) + '05', businessDays: 21 })))
    }
    if (url === '/households/{householdId}/tax/estimate') {
      const q = (init?.params?.query ?? {}) as { grossCents: number; dependents?: number }
      if (typeof r.taxEstimate === 'function') return r.taxEstimate(q)
      return (
        r.taxEstimate ??
        ok({ inssCents: 64151, irrfCents: 38510, tableYear: 2026, sources: ['https://www.gov.br/receitafederal'], checkedOn: '2026-10-23', approximate: true })
      )
    }
    if (url === '/households/{householdId}/purchases') return r.purchases ?? ok({ items: [] })
    if (url === '/households/{householdId}/recurrences') return r.recurrences ?? ok([])
    if (url === '/households/{householdId}/summary') return r.summary ?? ok(emptySummary)
    if (url === '/households/{householdId}/summary/categories') {
      const q = (init?.params?.query ?? {}) as { from: string; to: string }
      if (typeof r.history === 'function') return r.history(q)
      return r.history ?? ok({ months: monthsBetween(q.from, q.to), series: [] })
    }
    if (url === '/households/{householdId}/invoices/{invoiceId}') return r.invoiceDetail ?? fail(404, 'not_found')
    if (url === '/households/{householdId}/purchases/{purchaseId}') return r.purchase ?? fail(404, 'not_found')
    throw new Error('GET inesperado: ' + url)
  }) as never)
  vi.spyOn(api, 'POST').mockImplementation((async (url: string, init?: { body?: unknown }) => {
    if (url === '/households/{householdId}/boletos/extract') {
      const body = init?.body as { file: File; password?: string }
      return (typeof r.extract === 'function' ? r.extract(body) : r.extract) ?? fail(422, 'boleto_not_found')
    }
    if (url === '/households/{householdId}/documents/parse-text') {
      const body = init?.body as { text: string }
      return (typeof r.parseText === 'function' ? r.parseText(body) : r.parseText) ?? fail(422, 'boleto_not_found')
    }
    if (url === '/households/{householdId}/documents/extract') {
      const body = init?.body as { file: File; password?: string }
      if (r.extractDocument) return typeof r.extractDocument === 'function' ? r.extractDocument(body) : r.extractDocument
      // `extract` no formato antigo (BoletoExtraction) também serve: vira um documento do tipo boleto.
      const legacy = typeof r.extract === 'function' ? r.extract(body) : r.extract
      return legacy ? asDocument(legacy) : fail(422, 'boleto_not_found')
    }
    if (url === '/households/{householdId}/invoices/batch') {
      const body = init?.body as { items: unknown[] }
      if (typeof r.createBatch === 'function') return r.createBatch(body)
      return r.createBatch ?? ok({ items: body.items.map((_, i) => ({ id: `b${i}` })) })
    }
    const pick: Record<string, Reply | Error | undefined> = {
      '/auth/login': r.login, '/auth/register': r.register, '/auth/logout': r.logout,
      '/households/{householdId}/invoices': r.create,
      '/households/{householdId}/invoices/{invoiceId}/pay': r.pay,
      '/households/{householdId}/invoices/{invoiceId}/restore': r.restore,
      '/households/{householdId}/incomes': r.createIncome,
      '/households/{householdId}/incomes/{incomeId}/receive': r.receive,
      '/households/{householdId}/incomes/{incomeId}/restore': r.restoreIncome,
      '/households/{householdId}/income-sources': r.createSource,
      '/households/{householdId}/purchases': r.createPurchase,
      '/households/{householdId}/recurrences': r.createRecurrence,
      '/households/{householdId}/invites': r.invite,
      '/households/{householdId}/categories': r.createCategory,
      '/households/{householdId}/payees': r.createPayee,
      '/households/{householdId}/wallets': r.createWallet,
      '/households/{householdId}/transfers': r.createTransfer,
      '/households/{householdId}/transfers/{transferId}/restore': r.restoreTransfer,
      '/households/{householdId}/members/{userId}/password-reset-link': r.resetLink,
      '/auth/password-reset': r.passwordReset,
      '/auth/password': r.changePassword,
      '/households': r.createHousehold,
      '/invites/accept': r.acceptInvite,
    }
    const reply = pick[url]
    if (reply instanceof Error) throw reply
    // o pagamento devolve { invoice, warnings }, como a API de verdade
    if (!reply && url.endsWith('/pay')) return ok({ invoice: {}, warnings: [] })
    if (!reply && url === '/households/{householdId}/transfers') return ok({ transfer: transfer({ id: 't-new' }), warnings: [] })
    return reply ?? ok()
  }) as never)
  vi.spyOn(api, 'PATCH').mockImplementation((async (url: string) => {
    if (url === '/auth/me') return r.updateMe ?? ok()
    if (url === '/households/{householdId}/recurrences/{recurrenceId}') return r.updateRecurrence ?? ok()
    if (url === '/households/{householdId}/members/{userId}') return r.setRole ?? ok()
    if (url === '/households/{householdId}/categories/{categoryId}') return r.updateCategory ?? ok({})
    if (url === '/households/{householdId}/payees/{payeeId}') return r.updatePayee ?? ok({})
    if (url === '/households/{householdId}/wallets/{walletId}') return r.updateWallet ?? ok({})
    if (url === '/households/{householdId}/incomes/{incomeId}') return r.updateIncome ?? ok()
    if (url === '/households/{householdId}/income-sources/{sourceId}') return r.updateSource ?? ok()
    return r.update ?? ok()
  }) as never)
  vi.spyOn(api, 'DELETE').mockImplementation((async (url: string) => {
    if (url === '/auth/sessions/others') return r.endOthers ?? ok({ ended: 1 })
    if (url === '/households/{householdId}/members/{userId}') return r.removeMember ?? { response: { ok: true } }
    if (url.endsWith('/pay')) return r.unpay ?? ok()
    if (url.endsWith('/receive')) return r.unreceive ?? ok()
    if (url === '/households/{householdId}/transfers/{transferId}') return r.removeTransfer ?? { response: { ok: true } }
    if (url === '/households/{householdId}/incomes/{incomeId}') return r.removeIncome ?? { response: { ok: true } }
    return r.remove ?? { response: { ok: true } }
  }) as never)
}

/** Meses "AAAA-MM-01" de `from` a `to`, inclusive (como o servidor devolve em `months`). */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let m = from; m <= to && out.length < 24; m = addMonths(m, 1)) out.push(m)
  return out
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
