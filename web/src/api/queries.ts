import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from './client'
import { ApiError, unwrap } from './errors'
import type { BoletoExtraction, Category, CategoryInput, CategoryPatch, Income, IncomeInput, IncomePatch, IncomeSource, IncomeSourceInput, IncomeSourcePatch, Invoice, InvoiceInput, InvoicePatch, Purchase, PurchaseInput, Problem, Recurrence, RecurrenceInput, RecurrencePatch, SeriesScope, InviteCreated, Member, MonthlySummary, Role, Wallet } from './types'

// Chaves de cache. Toda mutação invalida ['invoices', casa] e a lista do mês é refeita sozinha.
const keys = {
  categories: (house: string) => ['categories', house] as const,
  invoices: (house: string, month: string) => ['invoices', house, month] as const,
  allInvoices: (house: string) => ['invoices', house] as const,
  incomes: (house: string, month: string) => ['incomes', house, month] as const,
  allIncomes: (house: string) => ['incomes', house] as const,
  sources: (house: string) => ['income-sources', house] as const,
  summary: (house: string) => ['summary', house] as const,
  members: (house: string) => ['members', house] as const,
  purchases: (house: string) => ['purchases', house] as const,
  recurrences: (house: string) => ['recurrences', house] as const,
}

/**
 * Todas as categorias da casa, **inclusive as arquivadas**: contas antigas de uma categoria arquivada continuam mostrando o nome
 * (mês e resumo procuram o nome aqui). Quem oferece categorias para escolher filtra `archived` (ver MonthPage).
 */
export function useCategories(houseId: string) {
  return useQuery({
    queryKey: keys.categories(houseId),
    queryFn: (): Promise<Category[]> =>
      unwrap(api.GET('/households/{householdId}/categories', { params: { path: { householdId: houseId }, query: { includeArchived: true } } })),
  })
}

/**
 * Criar, editar (inclui arquivar/restaurar via `archived`) e reordenar categorias.
 * Reordenar não tem endpoint em lote: grava `sortOrder` = posição só nas que mudaram (alguns PATCH, poucas linhas).
 */
export function useCategoryActions(houseId: string) {
  const qc = useQueryClient()
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: keys.categories(houseId) }), qc.invalidateQueries({ queryKey: keys.summary(houseId) })])
  const patch = (id: string, body: CategoryPatch) =>
    unwrap(api.PATCH('/households/{householdId}/categories/{categoryId}', { params: { path: { householdId: houseId, categoryId: id } }, body }))

  const create = useMutation({
    mutationFn: (body: CategoryInput) => unwrap(api.POST('/households/{householdId}/categories', { params: { path: { householdId: houseId } }, body })),
    onSettled: refresh,
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: CategoryPatch }) => patch(id, body),
    onSettled: refresh,
  })
  const reorder = useMutation({
    mutationFn: async (ordered: Category[]) => {
      for (const [i, c] of ordered.entries()) if (c.sortOrder !== i) await patch(c.id, { sortOrder: i })
    },
    onSettled: refresh,
  })
  return { create, update, reorder }
}

/** Todas as invoices de um mês de competência (segue o cursor se passar de uma página). */
export function useInvoices(houseId: string, month: string) {
  return useQuery({
    queryKey: keys.invoices(houseId, month),
    queryFn: async (): Promise<Invoice[]> => {
      const items: Invoice[] = []
      let cursor: string | undefined
      for (let page = 0; page < 10; page++) {
        const data = await unwrap(
          api.GET('/households/{householdId}/invoices', {
            params: { path: { householdId: houseId }, query: { month, limit: 200, cursor } },
          }),
        )
        items.push(...data.items)
        if (!data.nextCursor) break
        cursor = data.nextCursor
      }
      return items
    },
  })
}

