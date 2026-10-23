import { configure, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import type { CategoryHistory, MonthlySummary } from '../api/types'
import { fail, mockApi, monthsBetween, ok, me, renderAt } from '../test/utils'

configure({ asyncUtilTimeout: 5000 })

// Dia 22: o salário previsto ainda não foi marcado como recebido. O realizado da livre é negativo, o projetado não.
const summary: MonthlySummary = {
  month: '2026-10-01',
  wallets: {
    free: { expectedIncomeCents: 600000, receivedIncomeCents: 0, paidCents: 252681, balanceCents: -252681, pendingCents: 100000, projectedCents: 247319 },
    benefit: { expectedIncomeCents: 80000, receivedIncomeCents: 80000, paidCents: 92000, balanceCents: -12000, pendingCents: 0, projectedCents: -12000 },
  },
  totalPaidCents: 344681, totalPendingCents: 100000, overdueCents: 30000, overdueCount: 2,
  byCategory: [
    { categoryId: 'c1', totalCents: 300000, paidCents: 200000 },
    { categoryId: 'c2', totalCents: 150000, paidCents: 150000 },
  ],
}

const cats = [
  { id: 'c1', name: 'Moradia', isEssential: true, sortOrder: 0, archived: false },
  { id: 'c5', name: 'Gás', isEssential: true, sortOrder: 0, archived: false, parentId: 'c1' },
  { id: 'c6', name: 'Luz', isEssential: true, sortOrder: 1, archived: false, parentId: 'c1' },
  { id: 'c2', name: 'Mercado', defaultWallet: 'benefit' as const, isEssential: true, sortOrder: 1, archived: false },
]

/** Histórico sintético: Gás 100,00/mês (pago), Luz 50,00/mês (outubro a pagar), Mercado 200,00; parcelas no futuro. */
function history({ from, to }: { from: string; to: string }): ReturnType<typeof ok> {
  const months = monthsBetween(from, to)
  const pts = (fn: (m: string) => [number, number, number?]) =>
    months.map((month) => {
      const [totalCents, paidCents, seriesCents = 0] = fn(month)
      return { month, totalCents, paidCents, seriesCents }
    })
  const future = from > '2026-10-01'
  const data: CategoryHistory = {
    months,
    series: future
      ? [{ categoryId: 'c2', points: pts(() => [66000, 0, 66000]) }]
      : [
          { categoryId: 'c5', points: pts(() => [10000, 10000]) },
          { categoryId: 'c6', points: pts((m) => (m === '2026-10-01' ? [5000, 0] : [4000, 4000])) },
          { categoryId: 'c2', points: pts(() => [20000, 20000]) },
        ],
  }
  return ok(data)
}

function mockDesktop() {
  window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as never
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 22, 12))
})
afterEach(() => {
  vi.useRealTimers()
  // @ts-expect-error: remove o matchMedia simulado pelos testes de computador
  delete window.matchMedia
})

