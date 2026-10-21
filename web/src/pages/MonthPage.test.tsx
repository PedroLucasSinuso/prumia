import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import { fail, invoice, mockApi, ok, me, renderAt, viewerMe } from '../test/utils'

const aluguel = invoice({ id: 'i1', description: 'Aluguel', amountCents: 150000, dueDate: '2026-10-05', status: 'overdue' })
const luz = invoice({ id: 'i2', description: 'Luz', amountCents: 20000, dueDate: '2026-10-25', status: 'pending' })
const feira = invoice({
  id: 'i3', description: 'Feira', categoryId: 'c2', amountCents: 32000, dueDate: '2026-10-12', status: 'paid',
  paid: { paidAt: '2026-10-12', wallet: 'benefit', amountCents: 30000 },
})
const mes = '/?mes=2026-10'

const withInvoices = () => mockApi({ me: ok(me), invoices: ok({ items: [aluguel, luz, feira] }) })

describe('visão do mês', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('agrupa em atrasadas, a vencer e pagas, com os totais do mês', async () => {
    withInvoices()
    renderAt(mes)
    expect(await screen.findByRole('heading', { name: 'outubro de 2026' })).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Atrasadas' })).toHaveTextContent('Atrasadas · 1')
    expect(screen.getByRole('region', { name: 'A vencer' })).toHaveTextContent('A vencer · 1')
    expect(screen.getByRole('region', { name: 'Pagas' })).toHaveTextContent('Pagas · 1')
    // a pagar = atrasada + a vencer (R$ 1.500 + R$ 200); pago usa o valor efetivamente pago (R$ 300, não R$ 320)
    expect(screen.getByText('R$ 1.700,00')).toBeInTheDocument()
    expect(screen.getByText('R$ 300,00', { selector: 'p' })).toBeInTheDocument()
  })

  it('conta paga continua na lista, riscada', async () => {
    withInvoices()
    renderAt(mes)
    const pagas = await screen.findByRole('region', { name: 'Pagas' })
    expect(within(pagas).getByText('Feira')).toHaveClass('line-through')
    expect(within(pagas).getByText(/benefício/)).toBeInTheDocument()
  })

  it('consulta o mês pedido na URL', async () => {
    withInvoices()
    renderAt('/?mes=2027-03')
    expect(await screen.findByRole('heading', { name: 'março de 2027' })).toBeInTheDocument()
    await waitFor(() =>
      expect(api.GET).toHaveBeenCalledWith(
        '/households/{householdId}/invoices',
        expect.objectContaining({ params: expect.objectContaining({ query: expect.objectContaining({ month: '2027-03-01' }) }) }),
      ),
    )
  })

  it('navega para o próximo mês', async () => {
    withInvoices()
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Próximo mês' }))
    expect(await screen.findByRole('heading', { name: 'novembro de 2026' })).toBeInTheDocument()
    await waitFor(() =>
      expect(api.GET).toHaveBeenCalledWith(
        '/households/{householdId}/invoices',
        expect.objectContaining({ params: expect.objectContaining({ query: expect.objectContaining({ month: '2026-11-01' }) }) }),
      ),
    )
  })

  it('mostra o estado vazio', async () => {
    mockApi({ me: ok(me) })
    renderAt(mes)
    expect(await screen.findByText(/Nenhuma conta neste mês/)).toBeInTheDocument()
  })

  it('erro ao carregar oferece tentar de novo', async () => {
    mockApi({ me: ok(me), invoices: fail(500, 'internal_error') })
    renderAt(mes)
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar as contas')
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument()
  })
})

describe('pagar', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('um toque paga com a carteira livre quando a categoria não sugere nenhuma', async () => {
    withInvoices()
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Pagar Luz' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        '/households/{householdId}/invoices/{invoiceId}/pay',
        expect.objectContaining({ body: { wallet: 'free' }, params: { path: { householdId: 'h1', invoiceId: 'i2' } } }),
      ),
    )
    expect(await screen.findByText(/Luz paga na carteira livre/)).toBeInTheDocument()
  })

  it('usa a carteira sugerida pela categoria (Mercado -> benefício)', async () => {
    mockApi({ me: ok(me), invoices: ok({ items: [invoice({ id: 'i9', description: 'Compras da semana', categoryId: 'c2' })] }) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Pagar Compras da semana' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        '/households/{householdId}/invoices/{invoiceId}/pay',
        expect.objectContaining({ body: { wallet: 'benefit' } }),
      ),
    )
    expect(await screen.findByText(/paga na carteira de benefício/)).toBeInTheDocument()
  })

  it('"Desfazer" no aviso desfaz o pagamento', async () => {
    withInvoices()
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Pagar Luz' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Desfazer' }))
    await waitFor(() =>
      expect(api.DELETE).toHaveBeenCalledWith(
        '/households/{householdId}/invoices/{invoiceId}/pay',
        expect.objectContaining({ params: { path: { householdId: 'h1', invoiceId: 'i2' } } }),
      ),
    )
  })

  it('tocar no marcador de uma conta paga desfaz o pagamento', async () => {
    withInvoices()
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Desfazer pagamento de Feira' }))
    await waitFor(() => expect(api.DELETE).toHaveBeenCalled())
  })

  it('falha ao pagar avisa a pessoa', async () => {
    mockApi({ me: ok(me), invoices: ok({ items: [luz] }), pay: fail(409, 'already_paid') })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Pagar Luz' }))
    expect(await screen.findByText(/Não foi possível marcar como paga/)).toBeInTheDocument()
  })
})