/** Ações sobre invoices. Cada uma atualiza a lista do mês ao terminar (sucesso ou erro). */
export function useInvoiceActions(houseId: string) {
  const qc = useQueryClient()
  // Série mexe em várias invoices de uma vez: atualiza também as listas de compras e de contas fixas.
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.allInvoices(houseId) }),
      qc.invalidateQueries({ queryKey: keys.summary(houseId) }),
      qc.invalidateQueries({ queryKey: keys.purchases(houseId) }),
      qc.invalidateQueries({ queryKey: keys.recurrences(houseId) }),
    ])
  const path = (invoiceId: string) => ({ params: { path: { householdId: houseId, invoiceId } } })

  const create = useMutation({
    mutationFn: (body: InvoiceInput) =>
      unwrap(api.POST('/households/{householdId}/invoices', { params: { path: { householdId: houseId } }, body })),
    onSettled: refresh,
  })
  const update = useMutation({
    mutationFn: ({ id, body, scope = 'this' }: { id: string; body: InvoicePatch; scope?: SeriesScope }) =>
      unwrap(api.PATCH('/households/{householdId}/invoices/{invoiceId}', { params: { ...path(id).params, query: { scope } }, body })),
    onSettled: refresh,
  })
  const remove = useMutation({
    mutationFn: ({ id, scope = 'this' }: { id: string; scope?: SeriesScope }) =>
      unwrap(api.DELETE('/households/{householdId}/invoices/{invoiceId}', { params: { ...path(id).params, query: { scope } } })),
    onSettled: refresh,
  })
  const restore = useMutation({
    // scope=following desfaz o lote "esta e as seguintes" (só o que foi excluído junto com esta).
    mutationFn: ({ id, scope = 'this' }: { id: string; scope?: SeriesScope }) =>
      unwrap(api.POST('/households/{householdId}/invoices/{invoiceId}/restore', { params: { ...path(id).params, query: { scope } } })),
    onSettled: refresh,
  })
  const pay = useMutation({
    mutationFn: ({ id, wallet }: { id: string; wallet: Wallet }) =>
      unwrap(api.POST('/households/{householdId}/invoices/{invoiceId}/pay', { ...path(id), body: { wallet } })),
    onSettled: refresh,
  })
  const unpay = useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/households/{householdId}/invoices/{invoiceId}/pay', path(id))),
    onSettled: refresh,
  })

  const createPurchase = useMutation({
    mutationFn: (body: PurchaseInput) =>
      unwrap(api.POST('/households/{householdId}/purchases', { params: { path: { householdId: houseId } }, body })),
    onSettled: refresh,
  })
  const createRecurrence = useMutation({
    mutationFn: (body: RecurrenceInput) =>
      unwrap(api.POST('/households/{householdId}/recurrences', { params: { path: { householdId: houseId } }, body })),
    onSettled: refresh,
  })

  return { create, update, remove, restore, pay, unpay, createPurchase, createRecurrence }
}

/** Detalhe de uma invoice (inclui o boleto). Usado para abrir uma conta que pode estar em outro mês. */
export function getInvoice(houseId: string, invoiceId: string): Promise<Invoice> {
  return unwrap(api.GET('/households/{householdId}/invoices/{invoiceId}', { params: { path: { householdId: houseId, invoiceId } } }))
}

// Status HTTP -> código estável, para quando a resposta não traz `code` (ex.: 413 devolvido pelo nginx, em HTML).
const extractStatusCode: Record<number, string> = { 413: 'file_too_large', 422: 'boleto_not_found', 429: 'too_many_requests', 503: 'busy' }

/**
 * Lê um boleto (PDF/PNG/JPG). Nada é salvo no servidor; a pessoa revisa antes de criar a conta.
 * Envia multipart/form-data: o `bodySerializer` monta o FormData e o openapi-fetch deixa o navegador pôr o boundary.
 * Falha vira ApiError com `problem.code` sempre preenchido (`password_required`, `file_too_large`...).
 *
 * A senha do PDF só passa pela requisição: `gcTime: 0` tira a mutação (e suas variáveis) do cache assim que ninguém a observa,
 * e quem chama dá `reset()` ao terminar.
 */
