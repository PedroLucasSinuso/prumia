import { configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import type { MonthlySummary, Wallet } from '../api/types'
import { me, mockApi, ok, renderAt, walletBalance, wallets } from '../test/utils'

configure({ asyncUtilTimeout: 5000 })

beforeEach(() => {
  vi.restoreAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 22, 12))
  try { localStorage.clear() } catch { /* sem armazenamento */ }
})

const cdb: Wallet = { id: 'w3', name: 'CDB', kind: 'investment', institution: 'Banco Fictício', isDefault: false, warnOnOverdraft: true, openingBalanceCents: 0, openingBalanceMonth: null, sortOrder: 2, archived: false }

const summary: MonthlySummary = {
  month: '2026-10-01', totalPaidCents: 0, totalPendingCents: 0, overdueCents: 0, overdueCount: 0, byCategory: [],
  wallets: [
    walletBalance('w1', { projectedCents: 50000, transfersOutCents: 100000 }),
    walletBalance('w2'),
    { ...walletBalance('w1'), walletId: 'w3', name: 'CDB', kind: 'investment', isDefault: false, transfersInCents: 100000, adjustmentsCents: 1500, balanceCents: 101500, projectedCents: 101500 },
  ],
}

describe('investimentos (carteira especial)', () => {
  it('o Resumo mostra os investimentos à parte, fora do saldo projetado', async () => {
    mockApi({ me: ok(me), wallets: ok([...wallets, cdb]), summary: ok(summary) })
    renderAt('/resumo?mes=2026-10')
    const destaques = await screen.findByRole('region', { name: 'Destaques do mês' })
    expect(within(destaques).getByText('R$ 500,00')).toBeInTheDocument() // só Geral + Benefício
    const inv = screen.getByRole('region', { name: 'Investimentos' })
    const card = within(inv).getByRole('region', { name: 'CDB' })
    expect(within(card).getByText('R$ 1.015,00')).toBeInTheDocument()
    expect(within(card).getByText('Banco Fictício')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Atualizar valor de CDB' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Geral' })).toBeInTheDocument()
  })

  it('com as taxas da BrasilAPI, compara o rendimento do mês com o CDI', async () => {
    const rates = { available: true, fetchedAt: '2026-10-22T09:00:00Z', rates: [{ code: 'cdi', name: 'CDI', basisPoints: 1490 }, { code: 'selic', name: 'Selic', basisPoints: 1500 }, { code: 'ipca', name: 'IPCA', basisPoints: 517 }] }
    mockApi({ me: ok(me), wallets: ok([...wallets, cdb]), summary: ok(summary), rates: ok(rates) })
    renderAt('/resumo?mes=2026-10')
    const inv = await screen.findByRole('region', { name: 'Investimentos' })
    expect(await within(inv).findByText(/referências:/)).toHaveTextContent('CDI 14,90% ao ano · Selic 15,00% ao ano · IPCA 5,17% em 12 meses (BrasilAPI)')
    const card = within(inv).getByRole('region', { name: 'CDB' })
    expect(within(card).getByText('rendeu no mês').nextSibling).toHaveTextContent('1,50% · CDI ≈ 1,16%') // 15 / 1.000
  })

  it('sem a BrasilAPI, o bloco aparece sem a comparação', async () => {
    mockApi({ me: ok(me), wallets: ok([...wallets, cdb]), summary: ok(summary) })
    renderAt('/resumo?mes=2026-10')
    const inv = await screen.findByRole('region', { name: 'Investimentos' })
    expect(within(inv).queryByText(/referências/)).not.toBeInTheDocument()
    expect(within(inv).getByText('rendeu no mês').nextSibling).toHaveTextContent(/^1,50%$/)
  })

  it('o Responsável cria um investimento com instituição', async () => {
    mockApi({ me: ok(me) })
    renderAt('/ajustes/carteiras')
    await screen.findByRole('list', { name: 'Carteiras ativas' })
    await userEvent.click(screen.getByRole('button', { name: /Nova carteira/ }))
    const painel = await screen.findByRole('dialog', { name: 'Nova carteira' }).catch(() => screen.getByRole('region', { name: 'Nova carteira' }))
    await userEvent.click(within(painel).getByRole('radio', { name: 'investimento' }))
    await userEvent.type(within(painel).getByLabelText('Nome'), 'Tesouro')
    await userEvent.type(within(painel).getByLabelText('Instituição (opcional)'), 'Corretora Fictícia')
    await userEvent.click(within(painel).getByRole('button', { name: 'Criar carteira' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/households/{householdId}/wallets', expect.objectContaining({
        body: expect.objectContaining({ name: 'Tesouro', kind: 'investment', institution: 'Corretora Fictícia' }),
      })),
    )
  })

  it('investimento aberto em Ajustes não oferece "Tornar padrão"', async () => {
    mockApi({ me: ok(me), wallets: ok([...wallets, cdb]) })
    renderAt('/ajustes/carteiras')
    const list = await screen.findByRole('list', { name: 'Carteiras ativas' })
    expect(within(list).getByText(/investimento · Banco Fictício/)).toBeInTheDocument()
    await userEvent.click(within(list).getByRole('button', { name: 'Abrir carteira CDB' }))
    await screen.findByRole('button', { name: 'Arquivar carteira' })
    expect(screen.queryByRole('button', { name: 'Tornar padrão' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'investimento' })).not.toBeInTheDocument() // o tipo não muda
  })
})