describe('nova conta e edição', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('cria uma conta com poucos campos', async () => {
    mockApi({ me: ok(me), create: ok(invoice({ id: 'novo', description: 'Internet' })) })
    renderAt('/?mes=2026-05') // mês passado: o vencimento padrão é o dia 1 (no mês atual seria hoje)
    await userEvent.click(await screen.findByRole('button', { name: 'Nova conta' }))
    await userEvent.type(screen.getByLabelText('Descrição'), 'Internet')
    await userEvent.type(screen.getByLabelText('Valor'), '9990')
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar conta' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        '/households/{householdId}/invoices',
        expect.objectContaining({
          body: { description: 'Internet', amountCents: 9990, dueDate: '2026-05-01', categoryId: 'c1' },
        }),
      ),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('o botão só habilita com descrição e valor', async () => {
    mockApi({ me: ok(me) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Nova conta' }))
    expect(screen.getByRole('button', { name: 'Adicionar conta' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Descrição'), 'X')
    expect(screen.getByRole('button', { name: 'Adicionar conta' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Valor'), '1')
    expect(screen.getByRole('button', { name: 'Adicionar conta' })).toBeEnabled()
  })

  it('mostra o erro de validação no campo e mantém o painel aberto', async () => {
    mockApi({ me: ok(me), create: fail(400, 'validation_error', { amountCents: 'informe um valor maior que zero' }) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Nova conta' }))
    await userEvent.type(screen.getByLabelText('Descrição'), 'Algo')
    await userEvent.type(screen.getByLabelText('Valor'), '5')
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar conta' }))
    expect(await screen.findByText('informe um valor maior que zero')).toBeInTheDocument()
    expect(screen.getByLabelText('Valor')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('o campo de valor vai se formando em reais', async () => {
    mockApi({ me: ok(me) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Nova conta' }))
    const valor = screen.getByLabelText('Valor')
    await userEvent.type(valor, '150000')
    expect(valor).toHaveValue('R$ 1.500,00')
  })

  it('edita uma conta: carrega os dados e envia só o que a tela controla', async () => {
    withInvoices()
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Detalhes de Luz' }))
    expect(screen.getByLabelText('Descrição')).toHaveValue('Luz')
    expect(screen.getByLabelText('Valor')).toHaveValue('R$ 200,00')
    await userEvent.clear(screen.getByLabelText('Descrição'))
    await userEvent.type(screen.getByLabelText('Descrição'), 'Luz (nov)')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() =>
      expect(api.PATCH).toHaveBeenCalledWith(
        '/households/{householdId}/invoices/{invoiceId}',
        expect.objectContaining({
          params: { path: { householdId: 'h1', invoiceId: 'i2' } },
          body: expect.objectContaining({ description: 'Luz (nov)', amountCents: 20000, notes: null }),
        }),
      ),
    )
  })

  it('exclui com aviso e permite desfazer', async () => {
    withInvoices()
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Detalhes de Luz' }))
    await userEvent.click(screen.getByRole('button', { name: 'Excluir conta' }))
    expect(await screen.findByText(/Luz excluída/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Desfazer' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        '/households/{householdId}/invoices/{invoiceId}/restore',
        expect.objectContaining({ params: { path: { householdId: 'h1', invoiceId: 'i2' } } }),
      ),
    )
  })

  it('Esc fecha o painel', async () => {
    mockApi({ me: ok(me) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Nova conta' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('papel viewer', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('só lê: sem botão de nova conta e sem pagar', async () => {
    mockApi({ me: ok(viewerMe), invoices: ok({ items: [luz] }) })
    renderAt(mes)
    expect(await screen.findByText('Luz')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nova conta' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pagar Luz' })).toBeDisabled()
  })
})