export function useExtractBoleto(houseId: string) {
  return useMutation({
    gcTime: 0,
    mutationFn: async ({ file, password }: { file: File; password?: string }): Promise<BoletoExtraction> => {
      let result
      try {
        result = await api.POST('/households/{householdId}/boletos/extract', {
          params: { path: { householdId: houseId } },
          // O tipo gerado diz `string` para campos binários; em runtime é o File.
          body: { file: file as unknown as string, ...(password ? { password } : {}) },
          bodySerializer: (body) => {
            const form = new FormData()
            form.append('file', body.file as unknown as Blob)
            if (body.password) form.append('password', body.password)
            return form
          },
        })
      } catch {
        throw new ApiError(undefined, true)
      }
      if (result.data) return result.data
      const problem = typeof result.error === 'object' && result.error !== null ? (result.error as Problem) : undefined
      const status = problem?.status ?? result.response?.status ?? 0
      const code = problem?.code ?? extractStatusCode[status] ?? 'boleto_not_found'
      throw new ApiError({ title: code, ...problem, status, code })
    },
  })
}

export function useMembers(houseId: string) {
  return useQuery({
    queryKey: keys.members(houseId),
    queryFn: (): Promise<Member[]> => unwrap(api.GET('/households/{householdId}/members', { params: { path: { householdId: houseId } } })),
  })
}

/** Resumo do mês: saldo por carteira, pago x pendente e total por categoria. */
export function useSummary(houseId: string, month: string) {
  return useQuery({
    queryKey: [...keys.summary(houseId), month] as const,
    queryFn: (): Promise<MonthlySummary> =>
      unwrap(api.GET('/households/{householdId}/summary', { params: { path: { householdId: houseId }, query: { month } } })),
  })
}

/** Receitas do mês (previstas e recebidas). O servidor gera a previsão das fontes sob demanda. */
export function useIncomes(houseId: string, month: string) {
  return useQuery({
    queryKey: keys.incomes(houseId, month),
    queryFn: (): Promise<Income[]> =>
      unwrap(api.GET('/households/{householdId}/incomes', { params: { path: { householdId: houseId }, query: { month } } })),
  })
}

export function useIncomeActions(houseId: string) {
  const qc = useQueryClient()
  // Receita muda o saldo do resumo: invalida as duas listas.
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: keys.allIncomes(houseId) }), qc.invalidateQueries({ queryKey: keys.summary(houseId) })])
  const path = (incomeId: string) => ({ params: { path: { householdId: houseId, incomeId } } })

  const create = useMutation({
    mutationFn: (body: IncomeInput) => unwrap(api.POST('/households/{householdId}/incomes', { params: { path: { householdId: houseId } }, body })),
    onSettled: refresh,
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: IncomePatch }) => unwrap(api.PATCH('/households/{householdId}/incomes/{incomeId}', { ...path(id), body })),
    onSettled: refresh,
  })
  const remove = useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/households/{householdId}/incomes/{incomeId}', path(id))),
    onSettled: refresh,
  })
  const receive = useMutation({
    mutationFn: (id: string) => unwrap(api.POST('/households/{householdId}/incomes/{incomeId}/receive', { ...path(id), body: {} })),
    onSettled: refresh,
  })
  const unreceive = useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/households/{householdId}/incomes/{incomeId}/receive', path(id))),
    onSettled: refresh,
  })
  return { create, update, remove, receive, unreceive }
}

/** Fontes de receita: o "molde" mensal (salário, VR) que gera a previsão dos meses seguintes. */
export function useIncomeSources(houseId: string) {
  return useQuery({
    queryKey: keys.sources(houseId),
    queryFn: (): Promise<IncomeSource[]> => unwrap(api.GET('/households/{householdId}/income-sources', { params: { path: { householdId: houseId } } })),
  })
}

