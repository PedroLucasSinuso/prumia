import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from './client'
import { ApiError, unwrap } from './errors'
import type { DocumentExtraction, CnpjInfo, Payee, PayeeInput, PayeePatch, Category, CategoryHistory, CategoryInput, CategoryPatch, Income, IncomeDatePreview, IncomeInput, IncomePatch, TaxEstimate, DateRule, IncomeSource, IncomeSourceInput, IncomeSourcePatch, Invoice, InvoiceInput, InvoicePatch, Purchase, PurchaseInput, Problem, Recurrence, RecurrenceInput, RecurrencePatch, SeriesScope, InviteCreated, Member, MonthlySummary, Role, Wallet, WalletInput, WalletPatch, Transfer, TransferInput, TransferResult } from './types'

// Chaves de cache. Toda mutação invalida ['invoices', casa] e a lista do mês é refeita sozinha.
const keys = {
  categories: (house: string) => ['categories', house] as const,
  payees: (house: string) => ['payees', house] as const,
  wallets: (house: string) => ['wallets', house] as const,
  transfers: (house: string, month: string) => ['transfers', house, month] as const,
  allTransfers: (house: string) => ['transfers', house] as const,
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

/** Favorecidos da casa, inclusive arquivados (contas antigas continuam mostrando o nome). Quem oferece para escolher filtra `archived`. */
export function usePayees(houseId: string) {
  return useQuery({
    queryKey: keys.payees(houseId),
    queryFn: (): Promise<Payee[]> =>
      unwrap(api.GET('/households/{householdId}/payees', { params: { path: { householdId: houseId }, query: { includeArchived: true } } })),
  })
}

/** Criar e editar (inclui arquivar/restaurar via `archived`) favorecidos. */
export function usePayeeActions(houseId: string) {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: keys.payees(houseId) })
  const create = useMutation({
    mutationFn: (body: PayeeInput) => unwrap(api.POST('/households/{householdId}/payees', { params: { path: { householdId: houseId } }, body })),
    onSettled: refresh,
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: PayeePatch }) =>
      unwrap(api.PATCH('/households/{householdId}/payees/{payeeId}', { params: { path: { householdId: houseId, payeeId: id } }, body })),
    onSettled: refresh,
  })
  return { create, update }
}

/** Carteiras da casa, inclusive arquivadas (o histórico continua mostrando o nome). Quem oferece para escolher filtra `archived`. */
export function useWallets(houseId: string) {
  return useQuery({
    queryKey: keys.wallets(houseId),
    enabled: houseId !== '',
    queryFn: (): Promise<Wallet[]> =>
      unwrap(api.GET('/households/{householdId}/wallets', { params: { path: { householdId: houseId }, query: { includeArchived: true } } })),
  })
}

/** Criar, editar, arquivar e restaurar carteiras (só o Responsável). O resumo depende delas: também é refeito. */
export function useWalletActions(houseId: string) {
  const qc = useQueryClient()
  const refresh = () =>
    Promise.all([qc.invalidateQueries({ queryKey: keys.wallets(houseId) }), qc.invalidateQueries({ queryKey: keys.summary(houseId) })])
  const path = (walletId: string) => ({ params: { path: { householdId: houseId, walletId } } })
  const create = useMutation({
    mutationFn: (body: WalletInput) => unwrap(api.POST('/households/{householdId}/wallets', { params: { path: { householdId: houseId } }, body })),
    onSettled: refresh,
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: WalletPatch }) => unwrap(api.PATCH('/households/{householdId}/wallets/{walletId}', { ...path(id), body })),
    onSettled: refresh,
  })
  const archive = useMutation({
    mutationFn: (id: string) => unwrap(api.POST('/households/{householdId}/wallets/{walletId}/archive', path(id))),
    onSettled: refresh,
  })
  const restore = useMutation({
    mutationFn: (id: string) => unwrap(api.POST('/households/{householdId}/wallets/{walletId}/restore', path(id))),
    onSettled: refresh,
  })
  return { create, update, archive, restore }
}

/** Transferências entre carteiras de uma competência (a lista do mês, da data mais recente para a mais antiga). */
export function useTransfers(houseId: string, month: string) {
  return useQuery({
    queryKey: keys.transfers(houseId, month),
    enabled: houseId !== '',
    queryFn: (): Promise<Transfer[]> =>
      unwrap(api.GET('/households/{householdId}/transfers', { params: { path: { householdId: houseId }, query: { month } } })),
  })
}

/**
 * Criar, excluir e restaurar (Desfazer) transferências. Elas só mexem nos saldos: ao terminar, a lista e o resumo são refeitos.
 * Não há edição (para corrigir: exclui e cria outra).
 */
