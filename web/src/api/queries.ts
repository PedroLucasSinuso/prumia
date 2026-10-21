import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from './client'
import { unwrap } from './errors'
import type { Category, Invoice, InvoiceInput, InvoicePatch, Wallet } from './types'

// Chaves de cache. Toda mutação invalida ['invoices', casa] e a lista do mês é refeita sozinha.
const keys = {
  categories: (house: string) => ['categories', house] as const,
  invoices: (house: string, month: string) => ['invoices', house, month] as const,
  allInvoices: (house: string) => ['invoices', house] as const,
}

export function useCategories(houseId: string) {
  return useQuery({
    queryKey: keys.categories(houseId),
    queryFn: (): Promise<Category[]> =>
      unwrap(api.GET('/households/{householdId}/categories', { params: { path: { householdId: houseId } } })),
  })
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
  const refresh = () => qc.invalidateQueries({ queryKey: keys.allInvoices(houseId) })
  const path = (invoiceId: string) => ({ params: { path: { householdId: houseId, invoiceId } } })

  const create = useMutation({
    mutationFn: (body: InvoiceInput) =>
      unwrap(api.POST('/households/{householdId}/invoices', { params: { path: { householdId: houseId } }, body })),
    onSettled: refresh,
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: InvoicePatch }) =>
      unwrap(api.PATCH('/households/{householdId}/invoices/{invoiceId}', { ...path(id), body })),
    onSettled: refresh,
  })
  const remove = useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/households/{householdId}/invoices/{invoiceId}', path(id))),
    onSettled: refresh,
  })
  const restore = useMutation({
    mutationFn: (id: string) => unwrap(api.POST('/households/{householdId}/invoices/{invoiceId}/restore', path(id))),
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

  return { create, update, remove, restore, pay, unpay }
}
