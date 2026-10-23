import { configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import { fail, income, mockApi, ok, me, renderAt, source, viewerMe } from '../test/utils'

// A tela é carregada sob demanda (lazy): com a máquina carregada (ou o CI), o primeiro render pode passar de 1 s.
configure({ asyncUtilTimeout: 5000 })

const salario = income({
  id: 'r1', description: 'Salário Pedro', grossAmountCents: 500000, netAmountCents: 405000, expectedDate: '2026-10-05',
  deductions: [{ kind: 'inss', name: 'INSS', amountCents: 55000 }, { kind: 'irrf', name: 'IRRF', amountCents: 40000 }],
})
const vr = income({ id: 'r2', description: 'Vale-refeição', kind: 'benefit', wallet: 'benefit', grossAmountCents: 80000, netAmountCents: 80000, expectedDate: '2026-10-01', received: true, receivedAt: '2026-10-01' })
const mes = '/receitas?mes=2026-10'

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
  window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as never
}

const withIncomes = () => mockApi({ me: ok(me), incomes: ok([vr, salario]), sources: ok([source({ id: 's1', name: 'Salário Pedro', grossAmountCents: 500000, deductions: salario.deductions })]) })

describe('receitas do mês', () => {
  it('mostra o líquido previsto, o recebido e o que falta receber', async () => {
    withIncomes()
    renderAt(mes)
    expect(await screen.findByRole('button', { name: 'Detalhes de Salário Pedro' })).toBeInTheDocument()
    // recebido = VR (R$ 800); previsto = 800 + 4.050; falta = 4.050
    expect(screen.getByText('R$ 800,00', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText('R$ 4.850,00')).toBeInTheDocument()
    expect(screen.getByText(/falta receber R\$ 4\.050,00/)).toBeInTheDocument()
  })

  it('cada receita mostra a pessoa, o bruto e os descontos', async () => {
    withIncomes()
    renderAt(mes)
    expect(await screen.findByText(/Pedro · Salário · bruto R\$ 5\.000,00 · descontos R\$ 950,00 · prevista/)).toBeInTheDocument()
    expect(screen.getByText('R$ 4.050,00', { selector: 'span.shrink-0' })).toBeInTheDocument()
  })

  it('um toque no nó marca como recebida, com aviso e Desfazer', async () => {
    withIncomes()
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Marcar Salário Pedro como recebida' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/households/{householdId}/incomes/{incomeId}/receive', expect.objectContaining({ params: { path: { householdId: 'h1', incomeId: 'r1' } } })),
    )
    expect(await screen.findByText(/Salário Pedro recebida/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Desfazer' }))
    await waitFor(() => expect(api.DELETE).toHaveBeenCalledWith('/households/{householdId}/incomes/{incomeId}/receive', expect.anything()))
  })

  it('tocar no nó de uma recebida desfaz o recebimento', async () => {
    withIncomes()
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Desfazer recebimento de Vale-refeição' }))
    await waitFor(() => expect(api.DELETE).toHaveBeenCalled())
  })

  it('sem receitas nem fonte, convida a cadastrar o salário uma vez', async () => {
    mockApi({ me: ok(me) })
    renderAt(mes)
    expect(await screen.findByText(/Cadastre o seu salário/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar salário' }))
    expect(await screen.findByRole('heading', { name: 'Nova fonte de receita' })).toBeInTheDocument()
  })

  it('erro ao carregar oferece tentar de novo', async () => {
    mockApi({ me: ok(me), incomes: fail(500, 'internal_error') })
    renderAt(mes)
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar as receitas')
  })

  it('o viewer só lê: sem nova receita nem receber', async () => {
    mockApi({ me: ok(viewerMe), incomes: ok([salario]) })
    renderAt(mes)
    expect(await screen.findByRole('button', { name: 'Marcar Salário Pedro como recebida' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Nova receita' })).not.toBeInTheDocument()
  })
})

describe('fonte de receita (o molde do salário)', () => {
  it('cadastra o salário com descontos e mostra o líquido enquanto digita', async () => {
    mockApi({ me: ok(me), createSource: ok(source({ id: 'novo', name: 'Salário' })) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Cadastrar salário' }))
    await userEvent.type(screen.getByLabelText('Nome'), 'Salário Pedro')
    await userEvent.type(screen.getByLabelText('Valor bruto mensal'), '500000')
    await userEvent.click(screen.getByRole('button', { name: '+ Adicionar desconto' }))
    await userEvent.type(screen.getByLabelText('Valor do desconto 1'), '55000')
    expect(screen.getByText('R$ 4.450,00')).toBeInTheDocument() // líquido = 5.000 - 550
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar fonte' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        '/households/{householdId}/income-sources',
        expect.objectContaining({
          body: expect.objectContaining({
            userId: 'u1', kind: 'salary', name: 'Salário Pedro', grossAmountCents: 500000, dayOfMonth: 5, startMonth: '2026-10-01',
            deductions: [{ kind: 'inss', name: 'INSS', amountCents: 55000 }],
          }),
        }),
      ),
    )
  })

  it('descontos maiores que o bruto são sinalizados e bloqueiam o envio', async () => {
    mockApi({ me: ok(me) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Cadastrar salário' }))
    await userEvent.type(screen.getByLabelText('Nome'), 'Salário')
    await userEvent.type(screen.getByLabelText('Valor bruto mensal'), '100000')
    await userEvent.click(screen.getByRole('button', { name: '+ Adicionar desconto' }))
    await userEvent.type(screen.getByLabelText('Valor do desconto 1'), '150000')
    expect(screen.getByText('Os descontos passam do valor bruto.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cadastrar fonte' })).toBeDisabled()
  })

  it('"Outro desconto" pede um nome', async () => {
    mockApi({ me: ok(me) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Cadastrar salário' }))
    await userEvent.click(screen.getByRole('button', { name: '+ Adicionar desconto' }))
    await userEvent.selectOptions(screen.getByLabelText('Tipo do desconto 1'), 'other')
    expect(screen.getByLabelText('Nome do desconto 1')).toBeInTheDocument()
  })

  it('reaplicar o molde avisa que os ajustes manuais serão sobrescritos e envia o applyFrom', async () => {
    mockApi({ me: ok(me), incomes: ok([salario]), sources: ok([source({ id: 's1', name: 'Salário Pedro', generatedThrough: '2027-10-01' })]) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Editar fonte Salário Pedro' }))
    expect(screen.getByText(/previsão gerada até 10\/2027/)).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText(/Reaplicar este molde/))
    expect(screen.getByText(/sobrescreve os ajustes que você fez/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Salvar e reaplicar' }))
    await waitFor(() =>
      expect(api.PATCH).toHaveBeenCalledWith(
        '/households/{householdId}/income-sources/{sourceId}',
        expect.objectContaining({ params: { path: { householdId: 'h1', sourceId: 's1' }, query: { applyFrom: '2026-10-01' } } }),
      ),
    )
  })

  it('salvar sem reaplicar não envia applyFrom', async () => {
    mockApi({ me: ok(me), sources: ok([source({ id: 's1', name: 'Salário Pedro' })]) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Editar fonte Salário Pedro' }))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar fonte' }))
    await waitFor(() =>
      expect(api.PATCH).toHaveBeenCalledWith('/households/{householdId}/income-sources/{sourceId}', expect.objectContaining({ params: { path: { householdId: 'h1', sourceId: 's1' }, query: {} } })),
    )
  })
})

describe('ajustar uma receita do mês', () => {
  it('edita o bruto e os descontos só deste mês e mostra o líquido', async () => {
    withIncomes()
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Detalhes de Salário Pedro' }))
    expect(screen.getByLabelText('Valor bruto')).toHaveValue('R$ 5.000,00')
    expect(screen.getByLabelText('Valor do desconto 1')).toHaveValue('R$ 550,00')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() =>
      expect(api.PATCH).toHaveBeenCalledWith(
        '/households/{householdId}/incomes/{incomeId}',
        expect.objectContaining({ body: expect.objectContaining({ grossAmountCents: 500000, deductions: salario.deductions, notes: null }) }),
      ),
    )
  })

  it('cria uma receita avulsa (outra) no mês exibido', async () => {
    mockApi({ me: ok(me), createIncome: ok(income({ id: 'n', description: 'Freela' })) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Nova receita' }))
    await userEvent.click(screen.getByRole('button', { name: 'Outra' }))
    await userEvent.type(screen.getByLabelText('O que é'), 'Freela')
    await userEvent.type(screen.getByLabelText('Valor bruto'), '120000')
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar receita' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        '/households/{householdId}/incomes',
        expect.objectContaining({ body: expect.objectContaining({ kind: 'other', description: 'Freela', grossAmountCents: 120000, competenceMonth: '2026-10-01', userId: 'u1' }) }),
      ),
    )
  })

  it('o vale (VR) avisa que entra na carteira de benefício', async () => {
    mockApi({ me: ok(me) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Nova receita' }))
    await userEvent.click(screen.getByRole('button', { name: 'Vale (VR)' }))
    expect(screen.getByText('Entra na carteira de benefício.')).toBeInTheDocument()
  })
})

describe('computador', () => {
  it('o detalhe abre ao lado da lista, sem janela por cima', async () => {
    mockDesktop()
    withIncomes()
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Detalhes de Salário Pedro' }))
    const painel = await screen.findByRole('region', { name: 'Detalhes' })
    expect(within(painel).getByLabelText('O que é')).toHaveValue('Salário Pedro')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