export function useTransferActions(houseId: string) {
  const qc = useQueryClient()
  const refresh = () =>
    Promise.all([qc.invalidateQueries({ queryKey: keys.allTransfers(houseId) }), qc.invalidateQueries({ queryKey: keys.summary(houseId) })])
  const path = (transferId: string) => ({ params: { path: { householdId: houseId, transferId } } })
  const create = useMutation({
    mutationFn: (body: TransferInput): Promise<TransferResult> =>
      unwrap(api.POST('/households/{householdId}/transfers', { params: { path: { householdId: houseId } }, body })),
    onSettled: refresh,
  })
  const remove = useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/households/{householdId}/transfers/{transferId}', path(id))),
    onSettled: refresh,
  })
  const restore = useMutation({
    mutationFn: (id: string) => unwrap(api.POST('/households/{householdId}/transfers/{transferId}/restore', path(id))),
    onSettled: refresh,
  })
  return { create, remove, restore }
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
    mutationFn: ({ id, walletId }: { id: string; walletId: string }) =>
      unwrap(api.POST('/households/{householdId}/invoices/{invoiceId}/pay', { ...path(id), body: { walletId } })),
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

  // Várias contas de uma vez (tela "Importar"): tudo ou nada no servidor.
  const createBatch = useMutation({
    mutationFn: (items: InvoiceInput[]) =>
      unwrap(api.POST('/households/{householdId}/invoices/batch', { params: { path: { householdId: houseId } }, body: { items } })),
    onSettled: refresh,
  })

  return { create, update, remove, restore, pay, unpay, createPurchase, createRecurrence, createBatch }
}

/** Detalhe de uma invoice (inclui o boleto). Usado para abrir uma conta que pode estar em outro mês. */
export function getInvoice(houseId: string, invoiceId: string): Promise<Invoice> {
  return unwrap(api.GET('/households/{householdId}/invoices/{invoiceId}', { params: { path: { householdId: houseId, invoiceId } } }))
}

/**
 * Razão social e nome fantasia de um CNPJ (só dígitos). Devolve null quando não achou OU a consulta está fora do ar:
 * é só uma ajuda de preenchimento, então falhar nunca atrapalha o cadastro.
 */
export async function lookupCnpj(cnpj: string): Promise<CnpjInfo | null> {
  try {
    return await unwrap(api.GET('/cnpj/{cnpj}', { params: { path: { cnpj } } }))
  } catch {
    return null
  }
}

// Status HTTP -> código estável, para quando a resposta não traz `code` (ex.: 413 devolvido pelo nginx, em HTML).
const extractStatusCode: Record<number, string> = { 413: 'file_too_large', 422: 'boleto_not_found', 429: 'too_many_requests', 503: 'busy' }

/**
 * Lê um documento (PDF/PNG/JPG): um boleto, uma conta sem boleto ou uma lista de contas. Nada é salvo no servidor; a pessoa
 * revisa antes de criar. Envia multipart/form-data: o `bodySerializer` monta o FormData e o openapi-fetch deixa o navegador
 * pôr o boundary. Falha vira ApiError com `problem.code` sempre preenchido (`password_required`, `file_too_large`...).
 *
 * Função solta (não mutação do TanStack Query): a senha do PDF só passa por esta chamada e não fica em cache nenhum; e a
 * tela "Importar" lê vários arquivos em sequência, com espera entre eles.
 * (O endpoint antigo `/boletos/extract` continua no servidor por compatibilidade; o app não o usa mais.)
 */
