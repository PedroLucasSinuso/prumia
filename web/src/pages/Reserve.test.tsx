import { configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import { me, mockApi, ok, renderAt, viewerMe } from '../test/utils'

configure({ asyncUtilTimeout: 5000 })

beforeEach(() => {
  vi.restoreAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 22, 12))
  try { localStorage.clear() } catch { /* sem armazenamento */ }
})

const configured = { targetMonths: 6, walletIds: ['w2'], essentialMonthlyCents: 110000, basisMonths: 2, savedCents: 330000, targetCents: 660000 }

describe('reserva de emergência', () => {
  it('sem meta, o Resumo não mostra nada novo', async () => {
    mockApi({ me: ok(me) })
    renderAt('/resumo?mes=2026-10')
    await screen.findByRole('region', { name: 'Destaques do mês' })
    expect(screen.queryByRole('region', { name: 'Reserva de emergência' })).not.toBeInTheDocument()
  })

  it('com meta, o Resumo mostra o guardado, os meses cobertos e a meta', async () => {
    mockApi({ me: ok(me), reserve: ok(configured) })
    renderAt('/resumo?mes=2026-10')
    const block = await screen.findByRole('region', { name: 'Reserva de emergência' })
    expect(within(block).getByText('R$ 3.300,00')).toBeInTheDocument()
    expect(within(block).getByText('3')).toBeInTheDocument() // 3.300 / 1.100 = 3 meses
    expect(within(block).getByText('R$ 6.600,00')).toBeInTheDocument()
    expect(within(block).getByRole('img', { name: '50% da meta da reserva' })).toBeInTheDocument()
  })

  it('o Responsável define a meta e as carteiras em Ajustes > Carteiras', async () => {
    mockApi({ me: ok(me) })
    renderAt('/ajustes/carteiras')
    const card = await screen.findByRole('region', { name: 'Reserva de emergência' })
    await userEvent.selectOptions(within(card).getByRole('combobox'), '6')
    await userEvent.click(within(card).getByRole('checkbox', { name: 'Benefício' }))
    await userEvent.click(within(card).getByRole('button', { name: 'Salvar reserva' }))
    await waitFor(() =>
      expect(api.PUT).toHaveBeenCalledWith('/households/{householdId}/reserve', {
        params: { path: { householdId: 'h1' } },
        body: { targetMonths: 6, walletIds: ['w2'] },
      }),
    )
    expect(await screen.findByText(/Meta da reserva salva/)).toBeInTheDocument()
  })

  it('quem não é Responsável só vê a meta, e só quando há uma', async () => {
    mockApi({ me: ok(viewerMe) })
    renderAt('/ajustes/carteiras')
    await screen.findByRole('list', { name: 'Carteiras ativas' })
    expect(screen.queryByRole('region', { name: 'Reserva de emergência' })).not.toBeInTheDocument()
  })
})
