import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import { fail, invoice, mockApi, ok, me, renderAt, viewerMe } from '../test/utils'

const aluguel = invoice({ id: 'i1', description: 'Aluguel', amountCents: 150000, dueDate: '2026-10-05', status: 'overdue' })
const luz = invoice({ id: 'i2', description: 'Luz', amountCents: 20000, dueDate: '2026-10-25', status: 'pending' })
const feira = invoice({
  id: 'i3', description: 'Feira', categoryId: 'c2', amountCents: 32000, dueDate: '2026-10-12', status: 'paid',
  paid: { paidAt: '2026-10-12', wallet: 'benefit', amountCents: 30000 },
})
const mes = '/?mes=2026-10'

const withInvoices = () => mockApi({ me: ok(me), invoices: ok({ items: [aluguel, feira, luz] }) })

// "Hoje" fixo (20/10/2026): decide se o mês exibido é o atual (separador "hoje") e quantos dias de atraso aparecem.
// Só o Date é falsificado; os timers continuam reais (o Testing Library depende deles).
beforeEach(() => {
  vi.restoreAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 20, 12))
})
afterEach(() => {
  vi.useRealTimers()
  // @ts-expect-error: remove o matchMedia simulado pelos testes de computador
  delete window.matchMedia
})

function mockDesktop() {
  window.matchMedia = ((query: string) => ({
    matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {},
  })) as never
}