export function useSourceActions(houseId: string) {
  const qc = useQueryClient()
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.sources(houseId) }),
      qc.invalidateQueries({ queryKey: keys.allIncomes(houseId) }),
      qc.invalidateQueries({ queryKey: keys.summary(houseId) }),
    ])
  const create = useMutation({
    mutationFn: (body: IncomeSourceInput) => unwrap(api.POST('/households/{householdId}/income-sources', { params: { path: { householdId: houseId } }, body })),
    onSettled: refresh,
  })
  const update = useMutation({
    mutationFn: ({ id, body, applyFrom }: { id: string; body: IncomeSourcePatch; applyFrom?: string }) =>
      unwrap(
        api.PATCH('/households/{householdId}/income-sources/{sourceId}', {
          params: { path: { householdId: houseId, sourceId: id }, query: applyFrom ? { applyFrom } : {} },
          body,
        }),
      ),
    onSettled: refresh,
  })
  return { create, update }
}

/** Ações da casa: renomear, excluir, papéis, remover/sair, convites e link de redefinição de senha (as de admin o servidor confere). */
export function useHouseActions(houseId: string) {
  const qc = useQueryClient()
  const refreshMembers = () => qc.invalidateQueries({ queryKey: keys.members(houseId) })
  const member = (userId: string) => ({ params: { path: { householdId: houseId, userId } } })

  const rename = useMutation({
    mutationFn: (name: string) => unwrap(api.PATCH('/households/{householdId}', { params: { path: { householdId: houseId } }, body: { name } })),
  })
  const remove = useMutation({
    mutationFn: () => unwrap(api.DELETE('/households/{householdId}', { params: { path: { householdId: houseId } } })),
  })
  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      unwrap(api.PATCH('/households/{householdId}/members/{userId}', { ...member(userId), body: { role } })),
    onSettled: refreshMembers,
  })
  const removeMember = useMutation({
    mutationFn: (userId: string) => unwrap(api.DELETE('/households/{householdId}/members/{userId}', member(userId))),
    onSettled: refreshMembers,
  })
  const invite = useMutation({
    mutationFn: ({ role, expiresInHours }: { role: Role; expiresInHours: number }): Promise<InviteCreated> =>
      unwrap(api.POST('/households/{householdId}/invites', { params: { path: { householdId: houseId } }, body: { role, expiresInHours } })),
  })
  const resetLink = useMutation({
    mutationFn: (userId: string) => unwrap(api.POST('/households/{householdId}/members/{userId}/password-reset-link', member(userId))),
  })
  return { rename, remove, setRole, removeMember, invite, resetLink }
}

/** Cria uma casa nova (quem cria vira admin). Passou do limite de casas: ApiError com code=household_limit. */
export function useCreateHousehold() {
  return useMutation({ mutationFn: (name: string) => unwrap(api.POST('/households', { body: { name } })) })
}

/** Aceita um convite com a conta já logada: a pessoa entra na casa do convite. */
export function useAcceptInvite() {
  return useMutation({ mutationFn: (token: string) => unwrap(api.POST('/invites/accept', { body: { token } })) })
}

/** Compras parceladas; `q` filtra pela descrição ("quando comprei o notebook?"). */
export function usePurchases(houseId: string, q: string) {
  return useQuery({
    queryKey: [...keys.purchases(houseId), q] as const,
    queryFn: async (): Promise<Purchase[]> => {
      const data = await unwrap(
        api.GET('/households/{householdId}/purchases', { params: { path: { householdId: houseId }, query: { q: q || undefined, limit: 100 } } }),
      )
      return data.items
    },
  })
}

/** Contas fixas (recorrências). O servidor estende a previsão ao listar. */
export function useRecurrences(houseId: string) {
  return useQuery({
    queryKey: keys.recurrences(houseId),
    queryFn: (): Promise<Recurrence[]> => unwrap(api.GET('/households/{householdId}/recurrences', { params: { path: { householdId: houseId } } })),
  })
}

export function useRecurrenceActions(houseId: string) {
  const qc = useQueryClient()
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: RecurrencePatch }) =>
      unwrap(api.PATCH('/households/{householdId}/recurrences/{recurrenceId}', { params: { path: { householdId: houseId, recurrenceId: id } }, body })),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: keys.recurrences(houseId) }),
        qc.invalidateQueries({ queryKey: keys.allInvoices(houseId) }),
        qc.invalidateQueries({ queryKey: keys.summary(houseId) }),
      ]),
  })
  return { update }
}
