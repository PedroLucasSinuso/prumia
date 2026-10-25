import { configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import type { MonthlySummary, WalletAdjustment } from '../api/types'
import { mockApi, ok, me, renderAt, viewerMe, walletBalance } from '../test/utils'

configure({ asyncUtilTimeout: 5000 })

// Receita de outubro lançada, gastos não: o calculado da Geral é R$ 5.000,00.
const summary: MonthlySummary = {
  month: '2026-10-01',
  wallets: [
    walletBalance('w1', { receivedIncomeCents: 500000, expectedIncomeCents: 500000, balanceCents: 500000, monthBalanceCents: 500000, projectedCents: 500000 }),
    walletBalance('w2'),
  ],
  totalPaidCents: 0, totalPendingCents: 0, overdueCents: 0, overdueCount: 0, byCategory: [],
}

const adjustment = (over: Partial<WalletAdjustment> = {}): WalletAdjustment => ({
  id: 'a1', walletId: 'w1', competenceMonth: '2026-10-01', amountCents: -380000, notes: null, createdAt: '2026-10-22T12:00:00Z', ...over,
})

beforeEach(() => {
  vi.restoreAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 22, 12))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('conferir saldo', () => {
  it('mostra o calculado, a diferença e grava o saldo real; Desfazer exclui o ajuste', async () => {
    mockApi({ me: ok(me), summary: ok(summary), createAdjustment: ok(adjustment()) })
    renderAt('/resumo?mes=2026-10')
    await userEvent.click(await screen.findByRole('button', { name: 'Conferir saldo de Geral' }))
    const dialog = await screen.findByRole('dialog', { name: 'Conferir saldo' })
    expect(within(dialog).getByText('R$ 5.000,00')).toBeInTheDocument()
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Saldo real/ }), '120000')
    expect(within(dialog).getByText('-R$ 3.800,00')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Conferir saldo' }))

    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/households/{householdId}/wallet-adjustments', {
        params: { path: { householdId: 'h1' } },
        body: { walletId: 'w1', competenceMonth: '2026-10-01', actualBalanceCents: 120000 },
      }),
    )
    expect(await screen.findByText('Saldo de Geral conferido: ajuste de -R$ 3.800,00 em outubro.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Desfazer' }))
    await waitFor(() =>
      expect(api.DELETE).toHaveBeenCalledWith(
        '/households/{householdId}/wallet-adjustments/{adjustmentId}',
        expect.objectContaining({ params: { path: { householdId: 'h1', adjustmentId: 'a1' } } }),
      ),
    )
  })

  it('saldo igual ao calculado não grava nada', async () => {
    mockApi({ me: ok(me), summary: ok(summary) })
    renderAt('/resumo?mes=2026-10')
    await userEvent.click(await screen.findByRole('button', { name: 'Conferir saldo de Geral' }))
    const dialog = await screen.findByRole('dialog', { name: 'Conferir saldo' })
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Saldo real/ }), '500000')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Conferir saldo' }))
    expect(await within(dialog).findByText('O saldo já confere: não há diferença para ajustar.')).toBeInTheDocument()
    expect(api.POST).not.toHaveBeenCalledWith('/households/{householdId}/wallet-adjustments', expect.anything())
  })

  it('o ajuste do mês aparece na carteira e na lista, e some para quem não usa', async () => {
    const adjusted: MonthlySummary = { ...summary, wallets: [walletBalance('w1', { adjustmentsCents: -380000, balanceCents: 120000 }), walletBalance('w2')] }
    mockApi({ me: ok(me), summary: ok(adjusted), adjustments: ok([adjustment({ notes: 'extrato' })]) })
    renderAt('/resumo?mes=2026-10')
    const lista = await screen.findByRole('region', { name: 'Ajustes de saldo do mês' })
    expect(within(lista).getByText('extrato')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Geral' })).getByText('ajustes de saldo (conferência)')).toBeInTheDocument()
  })

  it('sem ajuste no mês não há bloco de ajustes; mês futuro e Só leitura não conferem', async () => {
    mockApi({ me: ok(me), summary: ok({ ...summary, month: '2026-11-01' }) })
    renderAt('/resumo?mes=2026-11')
    await screen.findByRole('region', { name: 'Geral' })
    expect(screen.queryByRole('region', { name: 'Ajustes de saldo do mês' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Conferir saldo/ })).not.toBeInTheDocument()
  })

  it('Só leitura não vê o botão', async () => {
    mockApi({ me: ok(viewerMe), summary: ok(summary) })
    renderAt('/resumo?mes=2026-10')
    await screen.findByRole('region', { name: 'Geral' })
    expect(screen.queryByRole('button', { name: /Conferir saldo/ })).not.toBeInTheDocument()
  })
})