export async function extractDocument(houseId: string, file: File, password?: string): Promise<DocumentExtraction> {
  let result
  try {
    result = await api.POST('/households/{householdId}/documents/extract', {
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
}

/** Limite de caracteres do texto colado (o servidor responde 413 acima disso). */
export const MAX_PARSE_TEXT = 20000

const textStatusCode: Record<number, string> = { 413: 'text_too_large', 422: 'boleto_not_found', 429: 'too_many_requests' }

/**
 * Lê um texto escrito ou colado ("Gás: R$ 150,00" uma conta por linha): mesma resposta de `extractDocument`, sem arquivo.
 * Nada é salvo; a pessoa revisa antes de criar. Falha vira ApiError com `problem.code` preenchido.
 */
export async function parseDocumentText(houseId: string, text: string): Promise<DocumentExtraction> {
  let result
  try {
    result = await api.POST('/households/{householdId}/documents/parse-text', {
      params: { path: { householdId: houseId } },
      body: { text },
    })
  } catch {
    throw new ApiError(undefined, true)
  }
  if (result.data) return result.data
  const problem = typeof result.error === 'object' && result.error !== null ? (result.error as Problem) : undefined
  const status = problem?.status ?? result.response?.status ?? 0
  const code = problem?.code ?? textStatusCode[status] ?? 'boleto_not_found'
  throw new ApiError({ title: code, ...problem, status, code })
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

/**
 * Histórico por categoria (gráficos do resumo), de `from` a `to` (dias 1, no máximo 24 meses). Fica sob a chave do resumo:
 * tudo que invalida o resumo (pagar, lançar, receber) também atualiza os gráficos.
 */
export function useCategoryHistory(houseId: string, from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: [...keys.summary(houseId), 'history', from, to] as const,
    enabled: enabled && houseId !== '',
    queryFn: (): Promise<CategoryHistory> =>
      unwrap(api.GET('/households/{householdId}/summary/categories', { params: { path: { householdId: houseId }, query: { from, to } } })),
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

/**
 * Ações sobre receitas. `scope` vale para receitas que se repetem: `this` (só este mês) ou `following` (este e os seguintes
 * que ainda não contam como recebidos). `receive` = "caiu" e `unreceive` = "não caiu" (o recebimento em si é automático).
 */
export function useIncomeActions(houseId: string) {
  const qc = useQueryClient()
  // Receita muda o saldo do resumo e a lista de repetições: invalida tudo isso.
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.allIncomes(houseId) }),
      qc.invalidateQueries({ queryKey: keys.sources(houseId) }),
      qc.invalidateQueries({ queryKey: keys.summary(houseId) }),
    ])
  const path = (incomeId: string) => ({ params: { path: { householdId: houseId, incomeId } } })
  const withScope = (incomeId: string, scope: SeriesScope = 'this') => ({ params: { path: { householdId: houseId, incomeId }, query: { scope } } })

  const create = useMutation({
    mutationFn: (body: IncomeInput) => unwrap(api.POST('/households/{householdId}/incomes', { params: { path: { householdId: houseId } }, body })),
    onSettled: refresh,
  })
  const update = useMutation({
    mutationFn: ({ id, body, scope }: { id: string; body: IncomePatch; scope?: SeriesScope }) =>
      unwrap(api.PATCH('/households/{householdId}/incomes/{incomeId}', { ...withScope(id, scope), body })),
    onSettled: refresh,
  })
  const remove = useMutation({
    mutationFn: ({ id, scope }: { id: string; scope?: SeriesScope }) => unwrap(api.DELETE('/households/{householdId}/incomes/{incomeId}', withScope(id, scope))),
    onSettled: refresh,
  })
  const restore = useMutation({
    mutationFn: ({ id, scope }: { id: string; scope?: SeriesScope }) => unwrap(api.POST('/households/{householdId}/incomes/{incomeId}/restore', withScope(id, scope))),
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
  return { create, update, remove, restore, receive, unreceive }
}

/** Prévia das datas de uma regra de data (próximos meses) e os dias úteis de cada mês. Não grava nada. */
export function useIncomeDatePreview(houseId: string, rule: DateRule | undefined, month: string, count = 3) {
  return useQuery({
    queryKey: ['income-dates', houseId, month, rule?.rule, rule?.n ?? null, rule?.weekendAdjust ?? null, rule?.monthOffset ?? 0, count] as const,
    enabled: houseId !== '' && rule !== undefined,
    staleTime: 5 * 60_000,
    queryFn: (): Promise<IncomeDatePreview[]> =>
      unwrap(
        api.GET('/households/{householdId}/income-dates', {
          params: {
            path: { householdId: houseId },
            query: { month, rule: rule!.rule, ...(rule!.n != null ? { n: rule!.n } : {}), ...(rule!.weekendAdjust ? { weekendAdjust: rule!.weekendAdjust } : {}), ...(rule!.monthOffset ? { monthOffset: rule!.monthOffset } : {}), count },
          },
        }),
      ),
  })
}

/** Estimativa de INSS e IRRF de um salário (sugestão para preencher os descontos). Chamada sob demanda, não é uma consulta em cache. */
export function estimateTax(houseId: string, month: string, grossCents: number, dependents: number): Promise<TaxEstimate> {
  return unwrap(
    api.GET('/households/{householdId}/tax/estimate', { params: { path: { householdId: houseId }, query: { month, grossCents, dependents } } }),
  )
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
  // Excluir a repetição: os previstos somem, recebidos ficam. Desfazer devolve o lote (a API acha o corte mais recente).
  const remove = useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/households/{householdId}/income-sources/{sourceId}', { params: { path: { householdId: houseId, sourceId: id } } })),
    onSettled: refresh,
  })
  const restore = useMutation({
    mutationFn: (id: string) => unwrap(api.POST('/households/{householdId}/income-sources/{sourceId}/restore', { params: { path: { householdId: houseId, sourceId: id } } })),
    onSettled: refresh,
  })
  return { create, update, remove, restore }
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

/** Uma compra parcelada com todas as parcelas (total, pagas e quanto falta). Só consulta com `purchaseId`. */
export function usePurchase(houseId: string, purchaseId: string | null | undefined) {
  return useQuery({
    queryKey: [...keys.purchases(houseId), 'detalhe', purchaseId] as const,
    enabled: Boolean(purchaseId),
    queryFn: (): Promise<Purchase> =>
      unwrap(api.GET('/households/{householdId}/purchases/{purchaseId}', { params: { path: { householdId: houseId, purchaseId: purchaseId! } } })),
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
