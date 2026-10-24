import { configure, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import type { Wallet } from '../api/types'
import { WalletCard } from '../components/WalletCard'
import { me, mockApi, ok, renderAt, walletBalance, wallets } from '../test/utils'

configure({ asyncUtilTimeout: 5000 })

beforeEach(() => vi.restoreAllMocks())

const conta: Wallet = { id: 'w3', name: 'Conta', isDefault: false, warnOnOverdraft: true, openingBalanceCents: 100000, openingBalanceMonth: '2026-10-01', sortOrder: 2, archived: false }

const patchBodies = () => vi.mocked(api.PATCH).mock.calls.map((c) => (c[1] as { body: unknown }).body)

describe('carteira · mês de início do saldo inicial', () => {
  async function abrirLista(w: Wallet) {
    mockApi({ me: ok(me), wallets: ok([...wallets, w]) })
    renderAt('/ajustes/carteiras')
    return screen.findByRole('list', { name: 'Carteiras ativas' })
  }

  it('a lista mostra "começa em" só para quem tem mês de início', async () => {
    const list = await abrirLista(conta)
    expect(within(list).getByText(/começa em outubro de 2026/)).toBeInTheDocument()
    expect(within(list).getAllByText(/começa em/)).toHaveLength(1)
  })

  it('o formulário mostra o mês e a frase de apoio; limpar manda null no PATCH', async () => {
    await abrirLista(conta)
    await userEvent.click(screen.getByRole('button', { name: 'Abrir carteira Conta' }))
    const trigger = await screen.findByRole('button', { name: /Saldo inicial vale a partir de/ })
    expect(trigger).toHaveTextContent('outubro de 2026')
    expect(screen.getByText(/Os meses antes deste aparecem normalmente, mas não entram no saldo que vem de trás/)).toBeInTheDocument()
    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('button', { name: 'Limpar' }))
    expect(trigger).toHaveTextContent('sem data: conta desde o início')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar carteira' }))
    await waitFor(() => expect(patchBodies()).toHaveLength(1))
    expect(patchBodies()[0]).toEqual(expect.objectContaining({ openingBalanceMonth: null }))
    expect(patchBodies()[0]).not.toHaveProperty('openingBalanceCents')
  })

  it('sem mexer no mês, o PATCH não o envia', async () => {
    await abrirLista(conta)
    await userEvent.click(screen.getByRole('button', { name: 'Abrir carteira Conta' }))
    await screen.findByRole('button', { name: /Saldo inicial vale a partir de/ })
    await userEvent.click(screen.getByRole('button', { name: 'Salvar carteira' }))
    await waitFor(() => expect(patchBodies()).toHaveLength(1))
    expect(patchBodies()[0]).not.toHaveProperty('openingBalanceMonth')
  })

  it('criar com um mês de início envia o dia 1 do mês escolhido', async () => {
    await abrirLista(conta)
    await userEvent.click(screen.getByRole('button', { name: /Nova carteira/ }))
    const painel = await screen.findByRole('dialog', { name: 'Nova carteira' }).catch(() => screen.getByRole('region', { name: 'Nova carteira' }))
    await userEvent.type(within(painel).getByLabelText('Nome'), 'Reserva')
    await userEvent.click(within(painel).getByRole('button', { name: /Saldo inicial vale a partir de/ }))
    await userEvent.click(screen.getByRole('button', { name: /^março de \d{4}$/ }))
    await userEvent.click(within(painel).getByRole('button', { name: 'Criar carteira' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/households/{householdId}/wallets', expect.objectContaining({ body: expect.objectContaining({ name: 'Reserva', openingBalanceMonth: expect.stringMatching(/^\d{4}-03-01$/) }) })),
    )
  })
})

describe('WalletCard · antes do mês de início', () => {
  const comInicio = walletBalance('w1', { openingBalanceCents: 100000, openingBalanceMonth: '2026-10-01', carryOverCents: 0, balanceCents: -60000, monthBalanceCents: -60000, paidCents: 60000 })

  it('mostra "esta carteira começa em" e esconde o saldo dos meses anteriores', () => {
    render(<WalletCard title="Geral" hint="" balance={{ ...comInicio, carryOverCents: 7 }} month="2026-09-01" />)
    expect(screen.getByText('esta carteira começa em outubro de 2026')).toBeInTheDocument()
    expect(screen.queryByText('saldo que veio dos meses anteriores')).not.toBeInTheDocument()
  })

  it('no mês de início e depois, mostra o saldo que veio de trás', () => {
    render(<WalletCard title="Geral" hint="" balance={{ ...comInicio, carryOverCents: 100000 }} month="2026-10-01" />)
    expect(screen.queryByText(/esta carteira começa em/)).not.toBeInTheDocument()
    expect(screen.getByText('saldo que veio dos meses anteriores')).toBeInTheDocument()
  })

  it('sem mês de início nada muda', () => {
    render(<WalletCard title="Geral" hint="" balance={walletBalance('w1', { carryOverCents: 5000 })} month="2026-09-01" />)
    expect(screen.queryByText(/esta carteira começa em/)).not.toBeInTheDocument()
    expect(screen.getByText('saldo que veio dos meses anteriores')).toBeInTheDocument()
  })
})
