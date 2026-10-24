import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import { fail, invoice, mockApi, ok, me, renderAt, viewerMe } from '../test/utils'

const aluguel = invoice({ id: 'i1', description: 'Aluguel', amountCents: 150000, dueDate: '2026-10-05', status: 'overdue' })
const luz = invoice({ id: 'i2', description: 'Luz', amountCents: 20000, dueDate: '2026-10-25', status: 'pending' })
const feira = invoice({
  id: 'i3', description: 'Feira', categoryId: 'c2', amountCents: 32000, dueDate: '2026-10-12', status: 'paid',
  paid: { paidAt: '2026-10-12', walletId: 'w2', amountCents: 30000 },
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

/** Computador com mouse: telas largas casam; ponteiro de toque e movimento reduzido, não. */
function mockDesktop() {
  window.matchMedia = ((query: string) => ({
    matches: !/pointer: coarse|reduced-motion/.test(query), media: query, addEventListener: () => {}, removeEventListener: () => {},
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
    expect(screen.getByText(/paga na carteira Benefício/)).toBeInTheDocument()
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
        expect.objectContaining({ body: { walletId: 'w1' }, params: { path: { householdId: 'h1', invoiceId: 'i2' } } }),
      ),
    )
    expect(await screen.findByText(/Luz paga na carteira Geral/)).toBeInTheDocument()
  })

  it('usa a carteira sugerida pela categoria (Mercado -> Benefício)', async () => {
    mockApi({ me: ok(me), invoices: ok({ items: [invoice({ id: 'i9', description: 'Compras da semana', categoryId: 'c2' })] }) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Pagar Compras da semana' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/households/{householdId}/invoices/{invoiceId}/pay', expect.objectContaining({ body: { walletId: 'w2' } })),
    )
    expect(await screen.findByText(/paga na carteira Benefício/)).toBeInTheDocument()
  })

  it('avisa, sem bloquear, quando o saldo de benefício do mês fica negativo', async () => {
    mockApi({
      me: ok(me),
      invoices: ok({ items: [invoice({ id: 'i9', description: 'Mercado', categoryId: 'c2' })] }),
      pay: ok({ invoice: {}, warnings: ['wallet_balance_insufficient'] }),
    })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Pagar Mercado' }))
    expect(await screen.findByText(/Atenção: o saldo dela ficou negativo/)).toBeInTheDocument()
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
      { id: 'c2', name: 'Mercado', defaultWalletId: 'w2', isEssential: true, sortOrder: 1, archived: false },
      { id: 'g1', name: 'Gás', isEssential: true, sortOrder: 0, archived: false, parentId: 'c1' },
      { id: 'l1', name: 'Luz', isEssential: true, sortOrder: 1, archived: false, parentId: 'c1' },
    ]

    it('sem subcategorias a lista do combobox tem só as categorias principais', async () => {
      mockApi({ me: ok(me) })
      renderAt('/?mes=2026-05')
      await abrir()
      await userEvent.click(screen.getByRole('combobox', { name: 'Categoria' }))
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Moradia', 'MercadoBenefício', 'Nova categoria'])
    })

    it('o combobox agrupa "Mãe › filha"; escolher a filha manda a filha e a mãe continua escolhível', async () => {
      mockApi({ me: ok(me), categories: ok(subcats), create: ok(invoice({ id: 'novo', description: 'Gás' })) })
      renderAt('/?mes=2026-05')
      await abrir()
      // abre já com a 1ª categoria (Moradia); a lista traz Moradia, Moradia › Gás, Moradia › Luz e Mercado
      const combo = screen.getByRole('combobox', { name: 'Categoria' })
      expect(combo).toHaveValue('Moradia')
      await userEvent.click(combo)
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Moradia', 'Moradia › Gás', 'Moradia › Luz', 'MercadoBenefício', 'Nova categoria'])
      await userEvent.click(screen.getByRole('option', { name: 'Moradia › Gás' }))
      expect(combo).toHaveValue('Moradia › Gás')
      await userEvent.type(screen.getByRole('textbox', { name: /O que é|Descrição/ }), 'Gás')
      await userEvent.type(screen.getByLabelText('Valor'), '15000')
      await userEvent.click(screen.getByRole('button', { name: 'Adicionar conta' }))
      await waitFor(() =>
        expect(api.POST).toHaveBeenCalledWith('/households/{householdId}/invoices', expect.objectContaining({ body: expect.objectContaining({ categoryId: 'g1' }) })),
      )
    })

    it('digitar filtra a lista (sem acento) e Enter escolhe a primeira', async () => {
      mockApi({ me: ok(me), categories: ok(subcats) })
      renderAt('/?mes=2026-05')
      await abrir()
      await userEvent.type(screen.getByRole('combobox', { name: 'Categoria' }), 'gas{Enter}')
      expect(screen.getByRole('combobox', { name: 'Categoria' })).toHaveValue('Moradia › Gás')
    })

    it('ao editar, a conta numa subcategoria mostra mãe e filha marcadas', async () => {
      const gas = invoice({ id: 'ig', description: 'Gás', amountCents: 15000, categoryId: 'g1', dueDate: '2026-10-12', status: 'pending' })
      mockApi({ me: ok(me), categories: ok(subcats), invoices: ok({ items: [gas] }) })
      renderAt(mes)
      await userEvent.click(await screen.findByRole('button', { name: 'Detalhes de Gás' }))
      await userEvent.click(screen.getByRole('button', { name: 'Editar' }))
      expect(await screen.findByRole('combobox', { name: 'Categoria' })).toHaveValue('Moradia › Gás')
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
    await userEvent.click(screen.getByRole('combobox', { name: 'Favorecido (opcional)' }))
    expect(screen.queryByRole('option', { name: 'Antigo' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('option', { name: 'Gás' }))
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
    expect(screen.getByRole('radio', { name: 'Hoje, 20/10' })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: 'Amanhã, 21/10' }))
    expect(screen.getByRole('radio', { name: 'Amanhã, 21/10' })).toBeChecked()
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
    await userEvent.click(screen.getByRole('radio', { name: 'Outra data' }))
    expect(screen.getByLabelText('Data de vencimento')).toHaveValue('20/10/2026')
  })

  it('a categoria é escolhida por botões, e Mercado mostra a marca de benefício', async () => {
    mockApi({ me: ok(me), create: ok(invoice({ id: 'n', description: 'Feira' })) })
    renderAt(mes)
    await abrir()
    expect(screen.getByRole('button', { name: 'Moradia' })).toHaveAttribute('aria-pressed', 'true')
    const mercado = screen.getByRole('button', { name: /Mercado/ })
    expect(within(mercado).getByText('Benefício')).toBeInTheDocument()
    await userEvent.click(mercado)
    expect(mercado).toHaveAttribute('aria-pressed', 'true')
    await userEvent.type(screen.getByLabelText('Descrição'), 'Feira')
    await userEvent.type(screen.getByLabelText('Valor'), '5000')
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar conta' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/households/{householdId}/invoices', expect.objectContaining({ body: expect.objectContaining({ categoryId: 'c2' }) })),
    )
  })

  it('lembra as categorias usadas por casa: a mais recente vira o 1º atalho', async () => {
    mockApi({ me: ok(me), create: ok(invoice({ id: 'n', description: 'Feira' })) })
    renderAt(mes)
    await abrir()
    expect(screen.getByRole('group', { name: 'Categorias recentes' })).toHaveTextContent('MoradiaMercadoBenefício')
    await userEvent.click(screen.getByRole('button', { name: /Mercado/ }))
    await userEvent.type(screen.getByLabelText('Descrição'), 'Feira')
    await userEvent.type(screen.getByLabelText('Valor'), '5000')
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar conta' }))
    await waitFor(() => expect(window.localStorage.getItem('prumia.categoriasRecentes.h1')).toBe('["c2"]'))
    await abrir()
    expect(screen.getByRole('group', { name: 'Categorias recentes' })).toHaveTextContent('MercadoBenefícioMoradia')
    window.localStorage.removeItem('prumia.categoriasRecentes.h1')
  })

  it('"Adicionar e lançar outra" salva e mantém o painel aberto, vazio e com o foco no valor', async () => {
    mockApi({ me: ok(me), create: ok(invoice({ id: 'n', description: 'Água' })) })
    renderAt(mes)
    await abrir()
    await userEvent.type(screen.getByLabelText('Descrição'), 'Água')
    await userEvent.type(screen.getByLabelText('Valor'), '4500')
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar e lançar outra' }))
    await waitFor(() => expect(api.POST).toHaveBeenCalledWith('/households/{householdId}/invoices', expect.anything()))
    await waitFor(() => expect(screen.getByLabelText('Descrição')).toHaveValue(''))
    expect(screen.getByLabelText('Valor')).toHaveFocus()
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
    await userEvent.click(screen.getByRole('button', { name: 'Editar' }))
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

  it('"Pagar" nos detalhes paga com a carteira da categoria e fecha o painel', async () => {
    withInvoices()
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Detalhes de Luz' }))
    await userEvent.click(screen.getByRole('button', { name: /Pagar · carteira Geral/ }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/households/{householdId}/invoices/{invoiceId}/pay', expect.objectContaining({ body: { walletId: 'w1' } })),
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

describe('detalhe em modo leitura', () => {
  it('celular: tocar na conta abre o detalhe (sem formulário); Editar troca pelo formulário e Cancelar volta', async () => {
    withInvoices()
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Detalhes de Luz' }))
    const sheet = screen.getByRole('dialog', { name: 'Detalhes da conta' })
    expect(within(sheet).getByText('R$ 200,00')).toBeInTheDocument()
    expect(within(sheet).getByText(/a vencer · vence em 5 dias/)).toBeInTheDocument()
    expect(within(sheet).getByText('25/10/2026 · dom')).toBeInTheDocument()
    expect(within(sheet).getByText('outubro de 2026')).toBeInTheDocument()
    expect(within(sheet).queryByLabelText('Descrição')).not.toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Editar' }))
    expect(screen.getByRole('dialog', { name: 'Editar conta' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByRole('dialog', { name: 'Detalhes da conta' })).toBeInTheDocument()
  })

  it('conta paga mostra o pagamento e oferece desfazer', async () => {
    withInvoices()
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Detalhes de Feira' }))
    const pagamento = screen.getByRole('region', { name: 'Pagamento' })
    expect(within(pagamento).getByText(/Paga em 12\/10\/2026 · carteira Benefício/)).toBeInTheDocument()
    expect(within(pagamento).getByText('R$ 300,00')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Desfazer pagamento' }))
    await waitFor(() => expect(api.DELETE).toHaveBeenCalledWith('/households/{householdId}/invoices/{invoiceId}/pay', expect.anything()))
  })

  it('parcela mostra o número, o total da compra e quanto falta', async () => {
    const parcela = invoice({
      id: 'p3', description: 'Notebook (3/6)', amountCents: 50000, dueDate: '2026-10-25',
      series: { kind: 'installment', purchaseId: 'pu1', installmentNumber: 3, installmentsCount: 6 },
    })
    const paga = { ...parcela, id: 'p1', status: 'paid' as const }
    mockApi({
      me: ok(me), invoices: ok({ items: [parcela] }),
      purchase: ok({ id: 'pu1', categoryId: 'c1', description: 'Notebook', purchaseDate: '2026-08-10', totalAmountCents: 300000, installmentsCount: 6, installments: [paga, paga, parcela, parcela, parcela, parcela] }),
    })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Detalhes de Notebook (3/6)' }))
    expect(await screen.findByText(/Parcela 3 de 6/)).toHaveTextContent(/Compra de R\$ 3\.000,00\s+Faltam R\$ 2\.000,00 \(4 parcelas\)/)
  })

  it('conta fixa diz o dia', async () => {
    mockApi({ me: ok(me), invoices: ok({ items: [invoice({ id: 'f', description: 'Internet', dueDate: '2026-10-12', series: { kind: 'recurrence', recurrenceId: 'r1' } })] }) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Detalhes de Internet' }))
    expect(screen.getByText('Conta fixa · todo dia 12')).toBeInTheDocument()
  })
})

describe('lista: filtro e busca', () => {
  it('celular: o botão de busca abre a busca e o filtro de categoria', async () => {
    withInvoices()
    renderAt(mes)
    await screen.findByText('Feira')
    expect(screen.queryByLabelText('Buscar contas')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Buscar e filtrar por categoria' }))
    await userEvent.type(screen.getByLabelText('Buscar contas'), 'alug')
    expect(screen.getByText('Aluguel')).toBeInTheDocument()
    expect(screen.queryByText('Luz')).not.toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('Buscar contas'))
    await userEvent.selectOptions(screen.getByLabelText('Filtrar por categoria'), 'c2')
    expect(screen.getByText('Feira')).toBeInTheDocument()
    expect(screen.queryByText('Aluguel')).not.toBeInTheDocument()
  })

  it('a categoria mãe inclui as filhas', async () => {
    mockApi({
      me: ok(me),
      categories: ok([
        { id: 'c1', name: 'Moradia', isEssential: true, sortOrder: 0, archived: false },
        { id: 'c2', name: 'Mercado', isEssential: true, sortOrder: 1, archived: false },
        { id: 'g1', name: 'Gás', isEssential: true, sortOrder: 0, archived: false, parentId: 'c1' },
      ]),
      invoices: ok({ items: [invoice({ id: 'a', description: 'Botijão', categoryId: 'g1' }), invoice({ id: 'b', description: 'Feira', categoryId: 'c2' })] }),
    })
    mockDesktop()
    renderAt(mes)
    await screen.findByRole('region', { name: 'Contas do mês' })
    await screen.findAllByText('Botijão')
    await userEvent.selectOptions(screen.getByLabelText('Filtrar por categoria'), 'c1')
    const lista = screen.getByRole('region', { name: 'Contas do mês' })
    expect(within(lista).getByText('Botijão')).toBeInTheDocument()
    expect(within(lista).queryByText('Feira')).not.toBeInTheDocument()
  })

  it('filtro sem resultado oferece limpar', async () => {
    withInvoices()
    mockDesktop()
    renderAt(mes)
    await userEvent.type(await screen.findByLabelText('Buscar contas'), 'zzz')
    expect(screen.getByText(/Nenhuma conta com esse filtro/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect(screen.getByText('Feira')).toBeInTheDocument()
  })

  it('quando a descrição é o nome da categoria, a categoria não se repete', async () => {
    mockApi({ me: ok(me), invoices: ok({ items: [invoice({ id: 'm', description: 'Moradia', dueDate: '2026-10-22' })] }) })
    renderAt(mes)
    expect(await screen.findByText('vence dia 22')).toBeInTheDocument()
    expect(screen.queryByText(/Moradia ·/)).not.toBeInTheDocument()
  })

  it('mês vazio oferece lançar a primeira conta e importar', async () => {
    mockApi({ me: ok(me) })
    renderAt(mes)
    const first = await screen.findByRole('button', { name: 'Lançar a primeira conta' })
    // há também o atalho Importar da barra lateral: todos levam ao mesmo lugar, com o mês
    for (const link of screen.getAllByRole('link', { name: 'Importar' })) expect(link).toHaveAttribute('href', `/importar?mes=2026-10`)
    await userEvent.click(first)
    expect(screen.getByRole('dialog', { name: 'Nova conta' })).toBeInTheDocument()
  })
})

describe('computador', () => {
  beforeEach(() => {
    mockDesktop()
    try { window.localStorage.clear() } catch { /* sem armazenamento */ }
  })

  it('abrir uma conta mostra o detalhe em leitura no painel lateral, sem janela por cima; Editar abre o formulário ali', async () => {
    withInvoices()
    renderAt(mes)
    // sem conta aberta, o painel mostra os próximos vencimentos (as atrasadas primeiro), não um aviso vazio
    const resumo = await screen.findByRole('region', { name: 'Próximos vencimentos' })
    expect(await within(resumo).findByText('Aluguel')).toBeInTheDocument()
    expect(within(resumo).getByText('Luz')).toBeInTheDocument()
    expect(screen.queryByText(/Toque/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Detalhes de Luz' }))
    const painel = await screen.findByRole('region', { name: 'Detalhes da conta' })
    expect(within(painel).getByRole('heading', { name: 'Luz' })).toBeInTheDocument()
    expect(within(painel).getByRole('button', { name: /Pagar · carteira Geral/ })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await userEvent.click(within(painel).getByRole('button', { name: 'Editar' }))
    expect(within(painel).getByLabelText('Descrição')).toHaveValue('Luz')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('"Nova conta" abre o painel lateral com o foco no valor; Esc fecha', async () => {
    mockApi({ me: ok(me) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: /Nova conta/ }))
    const painel = screen.getByRole('dialog', { name: 'Nova conta' })
    expect(within(painel).getByLabelText('Valor')).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('"Importar" abre a importação num modal grande sobre o mês; Esc fecha', async () => {
    mockApi({ me: ok(me) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Importar' }))
    const modal = await screen.findByRole('dialog', { name: 'Importar contas' })
    expect(within(modal).getByRole('button', { name: 'Colar texto' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('destaques: a pagar, atrasado (com valor e número), pago e total', async () => {
    withInvoices()
    renderAt(mes)
    const resumo = await screen.findByRole('region', { name: 'Resumo do mês' })
    expect(await within(resumo).findByText('1 conta atrasada')).toBeInTheDocument()
    expect(within(resumo).getByText('R$ 1.500,00')).toBeInTheDocument()
    expect(within(resumo).getByText('R$ 2.020,00')).toBeInTheDocument()
    const bloco = screen.getByRole('region', { name: 'Por categoria' })
    expect(within(bloco).getByText('Moradia')).toBeInTheDocument()
  })

  it('sem atraso, o cartão de atrasado não usa o coral', async () => {
    mockApi({ me: ok(me), invoices: ok({ items: [invoice({ id: 'l', description: 'Luz', dueDate: '2026-10-25' })] }) })
    renderAt(mes)
    const resumo = await screen.findByRole('region', { name: 'Resumo do mês' })
    expect(await within(resumo).findByText('nenhuma conta atrasada')).toBeInTheDocument()
    expect(within(resumo).queryByText('[ ✖ ]')).not.toBeInTheDocument()
  })

  it('lista em seções; "Pagas" recolhe e o aparelho lembra', async () => {
    withInvoices()
    const { unmount } = renderAt(mes)
    expect(await screen.findByRole('region', { name: 'Atrasadas' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Daqui pra frente' })).toHaveTextContent(/HOJE · 20\/10/)
    const pagas = within(screen.getByRole('region', { name: 'Pagas' })).getByRole('button', { name: /Pagas/ })
    expect(pagas).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(pagas)
    expect(pagas).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Feira')).not.toBeInTheDocument()
    unmount()
    renderAt(mes)
    const lista = await screen.findByRole('region', { name: 'Contas do mês' })
    expect(await within(lista).findByText('Aluguel')).toBeInTheDocument()
    expect(within(lista).queryByText('Feira')).not.toBeInTheDocument()
  })

  it('pagar várias: marca, Shift+clique marca o intervalo, paga todas e Desfazer desfaz todas', async () => {
    withInvoices()
    renderAt(mes)
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Selecionar Aluguel' }))
    const user = userEvent.setup()
    await user.keyboard('{Shift>}')
    await user.click(screen.getByRole('checkbox', { name: 'Selecionar Luz' }))
    await user.keyboard('{/Shift}')
    await userEvent.click(screen.getByRole('button', { name: 'Pagar 2 selecionadas (R$ 1.700,00)' }))
    await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('2 contas pagas.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Desfazer' }))
    await waitFor(() => expect(api.DELETE).toHaveBeenCalledTimes(2))
  })

  it('atalhos: N abre nova conta, / busca, ↓ anda, Enter abre, P paga, → próximo mês', async () => {
    withInvoices()
    renderAt(mes)
    await screen.findByText('Feira')
    await userEvent.keyboard('n')
    expect(screen.getByRole('dialog', { name: 'Nova conta' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await userEvent.keyboard('/')
    expect(screen.getByLabelText('Buscar contas')).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('button', { name: 'Detalhes de Aluguel' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('button', { name: 'Detalhes de Luz' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('region', { name: 'Detalhes da conta' })).toHaveTextContent('Luz')
    await userEvent.keyboard('p')
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/households/{householdId}/invoices/{invoiceId}/pay', expect.objectContaining({ params: { path: { householdId: 'h1', invoiceId: 'i2' } } })),
    )
    await userEvent.keyboard('{ArrowRight}')
    expect(await screen.findByRole('heading', { name: 'novembro de 2026' })).toBeInTheDocument()
  })

  it('"?" mostra a lista de atalhos', async () => {
    withInvoices()
    renderAt(mes)
    await screen.findByText('Feira')
    await userEvent.keyboard('?')
    expect(screen.getByRole('region', { name: 'Lista de atalhos' })).toHaveTextContent('nova conta')
  })

  it('cria categoria na hora, como subcategoria da principal aberta, e já a escolhe', async () => {
    mockApi({
      me: ok(me),
      createCategory: ok({ id: 'n1', name: 'Água', isEssential: true, sortOrder: 9, archived: false, parentId: 'c1' }),
    })
    renderAt('/?mes=2026-05')
    await userEvent.click(await screen.findByRole('button', { name: /Nova conta/ }))
    await userEvent.click(screen.getByRole('combobox', { name: 'Categoria' }))
    await userEvent.click(screen.getByRole('option', { name: /Nova categoria/ }))
    await userEvent.type(screen.getByLabelText('Nome da nova categoria'), 'Água')
    await userEvent.click(screen.getByRole('checkbox', { name: /dentro de Moradia/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Criar categoria' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/households/{householdId}/categories', expect.objectContaining({ body: { name: 'Água', isEssential: true, parentId: 'c1' } })),
    )
    expect(await screen.findByRole('combobox', { name: 'Categoria' })).toHaveValue('Moradia › Água')
  })

  it('categoria repetida avisa no próprio campo', async () => {
    mockApi({ me: ok(me), createCategory: fail(409, 'category_exists') })
    renderAt('/?mes=2026-05')
    await userEvent.click(await screen.findByRole('button', { name: /Nova conta/ }))
    await userEvent.click(screen.getByRole('combobox', { name: 'Categoria' }))
    await userEvent.click(screen.getByRole('option', { name: /Nova categoria/ }))
    await userEvent.type(screen.getByLabelText('Nome da nova categoria'), 'Moradia{Enter}')
    expect(await screen.findByText('Já existe uma categoria com esse nome.')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Nova conta' })).toBeInTheDocument()
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