describe('visão do mês', () => {
  it('mostra o que falta pagar, o medidor e o total', async () => {
    withInvoices()
    renderAt(mes)
    expect(await screen.findByRole('heading', { name: 'outubro de 2026' })).toBeInTheDocument()
    // a pagar = atrasada + a vencer (R$ 1.500 + R$ 200)
    expect(await screen.findByText('R$ 1.700,00')).toBeInTheDocument()
    // medidor: pago por valor = 32.000 de 202.000 = 16%
    expect(screen.getByRole('img', { name: /16% do valor do mês já foi pago/ })).toBeInTheDocument()
    // pago usa o valor efetivamente pago (R$ 300, e não os R$ 320 da conta)
    expect(screen.getByText('R$ 300,00')).toBeInTheDocument()
  })

  it('lista as contas por data, com o separador "hoje" entre as vencidas e as futuras', async () => {
    withInvoices()
    renderAt(mes)
    const hoje = await screen.findByText(/HOJE · 20\/10/)
    const antes = screen.getByRole('button', { name: 'Detalhes de Aluguel' })
    const depois = screen.getByRole('button', { name: 'Detalhes de Luz' })
    expect(antes.compareDocumentPosition(hoje) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(hoje.compareDocumentPosition(depois) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('diz há quantos dias a conta está atrasada', async () => {
    withInvoices()
    renderAt(mes)
    expect(await screen.findByText(/atrasada 15 dias/)).toBeInTheDocument()
  })

  it('conta paga continua na lista, riscada, com a carteira usada', async () => {
    withInvoices()
    renderAt(mes)
    expect(await screen.findByText('Feira')).toHaveClass('line-through')
    expect(screen.getByText(/paga na carteira benefício/)).toBeInTheDocument()
  })

  it('o filtro mostra só o que falta pagar, ou só as pagas', async () => {
    withInvoices()
    renderAt(mes)
    await screen.findByText('Feira')
    await userEvent.click(screen.getByRole('button', { name: /A pagar/ }))
    expect(screen.queryByText('Feira')).not.toBeInTheDocument()
    expect(screen.getByText('Aluguel')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /A pagar/ })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: /Pagas/ }))
    expect(screen.getByText('Feira')).toBeInTheDocument()
    expect(screen.queryByText('Aluguel')).not.toBeInTheDocument()
  })

  it('em outro mês não há separador "hoje"', async () => {
    mockApi({ me: ok(me), invoices: ok({ items: [invoice({ id: 'x', description: 'Seguro', dueDate: '2026-11-10' })] }) })
    renderAt('/?mes=2026-11')
    await screen.findByText('Seguro')
    expect(screen.queryByText(/HOJE/)).not.toBeInTheDocument()
  })

  it('a régua resume o dia mais pesado para leitores de tela', async () => {
    withInvoices()
    renderAt(mes)
    expect(await screen.findByRole('img', { name: /Régua do mês\. O dia mais pesado é 05, com R\$ 1\.500,00/ })).toBeInTheDocument()
  })

  it('consulta o mês pedido na URL e navega para o próximo', async () => {
    withInvoices()
    renderAt('/?mes=2027-03')
    expect(await screen.findByRole('heading', { name: 'março de 2027' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Próximo mês' }))
    expect(await screen.findByRole('heading', { name: 'abril de 2027' })).toBeInTheDocument()
    await waitFor(() =>
      expect(api.GET).toHaveBeenCalledWith(
        '/households/{householdId}/invoices',
        expect.objectContaining({ params: expect.objectContaining({ query: expect.objectContaining({ month: '2027-04-01' }) }) }),
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
      expect(api.POST).toHaveBeenCalledWith('/households/{householdId}/invoices/{invoiceId}/pay', expect.objectContaining({ body: { wallet: 'benefit' } })),
    )
    expect(await screen.findByText(/paga na carteira de benefício/)).toBeInTheDocument()
  })

  it('avisa, sem bloquear, quando o saldo de benefício do mês fica negativo', async () => {
    mockApi({
      me: ok(me),
      invoices: ok({ items: [invoice({ id: 'i9', description: 'Mercado', categoryId: 'c2' })] }),
      pay: ok({ invoice: {}, warnings: ['benefit_balance_insufficient'] }),
    })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Pagar Mercado' }))
    expect(await screen.findByText(/Atenção: o saldo de benefício deste mês ficou negativo/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desfazer' })).toBeInTheDocument() // o pagamento foi feito e pode ser desfeito
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

  it('tocar no nó de uma conta paga desfaz o pagamento', async () => {
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

describe('nova conta e edição (celular: painel que sobe)', () => {
  const abrir = async () => userEvent.click(await screen.findByRole('button', { name: 'Nova conta' }))

  it('cria uma conta com poucos campos', async () => {
    mockApi({ me: ok(me), create: ok(invoice({ id: 'novo', description: 'Internet' })) })
    renderAt('/?mes=2026-05') // mês passado: o vencimento padrão é o dia 1 (no mês atual seria hoje)
    await abrir()
    await userEvent.type(screen.getByLabelText('Descrição'), 'Internet')
    await userEvent.type(screen.getByLabelText('Valor'), '9990')
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar conta' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        '/households/{householdId}/invoices',
        expect.objectContaining({ body: { description: 'Internet', amountCents: 9990, dueDate: '2026-05-01', categoryId: 'c1' } }),
      ),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  describe('subcategorias', () => {
    const subcats = [
      { id: 'c1', name: 'Moradia', isEssential: true, sortOrder: 0, archived: false },
      { id: 'c2', name: 'Mercado', defaultWallet: 'benefit' as const, isEssential: true, sortOrder: 1, archived: false },
      { id: 'g1', name: 'Gás', isEssential: true, sortOrder: 0, archived: false, parentId: 'c1' },
      { id: 'l1', name: 'Luz', isEssential: true, sortOrder: 1, archived: false, parentId: 'c1' },
    ]

    it('sem subcategorias nada muda: uma linha só de botões', async () => {
      mockApi({ me: ok(me) })
      renderAt('/?mes=2026-05')
      await abrir()
      expect(screen.queryByRole('group', { name: /Detalhe de/ })).not.toBeInTheDocument()
    })

    it('tocar numa categoria com filhas abre a 2ª linha; escolher a filha manda a filha; "geral" volta para a mãe', async () => {
      mockApi({ me: ok(me), categories: ok(subcats), create: ok(invoice({ id: 'novo', description: 'Gás' })) })
      renderAt('/?mes=2026-05')
      await abrir()
      // abre já com a 1ª categoria (Moradia): a 2ª linha aparece com geral · Gás · Luz
      const detalhe = screen.getByRole('group', { name: 'Detalhe de Moradia' })
      expect(within(detalhe).getByRole('button', { name: 'geral' })).toHaveAttribute('aria-pressed', 'true')
      await userEvent.click(within(detalhe).getByRole('button', { name: 'Gás' }))
      expect(within(detalhe).getByRole('button', { name: 'Gás' })).toHaveAttribute('aria-pressed', 'true')
      // a mãe continua marcada na 1ª linha
      expect(screen.getByRole('button', { name: 'Moradia' })).toHaveAttribute('aria-pressed', 'true')
      await userEvent.type(screen.getByRole('textbox', { name: /O que é|Descrição/ }), 'Gás')
      await userEvent.type(screen.getByLabelText('Valor'), '15000')
      await userEvent.click(screen.getByRole('button', { name: 'Adicionar conta' }))
      await waitFor(() =>
        expect(api.POST).toHaveBeenCalledWith('/households/{householdId}/invoices', expect.objectContaining({ body: expect.objectContaining({ categoryId: 'g1' }) })),
      )
    })

    it('trocar para outra categoria esconde a 2ª linha', async () => {
      mockApi({ me: ok(me), categories: ok(subcats) })
      renderAt('/?mes=2026-05')
      await abrir()
      await userEvent.click(screen.getByRole('button', { name: /Mercado/ }))
      expect(screen.queryByRole('group', { name: /Detalhe de/ })).not.toBeInTheDocument()
    })

    it('ao editar, a conta numa subcategoria mostra mãe e filha marcadas', async () => {
      const gas = invoice({ id: 'ig', description: 'Gás', amountCents: 15000, categoryId: 'g1', dueDate: '2026-10-12', status: 'pending' })
      mockApi({ me: ok(me), categories: ok(subcats), invoices: ok({ items: [gas] }) })
      renderAt(mes)
      await userEvent.click(await screen.findByRole('button', { name: 'Detalhes de Gás' }))
      const detalhe = await screen.findByRole('group', { name: 'Detalhe de Moradia' })
      expect(within(detalhe).getByRole('button', { name: 'Gás' })).toHaveAttribute('aria-pressed', 'true')
    })

    it('"Por categoria" soma as filhas na mãe', async () => {
      mockDesktop()
      const gas = invoice({ id: 'ig', description: 'Gás', amountCents: 15000, categoryId: 'g1', dueDate: '2026-10-12', status: 'pending' })
      const luz2 = invoice({ id: 'il', description: 'Luz', amountCents: 9000, categoryId: 'l1', dueDate: '2026-10-15', status: 'pending' })
      mockApi({ me: ok(me), categories: ok(subcats), invoices: ok({ items: [gas, luz2] }) })
      renderAt(mes)
      const bloco = await screen.findByRole('region', { name: 'Por categoria' })
      expect(await within(bloco).findByText('R$ 240,00')).toBeInTheDocument()
      expect(within(bloco).getByRole('list', { name: 'Detalhe de Moradia' })).toBeInTheDocument()
    })
  })

  it('escolher o favorecido preenche o nome e a categoria sugerida e vai junto ao salvar', async () => {
    const payees = [
      { id: 'p1', name: 'Gás', defaultCategoryId: 'c2', archived: false },
      { id: 'p2', name: 'Antigo', archived: true },
    ]
    mockApi({ me: ok(me), payees: ok(payees), create: ok(invoice({ id: 'novo', description: 'Gás' })) })
    renderAt('/?mes=2026-05')
    await abrir()
    await userEvent.click(screen.getByText('Mais opções'))
    const select = screen.getByLabelText('Favorecido (opcional)')
    expect(within(select).queryByRole('option', { name: 'Antigo' })).not.toBeInTheDocument()
    await userEvent.selectOptions(select, 'p1')
    expect(screen.getByLabelText('Descrição')).toHaveValue('Gás')
    expect(screen.getByRole('button', { name: /Mercado/ })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.type(screen.getByLabelText('Valor'), '12345')
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar conta' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        '/households/{householdId}/invoices',
        expect.objectContaining({ body: { description: 'Gás', amountCents: 12345, dueDate: '2026-05-01', categoryId: 'c2', payeeId: 'p1' } }),
      ),
    )
  })

  it('no mês atual o vencimento é escolhido por botões (hoje é o padrão)', async () => {
    mockApi({ me: ok(me), create: ok(invoice({ id: 'novo', description: 'Luz' })) })
    renderAt(mes)
    await abrir()
    expect(screen.getByRole('button', { name: /hoje · 20\/10/ })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: /amanhã · 21\/10/ }))
    expect(screen.getByRole('button', { name: /amanhã · 21\/10/ })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.type(screen.getByLabelText('Descrição'), 'Luz')
    await userEvent.type(screen.getByLabelText('Valor'), '100')
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar conta' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/households/{householdId}/invoices', expect.objectContaining({ body: expect.objectContaining({ dueDate: '2026-10-21' }) })),
    )
  })

  it('"outra data" mostra o campo de data', async () => {
    mockApi({ me: ok(me) })
    renderAt(mes)
    await abrir()
    await userEvent.click(screen.getByRole('button', { name: 'outra data' }))
    expect(screen.getByLabelText('Data de vencimento')).toHaveValue('2026-10-20')
  })

  it('a categoria é escolhida por botões, e Mercado mostra a marca de benefício', async () => {
    mockApi({ me: ok(me), create: ok(invoice({ id: 'n', description: 'Feira' })) })
    renderAt(mes)
    await abrir()
    expect(screen.getByRole('button', { name: 'Moradia' })).toHaveAttribute('aria-pressed', 'true')
    const mercado = screen.getByRole('button', { name: /Mercado/ })
    expect(within(mercado).getByText('VR')).toBeInTheDocument()
    await userEvent.click(mercado)
    expect(mercado).toHaveAttribute('aria-pressed', 'true')
    await userEvent.type(screen.getByLabelText('Descrição'), 'Feira')
    await userEvent.type(screen.getByLabelText('Valor'), '5000')
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar conta' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/households/{householdId}/invoices', expect.objectContaining({ body: expect.objectContaining({ categoryId: 'c2' }) })),
    )
  })

  it('"Adicionar e lançar outra" salva e mantém o painel aberto, vazio e com o foco na descrição', async () => {
    mockApi({ me: ok(me), create: ok(invoice({ id: 'n', description: 'Água' })) })
    renderAt(mes)
    await abrir()
    await userEvent.type(screen.getByLabelText('Descrição'), 'Água')
    await userEvent.type(screen.getByLabelText('Valor'), '4500')
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar e lançar outra' }))
    await waitFor(() => expect(api.POST).toHaveBeenCalledWith('/households/{householdId}/invoices', expect.anything()))
    await waitFor(() => expect(screen.getByLabelText('Descrição')).toHaveValue(''))
    expect(screen.getByLabelText('Descrição')).toHaveFocus()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('o botão só habilita com descrição e valor', async () => {
    mockApi({ me: ok(me) })
    renderAt(mes)
    await abrir()
    expect(screen.getByRole('button', { name: 'Adicionar conta' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Descrição'), 'X')
    expect(screen.getByRole('button', { name: 'Adicionar conta' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Valor'), '1')
    expect(screen.getByRole('button', { name: 'Adicionar conta' })).toBeEnabled()
  })

  it('mostra o erro de validação no campo e mantém o painel aberto', async () => {
    mockApi({ me: ok(me), create: fail(400, 'validation_error', { amountCents: 'informe um valor maior que zero' }) })
    renderAt(mes)
    await abrir()
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
    await abrir()
    const valor = screen.getByLabelText('Valor')
    await userEvent.type(valor, '150000')
    expect(valor).toHaveValue('R$ 1.500,00')
  })

  it('edita uma conta: carrega os dados e envia o que a tela controla', async () => {
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
          params: { path: { householdId: 'h1', invoiceId: 'i2' }, query: { scope: 'this' } },
          body: expect.objectContaining({ description: 'Luz (nov)', amountCents: 20000, notes: null }),
        }),
      ),
    )
  })

  it('"Marcar como paga" nos detalhes paga com a carteira da categoria e fecha o painel', async () => {
    withInvoices()
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Detalhes de Luz' }))
    await userEvent.click(screen.getByRole('button', { name: /Marcar como paga · carteira livre/ }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/households/{householdId}/invoices/{invoiceId}/pay', expect.objectContaining({ body: { wallet: 'free' } })),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
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
        expect.objectContaining({ params: { path: { householdId: 'h1', invoiceId: 'i2' }, query: { scope: 'this' } } }),
      ),
    )
  })

  it('Esc fecha o painel', async () => {
    mockApi({ me: ok(me) })
    renderAt(mes)
    await abrir()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('computador: detalhe ao lado da lista', () => {
  it('abrir uma conta mostra o detalhe no painel lateral, sem janela por cima', async () => {
    mockDesktop()
    withInvoices()
    renderAt(mes)
    expect(await screen.findByText(/Toque numa conta para ver os detalhes/)).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Detalhes de Luz' }))
    const painel = await screen.findByRole('region', { name: 'Detalhes da conta' })
    expect(within(painel).getByLabelText('Descrição')).toHaveValue('Luz')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('"Nova conta" fica no cabeçalho (sem botão flutuante) e abre o formulário ao lado', async () => {
    mockDesktop()
    mockApi({ me: ok(me) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: /Nova conta/ }))
    const painel = await screen.findByRole('region', { name: 'Detalhes da conta' })
    expect(within(painel).getByRole('heading', { name: 'Nova conta' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('mostra o total por categoria e os três números do mês', async () => {
    mockDesktop()
    withInvoices()
    renderAt(mes)
    const bloco = await screen.findByRole('region', { name: 'Por categoria' })
    expect(within(bloco).getByText('Moradia')).toBeInTheDocument()
    expect(screen.getByText(/1 conta atrasada/)).toBeInTheDocument()
  })
})

describe('papel viewer', () => {
  it('só lê: sem botão de nova conta e sem pagar', async () => {
    mockApi({ me: ok(viewerMe), invoices: ok({ items: [luz] }) })
    renderAt(mes)
    expect(await screen.findByText('Luz')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nova conta' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pagar Luz' })).toBeDisabled()
  })
})
