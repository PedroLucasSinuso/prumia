import { configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import type { MonthlySummary } from '../api/types'
import { mockApi, ok, me, renderAt, transfer, viewerMe, walletBalance } from '../test/utils'

configure({ asyncUtilTimeout: 5000 })

const summary: MonthlySummary = {
  month: '2026-10-01',
  wallets: [
    walletBalance('w1', { carryOverCents: 100000, receivedIncomeCents: 500000, expectedIncomeCents: 500000, transfersOutCents: 50000, balanceCents: 550000, monthBalanceCents: 450000, projectedCents: 550000 }),
    walletBalance('w2', { transfersInCents: 50000, balanceCents: 50000, monthBalanceCents: 50000, projectedCents: 50000 }),
  ],
  totalPaidCents: 0, totalPendingCents: 0, overdueCents: 0, overdueCount: 0, byCategory: [],
}

const mes = '/resumo?mes=2026-10'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 22, 12))
})
afterEach(() => {
  vi.useRealTimers()
})

async function openPanel() {
  await userEvent.click(await screen.findByRole('button', { name: /Transferir/ }))
  return screen.findByRole('dialog', { name: 'Transferir entre carteiras' })
}

describe('transferir entre carteiras', () => {
  it('o botão abre o painel com De = carteira padrão, Para = outra carteira e a data de hoje', async () => {
    mockApi({ me: ok(me), summary: ok(summary) })
    renderAt(mes)
    const dialog = await openPanel()
    expect(within(dialog).getByRole('combobox', { name: 'De' })).toHaveValue('Geral')
    expect(within(dialog).getByRole('combobox', { name: 'Para' })).toHaveValue('Benefício')
    expect(within(dialog).getByRole('textbox', { name: 'Data' })).toHaveValue('22/10/2026')
  })

  it('salva, avisa com Desfazer e o Desfazer exclui a transferência', async () => {
    mockApi({ me: ok(me), summary: ok(summary) })
    renderAt(mes)
    const dialog = await openPanel()
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Valor' }), '50000')
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Observação/ }), 'guardar o mês')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Transferir' }))

    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/households/{householdId}/transfers', {
        params: { path: { householdId: 'h1' } },
        body: { fromWalletId: 'w1', toWalletId: 'w2', amountCents: 50000, transferDate: '2026-10-22', notes: 'guardar o mês' },
      }),
    )
    expect(await screen.findByText('R$ 500,00 transferidos de Geral para Benefício.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Desfazer' }))
    await waitFor(() =>
      expect(api.DELETE).toHaveBeenCalledWith(
        '/households/{householdId}/transfers/{transferId}',
        expect.objectContaining({ params: { path: { householdId: 'h1', transferId: 't-new' } } }),
      ),
    )
  })

  it('mostra o aviso de saldo negativo da carteira de origem, sem bloquear', async () => {
    mockApi({
      me: ok(me), summary: ok(summary),
      createTransfer: ok({ transfer: transfer({ id: 't9' }), warnings: ['wallet_balance_insufficient'], warningDetails: [{ code: 'wallet_balance_insufficient', walletId: 'w1' }] }),
    })
    renderAt(mes)
    const dialog = await openPanel()
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Valor' }), '100')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Transferir' }))
    expect(await screen.findByText(/Atenção: o saldo dela ficou negativo/)).toBeInTheDocument()
  })

  it('recusa origem igual ao destino e valor zero, sem chamar a API', async () => {
    mockApi({ me: ok(me), summary: ok(summary) })
    renderAt(mes)
    const dialog = await openPanel()
    const para = within(dialog).getByRole('combobox', { name: 'Para' })
    await userEvent.click(para)
    await userEvent.click(await screen.findByRole('option', { name: 'Geral' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Transferir' }))
    expect(await within(dialog).findByText('Escolha uma carteira diferente da origem.')).toBeInTheDocument()
    expect(within(dialog).getByText('Informe um valor maior que zero.')).toBeInTheDocument()
    expect(api.POST).not.toHaveBeenCalledWith('/households/{householdId}/transfers', expect.anything())
  })

  it('mostra o erro do servidor no campo (carteira inválida)', async () => {
    mockApi({
      me: ok(me), summary: ok(summary),
      createTransfer: { error: { title: 'x', status: 400, code: 'validation_error', fields: { toWalletId: 'a carteira está arquivada' } }, response: { ok: false } },
    })
    renderAt(mes)
    const dialog = await openPanel()
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Valor' }), '100')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Transferir' }))
    expect(await within(dialog).findByText('a carteira está arquivada')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Transferir entre carteiras' })).toBeInTheDocument()
  })
})

describe('transferências do mês', () => {
  it('sem transferências mostra uma frase', async () => {
    mockApi({ me: ok(me), summary: ok(summary) })
    renderAt(mes)
    const sec = await screen.findByRole('region', { name: 'Transferências do mês' })
    expect(within(sec).getByText('Nenhuma transferência entre carteiras neste mês.')).toBeInTheDocument()
  })

  it('lista data, De → Para, valor e observação; excluir tem Desfazer que restaura', async () => {
    mockApi({ me: ok(me), summary: ok(summary), transfers: ok([transfer({ id: 't1', notes: 'reserva do mês' })]) })
    renderAt(mes)
    const sec = await screen.findByRole('region', { name: 'Transferências do mês' })
    expect(await within(sec).findByText('Geral → Benefício')).toBeInTheDocument()
    expect(within(sec).getByText('12/10')).toBeInTheDocument()
    expect(within(sec).getByText('R$ 500,00')).toBeInTheDocument()
    expect(within(sec).getByText('reserva do mês')).toBeInTheDocument()

    await userEvent.click(within(sec).getByRole('button', { name: 'Excluir transferência Geral → Benefício' }))
    await waitFor(() =>
      expect(api.DELETE).toHaveBeenCalledWith(
        '/households/{householdId}/transfers/{transferId}',
        expect.objectContaining({ params: { path: { householdId: 'h1', transferId: 't1' } } }),
      ),
    )
    expect(await screen.findByText('Transferência excluída.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Desfazer' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        '/households/{householdId}/transfers/{transferId}/restore',
        expect.objectContaining({ params: { path: { householdId: 'h1', transferId: 't1' } } }),
      ),
    )
  })

  it('quem só lê não vê Transferir nem Excluir', async () => {
    mockApi({ me: ok(viewerMe), summary: ok(summary), transfers: ok([transfer({ id: 't1' })]) })
    renderAt(mes)
    const sec = await screen.findByRole('region', { name: 'Transferências do mês' })
    expect(await within(sec).findByText('Geral → Benefício')).toBeInTheDocument()
    expect(within(sec).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Transferir/ })).not.toBeInTheDocument()
  })
})

describe('carteira com transferências', () => {
  it('mostra recebidas e enviadas só quando diferentes de zero, e a fórmula do "hoje"', async () => {
    mockApi({ me: ok(me), summary: ok(summary) })
    renderAt(mes)
    const geral = await screen.findByRole('region', { name: 'Geral' })
    expect(within(geral).getByText('transferências enviadas')).toBeInTheDocument()
    expect(within(geral).queryByText('transferências recebidas')).not.toBeInTheDocument()
    expect(within(geral).getByText(/saldo anterior \+ recebido − pago ± transferências/)).toBeInTheDocument()
    const ben = screen.getByRole('region', { name: 'Benefício' })
    expect(within(ben).getByText('transferências recebidas')).toBeInTheDocument()
    expect(within(ben).queryByText('transferências enviadas')).not.toBeInTheDocument()
  })
})