describe('resumo do mês', () => {
  it('salário ainda não recebido não vira alarme: o número principal é o projetado', async () => {
    mockApi({ me: ok(me), summary: ok(summary) })
    renderAt('/resumo?mes=2026-10')
    const livre = await screen.findByRole('region', { name: 'Carteira livre' })
    expect(within(livre).getByText('deve sobrar')).toBeInTheDocument()
    expect(within(livre).queryByText('[ ✖ ]')).not.toBeInTheDocument()
    expect(within(livre).getByText('R$ 2.473,19')).toBeInTheDocument()
    // o realizado aparece como informação secundária
    expect(within(livre).getByText('-R$ 2.526,81')).toBeInTheDocument()
    expect(within(livre).getByText('a pagar (estimado)')).toBeInTheDocument()
  })

  it('coral só quando o projetado é negativo', async () => {
    mockApi({ me: ok(me), summary: ok(summary) })
    renderAt('/resumo?mes=2026-10')
    const vr = await screen.findByRole('region', { name: 'Carteira de benefício' })
    expect(within(vr).getByText('vai faltar')).toBeInTheDocument()
    expect(within(vr).getByText('[ ✖ ]')).toBeInTheDocument()
    expect(within(vr).getAllByText('R$ 120,00').length).toBeGreaterThan(0)
  })

  it('destaques: saldo projetado da casa, a pagar, atrasado (com quantidade) e pago', async () => {
    mockApi({ me: ok(me), summary: ok(summary) })
    renderAt('/resumo?mes=2026-10')
    const top = await screen.findByRole('region', { name: 'Destaques do mês' })
    expect(within(top).getByText('R$ 2.353,19')).toBeInTheDocument() // 2.473,19 - 120,00
    expect(within(top).getByText('deve sobrar no mês')).toBeInTheDocument()
    expect(within(top).getByText('R$ 1.000,00')).toBeInTheDocument()
    expect(within(top).getByText('R$ 300,00')).toBeInTheDocument()
    expect(within(top).getByText(/2 contas vencidas/)).toBeInTheDocument()
    expect(within(top).getByText('R$ 3.446,81')).toBeInTheDocument()
    expect(within(top).getByText(/Projetado = tudo o que está previsto/)).toBeInTheDocument()
  })

  it('sem atraso, o destaque não usa o marcador de alerta', async () => {
    mockApi({ me: ok(me), summary: ok({ ...summary, overdueCents: 0, overdueCount: 0 }) })
    renderAt('/resumo?mes=2026-10')
    const top = await screen.findByRole('region', { name: 'Destaques do mês' })
    expect(within(top).getByText('nenhuma conta vencida')).toBeInTheDocument()
    expect(within(top).queryByText('[ ✖ ]')).not.toBeInTheDocument()
  })

  it('a categoria principal soma as subcategorias e detalha cada uma', async () => {
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
  })

  it('no celular, tocar na categoria abre o histórico num painel, com as filhas empilhadas', async () => {
    mockApi({
      me: ok(me), categories: ok(cats), history,
      summary: ok({ ...summary, byCategory: [{ categoryId: 'c5', totalCents: 10000, paidCents: 10000 }, { categoryId: 'c6', totalCents: 5000, paidCents: 0 }] }),
    })
    renderAt('/resumo?mes=2026-10')
    await userEvent.click(await screen.findByRole('button', { name: /ver histórico de Moradia/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Moradia' })
    const chart = await within(dialog).findByRole('img', { name: /Gasto com Moradia por mês/ })
    expect(chart).toHaveAccessibleName(/out\/26 R\$ 150,00/)
    expect(chart).toHaveAccessibleName(/mai\/26 R\$ 140,00/)
    const legenda = within(dialog).getByRole('list', { name: 'Legenda' })
    expect(within(legenda).getByText('Gás')).toBeInTheDocument()
    expect(within(legenda).getByText('Luz')).toBeInTheDocument()
    // média do período e variação contra setembro
    expect(within(dialog).getByText('R$ 141,67')).toBeInTheDocument() // (5 x 140 + 150) / 6
    expect(within(dialog).getByText('+R$ 10,00')).toBeInTheDocument()
    // alternar para 12 meses pede o intervalo maior
    await userEvent.click(within(dialog).getByRole('button', { name: '12 meses' }))
    await within(dialog).findByRole('img', { name: /nov\/25/ })
    expect(api.GET).toHaveBeenCalledWith('/households/{householdId}/summary/categories', expect.objectContaining({
      params: expect.objectContaining({ query: { from: '2025-11-01', to: '2026-10-01' } }),
    }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Fechar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('no computador, o histórico fica num painel ao lado (sem modal) e o teclado mostra o valor exato', async () => {
    mockDesktop()
    mockApi({ me: ok(me), categories: ok(cats), history, summary: ok({ ...summary, byCategory: [{ categoryId: 'c2', totalCents: 20000, paidCents: 20000 }] }) })
    renderAt('/resumo?mes=2026-10')
    const painel = await screen.findByRole('region', { name: 'Histórico de Mercado' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const grupo = await within(painel).findByRole('group', { name: /Gasto com Mercado por mês/ })
    fireEvent.focus(grupo)
    fireEvent.keyDown(grupo, { key: 'Home' })
    expect(within(painel).getByText('mai/26', { selector: 'span' })).toBeInTheDocument()
    // gráfico geral da casa no topo
    const geral = screen.getByRole('region', { name: 'Gasto por mês' })
    expect(await within(geral).findByRole('img', { name: /out\/26 R\$ 350,00/ })).toBeInTheDocument()
  })

  it('compromissos futuros somam parcelas e fixas dos próximos 3 meses', async () => {
    mockApi({ me: ok(me), summary: ok(summary), history })
    renderAt('/resumo?mes=2026-10')
    const sec = await screen.findByRole('region', { name: 'Compromissos futuros' })
    expect(within(sec).getByText('R$ 1.980,00')).toBeInTheDocument()
    expect(within(sec).getByText('nov/26')).toBeInTheDocument()
    expect(within(sec).getByRole('link', { name: 'ver parcelas e fixas' })).toHaveAttribute('href', '/parcelas')
  })

  it('sem parcelas nem fixas, não mostra compromissos', async () => {
    mockApi({ me: ok(me), summary: ok(summary) })
    renderAt('/resumo?mes=2026-10')
    await screen.findByRole('region', { name: 'Destaques do mês' })
    expect(screen.queryByRole('region', { name: 'Compromissos futuros' })).not.toBeInTheDocument()
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
