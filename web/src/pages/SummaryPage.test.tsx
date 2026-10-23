import { screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MonthlySummary } from '../api/types'
import { fail, mockApi, ok, me, renderAt } from '../test/utils'

const summary: MonthlySummary = {
  month: '2026-10-01',
  wallets: {
    free: { expectedIncomeCents: 600000, receivedIncomeCents: 500000, paidCents: 320000, balanceCents: 180000 },
    benefit: { expectedIncomeCents: 80000, receivedIncomeCents: 80000, paidCents: 92000, balanceCents: -12000 },
  },
  totalPaidCents: 412000, totalPendingCents: 188000,
  byCategory: [
    { categoryId: 'c1', totalCents: 300000, paidCents: 200000 },
    { categoryId: 'c2', totalCents: 150000, paidCents: 150000 },
  ],
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 20, 12))
})
afterEach(() => vi.useRealTimers())

describe('resumo do mês', () => {
  it('mostra sobra na carteira livre e falta na de benefício', async () => {
    mockApi({ me: ok(me), summary: ok(summary) })
    renderAt('/resumo?mes=2026-10')
    const livre = await screen.findByRole('region', { name: 'Carteira livre' })
    expect(within(livre).getByText('sobra')).toBeInTheDocument()
    expect(within(livre).getByText('R$ 1.800,00')).toBeInTheDocument()
    const vr = screen.getByRole('region', { name: 'Carteira de benefício' })
    expect(within(vr).getByText('falta')).toBeInTheDocument()
    // o saldo negativo aparece como valor absoluto sob o rótulo "falta"
    expect(within(vr).getByText('R$ 120,00')).toBeInTheDocument()
  })

  it('detalha previsto, recebido e pago de cada carteira', async () => {
    mockApi({ me: ok(me), summary: ok(summary) })
    renderAt('/resumo?mes=2026-10')
    const livre = await screen.findByRole('region', { name: 'Carteira livre' })
    expect(within(livre).getByText('R$ 6.000,00')).toBeInTheDocument()
    expect(within(livre).getByText('R$ 5.000,00')).toBeInTheDocument()
    expect(within(livre).getByText('R$ 3.200,00')).toBeInTheDocument()
  })

  it('a categoria principal soma as subcategorias e detalha cada uma', async () => {
    const cats = [
      { id: 'c1', name: 'Moradia', isEssential: true, sortOrder: 0, archived: false },
      { id: 'c5', name: 'Gás', isEssential: true, sortOrder: 0, archived: false, parentId: 'c1' },
      { id: 'c6', name: 'Luz', isEssential: true, sortOrder: 1, archived: false, parentId: 'c1' },
    ]
    mockApi({
      me: ok(me), categories: ok(cats),
      summary: ok({ ...summary, byCategory: [
        { categoryId: 'c5', totalCents: 15000, paidCents: 15000 },
        { categoryId: 'c6', totalCents: 9000, paidCents: 0 },
        { categoryId: 'c1', totalCents: 100000, paidCents: 100000 },
      ] }),
    })
    renderAt('/resumo?mes=2026-10')
    const region = await screen.findByRole('region', { name: 'Por categoria' })
    expect(await within(region).findByText('R$ 1.240,00')).toBeInTheDocument() // 150 + 90 + 1000
    const detalhe = within(region).getByRole('list', { name: 'Detalhe de Moradia' })
    expect(within(detalhe).getByText('Moradia (geral)')).toBeInTheDocument()
    expect(within(detalhe).getByText('Gás')).toBeInTheDocument()
    expect(within(detalhe).getByText('R$ 150,00')).toBeInTheDocument()
  })

  it('mostra o que foi pago e o que falta pagar, e o total por categoria', async () => {
    mockApi({ me: ok(me), summary: ok(summary) })
    renderAt('/resumo?mes=2026-10')
    const contas = await screen.findByRole('region', { name: 'Pago e a pagar' })
    expect(within(contas).getByText('R$ 4.120,00')).toBeInTheDocument()
    expect(within(contas).getByText('R$ 1.880,00')).toBeInTheDocument()
    expect(within(contas).getByRole('img', { name: /69% das contas do mês já foi pago/ })).toBeInTheDocument()
    const cats = screen.getByRole('region', { name: 'Por categoria' })
    expect(within(cats).getByText('Moradia')).toBeInTheDocument() // nome da categoria vem das categorias da casa
    expect(within(cats).getByText('R$ 3.000,00')).toBeInTheDocument()
  })

  it('sem receitas, orienta a cadastrar em receitas', async () => {
    mockApi({ me: ok(me) })
    renderAt('/resumo?mes=2026-10')
    const aviso = (await screen.findByText(/Ainda não há receitas neste mês/)).closest('p')!
    expect(within(aviso).getByRole('link', { name: 'receitas' })).toHaveAttribute('href', '/receitas')
  })

  it('erro ao carregar oferece tentar de novo', async () => {
    mockApi({ me: ok(me), summary: fail(500, 'internal_error') })
    renderAt('/resumo?mes=2026-10')
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar o resumo')
  })

  it('a navegação leva do mês ao resumo mantendo o mês escolhido', async () => {
    mockApi({ me: ok(me), summary: ok(summary) })
    renderAt('/?mes=2026-08')
    const links = await screen.findAllByRole('link', { name: /resumo/ })
    expect(links[0]).toHaveAttribute('href', '/resumo?mes=2026-08')
  })
})
