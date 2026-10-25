import { configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import type { MonthlySummary } from '../api/types'
import { emptySummary, fail, income, mockApi, ok, me, renderAt, source, viewerMe, walletBalance } from '../test/utils'

// A tela é carregada sob demanda (lazy): com a máquina carregada (ou o CI), o primeiro render pode passar de 1 s.
configure({ asyncUtilTimeout: 5000 })

// Todos os nomes e valores são inventados. Hoje = 20/10/2026.
const salarioPedro = income({
  id: 'r1', description: 'Salário Pedro', grossAmountCents: 500000, netAmountCents: 405000, expectedDate: '2026-10-02',
  received: true, receivedAt: '2026-10-02', repeats: true, sourceId: 's1', dateRule: { rule: 'nth_business_day', n: 2 },
  deductions: [{ kind: 'inss', name: 'INSS', amountCents: 55000 }, { kind: 'irrf', name: 'IRRF', amountCents: 40000 }],
})
const vrPedro = income({
  id: 'r2', description: 'Vale-refeição', kind: 'benefit', walletId: 'w2', grossAmountCents: 136500, netAmountCents: 136500,
  expectedDate: '2026-10-28', repeats: true, sourceId: 's2', dateRule: { rule: 'day_of_month', n: 28, weekendAdjust: 'forward' },
  amountMode: 'per_unit', quantity: 21, unitPriceCents: 6500, unitLabel: 'dia trabalhado',
})
// Vale que cai no último dia útil do mês ANTERIOR à competência (o de outubro cai em setembro).
const vrMesAnterior = income({
  id: 'r5', description: 'VR do mês seguinte', kind: 'benefit', walletId: 'w2', grossAmountCents: 80000, netAmountCents: 80000,
  expectedDate: '2026-09-30', received: true, receivedAt: '2026-09-30', repeats: true, sourceId: 's5', dateRule: { rule: 'last_business_day', monthOffset: -1 },
})
const salarioAna = income({
  id: 'r3', description: 'Salário Ana', userId: 'u2', grossAmountCents: 300000, netAmountCents: 300000, expectedDate: '2026-10-05',
  held: true, repeats: true, sourceId: 's3', dateRule: { rule: 'day_of_month', n: 5, weekendAdjust: 'forward' },
})
const freela = income({ id: 'r4', description: 'Freela', kind: 'other', grossAmountCents: 20000, netAmountCents: 20000, expectedDate: '2026-10-15', received: true, receivedAt: '2026-10-15' })
const mes = '/receitas?mes=2026-10'

const summaryWith = (over: Partial<MonthlySummary> = {}): MonthlySummary => ({
  ...emptySummary,
  wallets: [walletBalance('w1', { expectedIncomeCents: 725000 }), walletBalance('w2', { expectedIncomeCents: 136500 })],
  totalPaidCents: 100000, totalPendingCents: 200000, ...over,
})

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

const withIncomes = (extra: Parameters<typeof mockApi>[0] = {}) =>
  mockApi({ me: ok(me), incomes: ok([salarioPedro, vrPedro, salarioAna]), summary: ok(summaryWith()), ...extra })

describe('topo: recebido, a receber, por pessoa e sobra', () => {
  it('mostra o recebido grande, o a receber pequeno e o total de cada pessoa', async () => {
    withIncomes()
    renderAt(mes)
    expect(await screen.findByRole('button', { name: 'Detalhes de Salário Pedro' })).toBeInTheDocument()
    // recebido = salário do Pedro (4.050); a receber = VR (1.365) + Ana retido (3.000)
    expect(screen.getByText('R$ 4.050,00', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText(/a receber/, { selector: 'p' })).toHaveTextContent('R$ 4.365,00')
    const porPessoa = screen.getByRole('table')
    expect(within(porPessoa).getByRole('row', { name: /Pedro/ })).toHaveTextContent('R$ 4.050,00')
    expect(within(porPessoa).getByRole('row', { name: /Pedro/ })).toHaveTextContent('+ R$ 1.365,00')
    expect(within(porPessoa).getByRole('row', { name: /Ana/ })).toHaveTextContent('R$ 0,00')
    expect(within(porPessoa).getByRole('row', { name: /Ana/ })).toHaveTextContent('+ R$ 3.000,00')
  })

  it('a sobra do mês é receitas menos despesas, com o caminho para o resumo', async () => {
    withIncomes()
    renderAt(mes)
    // receitas 8.615,00 (7.250 + 1.365) − despesas 3.000,00 (1.000 pagas + 2.000 a pagar)
    expect(await screen.findByText('R$ 5.615,00')).toBeInTheDocument()
    expect(screen.getByText(/receitas R\$ 8\.615,00 − despesas R\$ 3\.000,00/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver no resumo' })).toHaveAttribute('href', '/resumo?mes=2026-10')
  })

  it('sobra negativa vira alerta com o marcador da marca', async () => {
    withIncomes({ summary: ok(summaryWith({ totalPendingCents: 900000 })) })
    renderAt(mes)
    expect(await screen.findByText(/receitas R\$ 8\.615,00 − despesas R\$ 10\.000,00/)).toBeInTheDocument()
    expect(screen.getByText('-R$ 1.385,00')).toHaveClass('text-alert-text')
  })

  it('não existe mais o bloco "Previsto" nem "Previsão mensal · Fontes"', async () => {
    withIncomes()
    renderAt(mes)
    await screen.findByRole('button', { name: 'Detalhes de Salário Pedro' })
    expect(screen.queryByText(/previsão mensal/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^previsto$/i)).not.toBeInTheDocument()
  })
})

describe('lista no celular', () => {
  it('mostra o estado de cada receita com os marcadores da marca e sem "check"', async () => {
    withIncomes()
    renderAt(mes)
    const salario = await screen.findByRole('button', { name: 'Detalhes de Salário Pedro' })
    expect(salario).toHaveTextContent('[ ▪ ]')
    expect(salario).toHaveTextContent('recebida em 02/10')
    expect(screen.getByRole('button', { name: 'Detalhes de Vale-refeição' })).toHaveTextContent('[ ▫ ]')
    expect(screen.getByRole('button', { name: 'Detalhes de Vale-refeição' })).toHaveTextContent('cai em 28/10')
    expect(screen.getByRole('button', { name: 'Detalhes de Salário Ana' })).toHaveTextContent('[ ✖ ]')
    expect(screen.getByRole('button', { name: 'Detalhes de Salário Ana' })).toHaveTextContent('não caiu · atrasada 15 dias')
    expect(screen.queryByRole('button', { name: /Marcar .* como recebida/ })).not.toBeInTheDocument()
    expect(salario).toHaveTextContent('repete')
    expect(screen.getByRole('button', { name: 'Detalhes de Vale-refeição' })).toHaveTextContent('por unidade')
  })

  it('sem receitas nem repetição, convida a cadastrar o salário uma vez', async () => {
    mockApi({ me: ok(me) })
    renderAt(mes)
    expect(await screen.findByText(/Cadastre o seu salário/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar salário' }))
    expect(await screen.findByRole('dialog', { name: 'Nova receita' })).toBeInTheDocument()
  })

  it('erro ao carregar oferece tentar de novo', async () => {
    mockApi({ me: ok(me), incomes: fail(500, 'internal_error') })
    renderAt(mes)
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar as receitas')
  })

  it('o viewer só lê: sem nova receita e sem ações no detalhe', async () => {
    mockApi({ me: ok(viewerMe), incomes: ok([salarioPedro]) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Detalhes de Salário Pedro' }))
    const detalhe = await screen.findByRole('dialog', { name: 'Detalhes da receita' })
    expect(within(detalhe).queryByRole('button', { name: /Não caiu|Caiu|Editar|Excluir/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nova receita' })).not.toBeInTheDocument()
  })
})

describe('detalhe em leitura e "não caiu"', () => {
  it('mostra o líquido, os descontos, a regra em linguagem natural e a repetição', async () => {
    withIncomes()
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Detalhes de Vale-refeição' }))
    const detalhe = await screen.findByRole('dialog', { name: 'Detalhes da receita' })
    expect(within(detalhe).getByText('dia 28, ou o próximo dia útil')).toBeInTheDocument()
    expect(within(detalhe).getByText('todo mês, sem data para acabar')).toBeInTheDocument()
    expect(within(detalhe).getByText('21 × R$ 65,00 · dia trabalhado')).toBeInTheDocument()
    expect(within(detalhe).getByText('cai em 28/10')).toBeInTheDocument()
  })

  it('"Não caiu" numa recebida avisa e o Desfazer diz que caiu', async () => {
    withIncomes()
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Detalhes de Salário Pedro' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Não caiu' }))
    await waitFor(() =>
      expect(api.DELETE).toHaveBeenCalledWith('/households/{householdId}/incomes/{incomeId}/receive', expect.objectContaining({ params: { path: { householdId: 'h1', incomeId: 'r1' } } })),
    )
    expect(await screen.findByText('Salário Pedro: não caiu.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Desfazer' }))
    await waitFor(() => expect(api.POST).toHaveBeenCalledWith('/households/{householdId}/incomes/{incomeId}/receive', expect.anything()))
  })

  it('"Caiu" numa que não caiu volta ao recebimento automático', async () => {
    withIncomes()
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Detalhes de Salário Ana' }))
    const detalhe = await screen.findByRole('dialog', { name: 'Detalhes da receita' })
    expect(within(detalhe).getByText('Fora do saldo até você dizer que caiu.')).toBeInTheDocument()
    await userEvent.click(within(detalhe).getByRole('button', { name: 'Caiu' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/households/{householdId}/incomes/{incomeId}/receive', expect.objectContaining({ params: { path: { householdId: 'h1', incomeId: 'r3' } } })),
    )
    expect(await screen.findByText('Salário Ana: caiu.')).toBeInTheDocument()
  })
})

describe('detalhe: receita que cai no mês anterior', () => {
  it('diz "último dia útil do mês anterior" na regra', async () => {
    mockApi({ me: ok(me), incomes: ok([vrMesAnterior]), summary: ok(summaryWith()) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Detalhes de VR do mês seguinte' }))
    expect(await screen.findByText('último dia útil do mês anterior')).toBeInTheDocument()
  })
})

describe('excluir com escopo e Desfazer', () => {
  it('numa receita que se repete, oferece só este mês ou este e os seguintes', async () => {
    withIncomes()
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Detalhes de Vale-refeição' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Excluir este e os seguintes' }))
    await waitFor(() =>
      expect(api.DELETE).toHaveBeenCalledWith(
        '/households/{householdId}/incomes/{incomeId}',
        expect.objectContaining({ params: { path: { householdId: 'h1', incomeId: 'r2' }, query: { scope: 'following' } } }),
      ),
    )
    expect(await screen.findByText('Esta e as seguintes foram excluídas.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Desfazer' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        '/households/{householdId}/incomes/{incomeId}/restore',
        expect.objectContaining({ params: { path: { householdId: 'h1', incomeId: 'r2' }, query: { scope: 'following' } } }),
      ),
    )
  })

  it('"só este mês" restaura só este mês no Desfazer', async () => {
    withIncomes()
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Detalhes de Vale-refeição' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Excluir só este mês' }))
    expect(await screen.findByText('Vale-refeição excluída.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Desfazer' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        '/households/{householdId}/incomes/{incomeId}/restore',
        expect.objectContaining({ params: { path: { householdId: 'h1', incomeId: 'r2' }, query: { scope: 'this' } } }),
      ),
    )
  })

  it('receita avulsa tem um único "Excluir receita"', async () => {
    mockApi({ me: ok(me), incomes: ok([freela]), summary: ok(summaryWith()) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Detalhes de Freela' }))
    expect(await screen.findByRole('button', { name: 'Excluir receita' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /seguintes/ })).not.toBeInTheDocument()
  })
})

describe('formulário: criar', () => {
  async function openNew() {
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Nova receita' }))
    return screen.findByRole('dialog', { name: 'Nova receita' })
  }

  it('salário repete por padrão, com a regra do dia e a prévia das próximas datas', async () => {
    mockApi({
      me: ok(me),
      incomeDates: (q) =>
        ok(
          q.rule === 'day_of_month'
            ? [
                { month: '2026-10-01', expectedDate: '2026-10-05', businessDays: 21 },
                { month: '2026-11-01', expectedDate: '2026-11-05', businessDays: 19 },
                { month: '2026-12-01', expectedDate: '2026-12-07', businessDays: 22 },
              ]
            : [{ month: '2026-10-01', expectedDate: '2026-10-30', businessDays: 21 }],
        ),
    })
    const form = await openNew()
    await userEvent.type(within(form).getByLabelText('Descrição'), 'Salário Pedro')
    await userEvent.type(within(form).getByLabelText('Valor bruto'), '500000')
    expect(within(form).getByLabelText('Repete todo mês')).toBeChecked()
    expect(await within(form).findByText(/05\/11 \(qui\) · 07\/12 \(seg\)/)).toBeInTheDocument() // só futuras a partir de hoje (20/10)
    expect(within(form).getByText(/Este mês: 05\/10 \(seg\), já passou/)).toBeInTheDocument()
    expect(within(form).getByRole('radio', { name: 'Próximo dia útil' })).toBeChecked()
    await userEvent.click(within(form).getByRole('button', { name: 'Adicionar receita' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        '/households/{householdId}/incomes',
        expect.objectContaining({
          body: expect.objectContaining({
            userId: 'u1', kind: 'salary', description: 'Salário Pedro', competenceMonth: '2026-10-01', amountMode: 'fixed', grossAmountCents: 500000,
            dateRule: { rule: 'day_of_month', n: 5, weekendAdjust: 'forward' }, repeats: true,
          }),
        }),
      ),
    )
  })

  it('"N-ésimo dia útil" esconde o ajuste de fim de semana e pede a prévia dessa regra', async () => {
    mockApi({ me: ok(me) })
    const form = await openNew()
    await userEvent.click(within(form).getByRole('radio', { name: 'N-ésimo dia útil' }))
    expect(within(form).queryByRole('radiogroup', { name: 'Se cair em fim de semana ou feriado' })).not.toBeInTheDocument()
    const ordem = within(form).getByLabelText('Ordem do dia útil (1 = primeiro)')
    await userEvent.clear(ordem)
    await userEvent.type(ordem, '2')
    await waitFor(() =>
      expect(api.GET).toHaveBeenCalledWith(
        '/households/{householdId}/income-dates',
        expect.objectContaining({ params: expect.objectContaining({ query: expect.objectContaining({ rule: 'nth_business_day', n: 2 }) }) }),
      ),
    )
    await userEvent.type(within(form).getByLabelText('Descrição'), 'Salário Ana')
    await userEvent.type(within(form).getByLabelText('Valor bruto'), '300000')
    await userEvent.click(within(form).getByRole('button', { name: 'Adicionar receita' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        '/households/{householdId}/incomes',
        expect.objectContaining({ body: expect.objectContaining({ dateRule: { rule: 'nth_business_day', n: 2 }, repeats: true }) }),
      ),
    )
  })

  it('último dia útil não pede número', async () => {
    mockApi({ me: ok(me) })
    const form = await openNew()
    await userEvent.click(within(form).getByRole('radio', { name: 'Último dia útil' }))
    expect(within(form).queryByLabelText('Dia')).not.toBeInTheDocument()
    await userEvent.type(within(form).getByLabelText('Descrição'), 'Aluguel recebido')
    await userEvent.type(within(form).getByLabelText('Valor bruto'), '150000')
    await userEvent.click(within(form).getByRole('button', { name: 'Adicionar receita' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/households/{householdId}/incomes', expect.objectContaining({ body: expect.objectContaining({ dateRule: { rule: 'last_business_day' } }) })),
    )
  })

  it('por unidade: sugere os dias úteis do mês como quantidade e mostra o total', async () => {
    mockApi({ me: ok(me) })
    const form = await openNew()
    await userEvent.click(within(form).getByRole('radio', { name: 'Vale (VR)' }))
    await userEvent.click(within(form).getByRole('radio', { name: 'Por unidade' }))
    expect(within(form).getByLabelText('Quantidade')).toHaveValue(21)
    expect(await within(form).findByText(/Sugerida: 21 dias úteis em outubro de 2026/)).toBeInTheDocument()
    await userEvent.type(within(form).getByLabelText('Preço por unidade'), '6500')
    expect(within(form).getByText('21 × R$ 65,00 = R$ 1.365,00')).toBeInTheDocument()
    // a pessoa ajusta a quantidade do mês
    const qtd = within(form).getByLabelText('Quantidade')
    await userEvent.clear(qtd)
    await userEvent.type(qtd, '19')
    expect(within(form).getByText('19 × R$ 65,00 = R$ 1.235,00')).toBeInTheDocument()
    await userEvent.type(within(form).getByLabelText('Descrição'), 'Vale-refeição')
    await userEvent.click(within(form).getByRole('button', { name: 'Adicionar receita' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        '/households/{householdId}/incomes',
        expect.objectContaining({
          body: expect.objectContaining({ kind: 'benefit', amountMode: 'per_unit', unitPriceCents: 6500, quantity: 19, unitLabel: 'dia trabalhado', repeats: true }),
        }),
      ),
    )
    expect(api.POST).not.toHaveBeenCalledWith('/households/{householdId}/incomes', expect.objectContaining({ body: expect.objectContaining({ grossAmountCents: expect.anything() }) }))
  })

  it('sem repetir, aceita uma data específica', async () => {
    mockApi({ me: ok(me) })
    const form = await openNew()
    await userEvent.click(within(form).getByRole('radio', { name: 'Outra' }))
    expect(within(form).getByLabelText('Repete todo mês')).not.toBeChecked()
    await userEvent.click(within(form).getByRole('radio', { name: 'Data específica' }))
    await userEvent.type(within(form).getByLabelText('Descrição'), 'Freela')
    await userEvent.type(within(form).getByLabelText('Valor bruto'), '120000')
    await userEvent.type(within(form).getByLabelText('Data'), '25102026')
    await userEvent.click(within(form).getByRole('button', { name: 'Adicionar receita' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        '/households/{householdId}/incomes',
        expect.objectContaining({ body: expect.objectContaining({ kind: 'other', expectedDate: '2026-10-25', grossAmountCents: 120000 }) }),
      ),
    )
    expect(api.POST).not.toHaveBeenCalledWith('/households/{householdId}/incomes', expect.objectContaining({ body: expect.objectContaining({ repeats: true }) }))
  })

  it('marcar "repete" troca "data específica" por uma regra', async () => {
    mockApi({ me: ok(me) })
    const form = await openNew()
    await userEvent.click(within(form).getByRole('radio', { name: 'Outra' }))
    await userEvent.click(within(form).getByRole('radio', { name: 'Data específica' }))
    await userEvent.click(within(form).getByLabelText('Repete todo mês'))
    expect(within(form).getByRole('radio', { name: 'Dia do mês' })).toBeChecked()
    expect(within(form).queryByRole('radio', { name: 'Data específica' })).not.toBeInTheDocument()
  })

  it('"Repete até" vai como o primeiro dia do mês escolhido', async () => {
    mockApi({ me: ok(me) })
    const form = await openNew()
    await userEvent.type(within(form).getByLabelText('Descrição'), 'Temporário')
    await userEvent.type(within(form).getByLabelText('Valor bruto'), '100000')
    await userEvent.click(within(form).getByRole('button', { name: /Até \(opcional\)/ }))
    await userEvent.click(screen.getByRole('button', { name: 'dezembro de 2026' }))
    await userEvent.click(within(form).getByRole('button', { name: 'Adicionar receita' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/households/{householdId}/incomes', expect.objectContaining({ body: expect.objectContaining({ repeats: true, repeatsUntil: '2026-12-01' }) })),
    )
  })

  it('vale novo já vem em "No mês anterior", mostra a frase, a prévia com a data real e manda o monthOffset', async () => {
    mockApi({
      me: ok(me),
      incomeDates: (q) =>
        ok(
          q.monthOffset === -1
            ? [
                { month: '2026-10-01', expectedDate: '2026-09-30', businessDays: 21 },
                { month: '2026-11-01', expectedDate: '2026-10-30', businessDays: 19 },
                { month: '2026-12-01', expectedDate: '2026-11-30', businessDays: 22 },
                { month: '2027-01-01', expectedDate: '2026-12-31', businessDays: 20 },
              ]
            : [{ month: '2026-10-01', expectedDate: '2026-10-30', businessDays: 21 }],
        ),
    })
    const form = await openNew()
    expect(within(form).getByRole('radio', { name: 'No mês da competência' })).toBeChecked() // salário: no mês
    await userEvent.click(within(form).getByRole('radio', { name: 'Vale (VR)' }))
    expect(within(form).getByRole('radio', { name: 'No mês anterior' })).toBeChecked()
    await userEvent.click(within(form).getByRole('radio', { name: 'Último dia útil' }))
    expect(within(form).getByText(/O vale de outubro cai no último dia útil de setembro\./)).toBeInTheDocument()
    expect(await within(form).findByText(/30\/10 \(sex\) · 30\/11 \(seg\) · 31\/12 \(qui\)/)).toBeInTheDocument()
    expect(within(form).getByText(/Competência de outubro: 30\/09 \(qua\), já passou: conta como recebida/)).toBeInTheDocument()
    await waitFor(() =>
      expect(api.GET).toHaveBeenCalledWith(
        '/households/{householdId}/income-dates',
        expect.objectContaining({ params: expect.objectContaining({ query: expect.objectContaining({ rule: 'last_business_day', monthOffset: -1 }) }) }),
      ),
    )
    await userEvent.type(within(form).getByLabelText('Descrição'), 'Vale-alimentação')
    await userEvent.type(within(form).getByLabelText('Valor bruto'), '80000')
    await userEvent.click(within(form).getByRole('button', { name: 'Adicionar receita' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        '/households/{householdId}/incomes',
        expect.objectContaining({ body: expect.objectContaining({ kind: 'benefit', dateRule: { rule: 'last_business_day', monthOffset: -1 }, repeats: true }) }),
      ),
    )
  })

  it('trocar o tipo depois de a pessoa escolher o mês não sobrescreve a escolha', async () => {
    mockApi({ me: ok(me) })
    const form = await openNew()
    await userEvent.click(within(form).getByRole('radio', { name: 'No mês anterior' }))
    await userEvent.click(within(form).getByRole('radio', { name: 'Vale (VR)' }))
    await userEvent.click(within(form).getByRole('radio', { name: 'Salário' }))
    expect(within(form).getByRole('radio', { name: 'No mês anterior' })).toBeChecked()
    // e o oposto: escolheu "no mês da competência" e depois trocou para Vale
    await userEvent.click(within(form).getByRole('radio', { name: 'No mês da competência' }))
    await userEvent.click(within(form).getByRole('radio', { name: 'Vale (VR)' }))
    expect(within(form).getByRole('radio', { name: 'No mês da competência' })).toBeChecked()
  })

  it('data específica não tem "Mês em que cai"', async () => {
    mockApi({ me: ok(me) })
    const form = await openNew()
    await userEvent.click(within(form).getByLabelText('Repete todo mês')) // desmarca para liberar a data específica
    await userEvent.click(within(form).getByRole('radio', { name: 'Data específica' }))
    expect(within(form).queryByRole('radiogroup', { name: 'Mês em que cai' })).not.toBeInTheDocument()
  })

  it('mostra o erro do servidor no campo certo', async () => {
    mockApi({ me: ok(me), createIncome: fail(400, 'validation_error', { 'dateRule.n': 'informe um dia de 1 a 31' }) })
    const form = await openNew()
    await userEvent.type(within(form).getByLabelText('Descrição'), 'Salário')
    await userEvent.type(within(form).getByLabelText('Valor bruto'), '100000')
    await userEvent.click(within(form).getByRole('button', { name: 'Adicionar receita' }))
    expect(await within(form).findByText('informe um dia de 1 a 31')).toBeInTheDocument()
  })

  it('descontos maiores que o valor bloqueiam o envio', async () => {
    mockApi({ me: ok(me) })
    const form = await openNew()
    await userEvent.type(within(form).getByLabelText('Descrição'), 'Salário')
    await userEvent.type(within(form).getByLabelText('Valor bruto'), '100000')
    await userEvent.click(within(form).getByRole('button', { name: '+ Adicionar desconto' }))
    await userEvent.type(within(form).getByLabelText('Valor do desconto 1'), '150000')
    expect(within(form).getByText('Os descontos passam do valor.')).toBeInTheDocument()
    expect(within(form).getByRole('button', { name: 'Adicionar receita' })).toBeDisabled()
  })
})

describe('sugestão de INSS e IRRF (opcional)', () => {
  it('preenche os descontos pela estimativa e avisa que é uma estimativa', async () => {
    mockApi({ me: ok(me) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Nova receita' }))
    const form = await screen.findByRole('dialog', { name: 'Nova receita' })
    expect(within(form).getByRole('button', { name: 'Sugerir INSS e IRRF' })).toBeDisabled() // sem valor ainda
    await userEvent.type(within(form).getByLabelText('Valor bruto'), '600000')
    await userEvent.click(within(form).getByRole('button', { name: 'Sugerir INSS e IRRF' }))
    await waitFor(() =>
      expect(api.GET).toHaveBeenCalledWith(
        '/households/{householdId}/tax/estimate',
        expect.objectContaining({ params: { path: { householdId: 'h1' }, query: { month: '2026-10-01', grossCents: 600000, dependents: 0 } } }),
      ),
    )
    expect(await within(form).findByText(/Estimativa pela tabela de 2026; confira no seu holerite\./)).toBeInTheDocument()
    expect(within(form).getByLabelText('Valor do desconto 1')).toHaveValue('R$ 641,51')
    expect(within(form).getByLabelText('Valor do desconto 2')).toHaveValue('R$ 385,10')
    // continua editável
    const inss = within(form).getByLabelText('Valor do desconto 1')
    await userEvent.clear(inss)
    await userEvent.type(inss, '60000')
    expect(within(form).getByLabelText('Valor do desconto 1')).toHaveValue('R$ 600,00')
  })

  it('só aparece para salário e nunca aplica descontos sozinho', async () => {
    mockApi({ me: ok(me) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Nova receita' }))
    const form = await screen.findByRole('dialog', { name: 'Nova receita' })
    expect(within(form).queryByLabelText('Valor do desconto 1')).not.toBeInTheDocument()
    await userEvent.click(within(form).getByRole('radio', { name: 'Vale (VR)' }))
    expect(within(form).queryByRole('button', { name: 'Sugerir INSS e IRRF' })).not.toBeInTheDocument()
  })

  it('avisa quando a tabela usada é de outro ano', async () => {
    mockApi({ me: ok(me), taxEstimate: ok({ inssCents: 50000, irrfCents: 0, tableYear: 2026, sources: [], checkedOn: '2026-10-23', approximate: true }) })
    renderAt('/receitas?mes=2031-03')
    await userEvent.click(await screen.findByRole('button', { name: 'Nova receita' }))
    const form = await screen.findByRole('dialog', { name: 'Nova receita' })
    await userEvent.type(within(form).getByLabelText('Valor bruto'), '400000')
    await userEvent.click(within(form).getByRole('button', { name: 'Sugerir INSS e IRRF' }))
    expect(await within(form).findByText(/tabela de 2026 \(tabela de 2026, a mais recente que temos\)|tabela de 2026 \(a mais recente/)).toBeInTheDocument()
    expect(within(form).queryByLabelText('Valor do desconto 2')).not.toBeInTheDocument() // IRRF zero não vira linha
  })

  it('IRRF zero é explicado como isenção e a nota mostra o que foi preenchido', async () => {
    mockApi({ me: ok(me), taxEstimate: ok({ inssCents: 50151, irrfCents: 0, tableYear: 2026, sources: [], checkedOn: '2026-10-23', approximate: true }) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Nova receita' }))
    const form = await screen.findByRole('dialog', { name: 'Nova receita' })
    await userEvent.type(within(form).getByLabelText('Valor bruto'), '500000')
    await userEvent.click(within(form).getByRole('button', { name: 'Sugerir INSS e IRRF' }))
    expect(await within(form).findByText(/INSS R\$\s501,51 · IRRF R\$ 0,00 \(isento nesta faixa: até R\$ 5\.000 pela Lei 15\.270\/2025\)/)).toBeInTheDocument()
    expect(within(form).getByLabelText('Valor do desconto 1')).toHaveValue('R$ 501,51')
  })

  it('substitui só INSS e IRRF digitados e avisa', async () => {
    mockApi({ me: ok(me) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Nova receita' }))
    const form = await screen.findByRole('dialog', { name: 'Nova receita' })
    await userEvent.type(within(form).getByLabelText('Valor bruto'), '600000')
    await userEvent.click(within(form).getByRole('button', { name: 'Sugerir INSS e IRRF' }))
    await within(form).findByText(/confira no seu holerite/)
    await userEvent.click(within(form).getByRole('button', { name: 'Sugerir INSS e IRRF' }))
    expect(await within(form).findByText(/Substituiu o INSS e o IRRF/)).toBeInTheDocument()
    expect(within(form).queryByLabelText('Valor do desconto 3')).not.toBeInTheDocument()
  })

  it('mostra a causa quando a estimativa falha (status da API e rede)', async () => {
    mockApi({ me: ok(me), taxEstimate: fail(503, 'unavailable') })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Nova receita' }))
    const form = await screen.findByRole('dialog', { name: 'Nova receita' })
    await userEvent.type(within(form).getByLabelText('Valor bruto'), '500000')
    await userEvent.click(within(form).getByRole('button', { name: 'Sugerir INSS e IRRF' }))
    expect(await within(form).findByText(/Não foi possível calcular agora: .*\(erro 503\)\. Digite os valores do holerite\./)).toBeInTheDocument()
  })
})

describe('prévia "Próximas datas" parte de hoje', () => {
  it('não mostra a data do mês que já passou entre as próximas e explica à parte', async () => {
    mockApi({
      me: ok(me),
      // 'dia 5': a API devolve a partir do mês pedido; hoje = 20/10/2026
      incomeDates: (q) => ok([0, 1, 2, 3].map((i) => {
        const [y, m] = q.month.split('-').map(Number)
        const t = y * 12 + (m - 1) + i
        const month = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`
        return { month, expectedDate: month.slice(0, 8) + '05', businessDays: 21 }
      })),
    })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Nova receita' }))
    const form = await screen.findByRole('dialog', { name: 'Nova receita' })
    await userEvent.click(within(form).getByRole('radio', { name: /Dia do mês/ }))
    expect(await within(form).findByText(/Este mês: 05\/10 \(seg\), já passou: conta como recebida/)).toBeInTheDocument()
    expect(within(form).getByText(/05\/11 \(qui\) · 05\/12 \(sáb\) · 05\/01 \(ter\)/)).toBeInTheDocument()
  })
})

describe('formulário: editar com escopo', () => {
  async function openEdit(id: string) {
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: `Detalhes de ${id}` }))
    await userEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    return screen.findByRole('dialog', { name: 'Editar receita' })
  }

  it('numa receita que se repete, o escopo já vem em "este e os seguintes" e manda só o que mudou', async () => {
    withIncomes()
    const form = await openEdit('Vale-refeição')
    expect(within(form).getByRole('radio', { name: /Este e os seguintes/ })).toBeChecked()
    expect(within(form).getByLabelText('Preço por unidade')).toHaveValue('R$ 65,00')
    expect(within(form).getByLabelText('Quantidade')).toHaveValue(21)
    const preco = within(form).getByLabelText('Preço por unidade')
    await userEvent.clear(preco)
    await userEvent.type(preco, '7200')
    await userEvent.click(within(form).getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() =>
      expect(api.PATCH).toHaveBeenCalledWith('/households/{householdId}/incomes/{incomeId}', {
        params: { path: { householdId: 'h1', incomeId: 'r2' }, query: { scope: 'following' } },
        body: { amountMode: 'per_unit', unitPriceCents: 7200, unitLabel: 'dia trabalhado' },
      }),
    )
  })

  it('mexer na quantidade (de um mês só) volta o escopo sozinho para "só este mês" e explica', async () => {
    withIncomes()
    const form = await openEdit('Vale-refeição')
    const qtd = within(form).getByLabelText('Quantidade')
    expect(qtd).toBeEnabled()
    await userEvent.clear(qtd)
    await userEvent.type(qtd, '19')
    expect(within(form).getByRole('radio', { name: /Só este mês/ })).toBeChecked()
    expect(within(form).getByText(/Você mudou a quantidade, que vale só para um mês: o escopo voltou para "Só este mês"/)).toBeInTheDocument()
    await userEvent.click(within(form).getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() =>
      expect(api.PATCH).toHaveBeenCalledWith('/households/{householdId}/incomes/{incomeId}', {
        params: { path: { householdId: 'h1', incomeId: 'r2' }, query: { scope: 'this' } },
        body: { amountMode: 'per_unit', unitPriceCents: 6500, unitLabel: 'dia trabalhado', quantity: 19 },
      }),
    )
  })

  it('mudar a regra de data manda a regra nova (o servidor recalcula a data)', async () => {
    withIncomes()
    const form = await openEdit('Vale-refeição')
    await userEvent.click(within(form).getByRole('radio', { name: 'N-ésimo dia útil' }))
    const ordem = within(form).getByLabelText('Ordem do dia útil (1 = primeiro)')
    await userEvent.clear(ordem)
    await userEvent.type(ordem, '5')
    await userEvent.click(within(form).getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() =>
      expect(api.PATCH).toHaveBeenCalledWith('/households/{householdId}/incomes/{incomeId}', {
        params: { path: { householdId: 'h1', incomeId: 'r2' }, query: { scope: 'following' } },
        body: { dateRule: { rule: 'nth_business_day', n: 5 } },
      }),
    )
  })

  it('trocar pessoa e tipo vale para os seguintes, como o resto', async () => {
    withIncomes()
    const form = await openEdit('Vale-refeição')
    await userEvent.click(within(form).getByRole('combobox', { name: 'Pessoa' }))
    await userEvent.click(screen.getByRole('option', { name: 'Ana' }))
    await userEvent.click(within(form).getByRole('radio', { name: 'Salário' }))
    await userEvent.click(within(form).getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() =>
      expect(api.PATCH).toHaveBeenCalledWith('/households/{householdId}/incomes/{incomeId}', expect.objectContaining({ body: { userId: 'u2', kind: 'salary' }, params: expect.objectContaining({ query: { scope: 'following' } }) })),
    )
  })

  it('"Só este mês" continua disponível e manda scope=this', async () => {
    withIncomes()
    const form = await openEdit('Vale-refeição')
    await userEvent.click(within(form).getByRole('radio', { name: /Só este mês/ }))
    expect(within(form).getByText('Os outros meses não mudam.')).toBeInTheDocument()
    const preco = within(form).getByLabelText('Preço por unidade')
    await userEvent.clear(preco)
    await userEvent.type(preco, '7200')
    await userEvent.click(within(form).getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() =>
      expect(api.PATCH).toHaveBeenCalledWith('/households/{householdId}/incomes/{incomeId}', expect.objectContaining({ params: expect.objectContaining({ query: { scope: 'this' } }) })),
    )
  })

  it('mudar o mês de competência ou escolher "Data específica" também volta para "só este mês"', async () => {
    withIncomes()
    const form = await openEdit('Vale-refeição')
    await userEvent.click(within(form).getByRole('radio', { name: 'Data específica' }))
    expect(within(form).getByRole('radio', { name: /Só este mês/ })).toBeChecked()
    expect(within(form).getByText(/Você mudou uma data específica, que vale só para um mês/)).toBeInTheDocument()
    // voltar para "este e os seguintes" descarta a data específica e devolve a regra da receita
    await userEvent.click(within(form).getByRole('radio', { name: /Este e os seguintes/ }))
    expect(within(form).getByRole('radio', { name: 'Dia do mês' })).toBeChecked()
    expect(within(form).queryByText(/Você mudou/)).not.toBeInTheDocument()
    await userEvent.click(within(form).getByRole('button', { name: /Mês de competência/ }))
    await userEvent.click(screen.getByRole('button', { name: 'novembro de 2026' }))
    expect(within(form).getByRole('radio', { name: /Só este mês/ })).toBeChecked()
    expect(within(form).getByText(/Você mudou o mês de competência/)).toBeInTheDocument()
  })

  it('numa receita que se repete e já foi recebida, "Aplicar a" aparece em "este e os seguintes" e avisa que o mês não muda', async () => {
    withIncomes()
    const form = await openEdit('Salário Pedro')
    expect(within(form).getByRole('radiogroup', { name: 'Aplicar a' })).toBeInTheDocument()
    expect(within(form).getByRole('radio', { name: /Este e os seguintes/ })).toBeChecked()
    expect(within(form).getByText('Este mês já foi recebido e não muda; os próximos sim.')).toBeInTheDocument()
    const bruto = within(form).getByLabelText('Valor bruto')
    await userEvent.clear(bruto)
    await userEvent.type(bruto, '510000')
    await userEvent.click(within(form).getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() =>
      expect(api.PATCH).toHaveBeenCalledWith('/households/{householdId}/incomes/{incomeId}', expect.objectContaining({ body: { amountMode: 'fixed', grossAmountCents: 510000 }, params: expect.objectContaining({ query: { scope: 'following' } }) })),
    )
  })

  it('numa receita já recebida, escolher "só este mês" corrige o valor só dela', async () => {
    withIncomes()
    const form = await openEdit('Salário Pedro')
    expect(within(form).getByText(/ · já recebida/)).toBeInTheDocument()
    await userEvent.click(within(form).getByRole('radio', { name: /Só este mês/ }))
    const bruto = within(form).getByLabelText('Valor bruto')
    await userEvent.clear(bruto)
    await userEvent.type(bruto, '510000')
    await userEvent.click(within(form).getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() =>
      expect(api.PATCH).toHaveBeenCalledWith('/households/{householdId}/incomes/{incomeId}', expect.objectContaining({ body: { amountMode: 'fixed', grossAmountCents: 510000 }, params: expect.objectContaining({ query: { scope: 'this' } }) })),
    )
  })

  it('vale do mês anterior abre com o mês marcado e trocar para "no mês da competência" manda a regra sem offset', async () => {
    mockApi({ me: ok(me), incomes: ok([vrMesAnterior]), summary: ok(summaryWith()) })
    const form = await openEdit('VR do mês seguinte')
    expect(within(form).getByRole('radio', { name: 'No mês anterior' })).toBeChecked()
    expect(within(form).getByText(/O vale de outubro cai no último dia útil de setembro\./)).toBeInTheDocument()
    await userEvent.click(within(form).getByRole('radio', { name: 'No mês da competência' }))
    expect(within(form).getByText(/O vale de outubro cai no último dia útil de outubro\./)).toBeInTheDocument()
    await userEvent.click(within(form).getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() =>
      expect(api.PATCH).toHaveBeenCalledWith('/households/{householdId}/incomes/{incomeId}', {
        params: { path: { householdId: 'h1', incomeId: 'r5' }, query: { scope: 'following' } },
        body: { dateRule: { rule: 'last_business_day' } },
      }),
    )
  })

  it('sem alterações, salvar só fecha o formulário', async () => {
    withIncomes()
    const form = await openEdit('Salário Ana')
    await userEvent.click(within(form).getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Editar receita' })).not.toBeInTheDocument())
    expect(api.PATCH).not.toHaveBeenCalled()
  })
})

describe('receitas que se repetem', () => {
  const fontes = [
    source({ id: 's1', name: 'Salário Pedro', startMonth: '2026-01-01', dateRule: { rule: 'nth_business_day', n: 2 }, deductions: salarioPedro.deductions }),
    source({ id: 's2', name: 'Vale-refeição', kind: 'benefit', amountMode: 'per_unit', unitPriceCents: 6500, unitLabel: 'dia trabalhado', dateRule: { rule: 'day_of_month', n: 28, weekendAdjust: 'forward' }, startMonth: '2026-01-01' }),
    source({ id: 's9', name: 'Aluguel antigo', startMonth: '2025-01-01', endMonth: '2026-06-01' }),
  ]

  it('fica recolhido no fim da página e lista a regra e o valor de cada repetição', async () => {
    withIncomes({ sources: ok(fontes) })
    renderAt(mes)
    const botao = await screen.findByRole('button', { name: /Receitas que se repetem/ })
    expect(botao).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(botao)
    const lista = screen.getByRole('region', { name: 'Receitas que se repetem' })
    expect(within(lista).getByText(/2º dia útil/)).toBeInTheDocument()
    expect(within(lista).getByText('R$ 4.050,00')).toBeInTheDocument()
    expect(within(lista).getByText('R$ 65,00 por dia trabalhado')).toBeInTheDocument()
    expect(within(lista).getByText('encerrada em 06/2026')).toBeInTheDocument()
  })

  it('"Editar" abre o formulário já em "este e os seguintes"', async () => {
    withIncomes({ sources: ok(fontes) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: /Receitas que se repetem/ }))
    const lista = screen.getByRole('region', { name: 'Receitas que se repetem' })
    await userEvent.click(within(lista).getAllByRole('button', { name: 'Editar' })[1])
    const form = await screen.findByRole('dialog', { name: 'Editar receita' })
    expect(within(form).getByRole('radio', { name: /Este e os seguintes/ })).toBeChecked()
  })

  it('"Encerrar" pede confirmação e mantém o mês exibido', async () => {
    withIncomes({ sources: ok(fontes) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: /Receitas que se repetem/ }))
    const lista = screen.getByRole('region', { name: 'Receitas que se repetem' })
    await userEvent.click(within(lista).getAllByRole('button', { name: 'Encerrar' })[0])
    expect(within(lista).getByText(/Encerrar depois de outubro de 2026\?/)).toBeInTheDocument()
    await userEvent.click(within(lista).getByRole('button', { name: 'Encerrar a repetição' }))
    await waitFor(() =>
      expect(api.PATCH).toHaveBeenCalledWith(
        '/households/{householdId}/income-sources/{sourceId}',
        expect.objectContaining({ params: { path: { householdId: 'h1', sourceId: 's1' }, query: {} }, body: { endMonth: '2026-10-01' } }),
      ),
    )
  })
})

describe('painel do formulário de receita: rolagem', () => {
  it('só o corpo rola, o rodapé sticky não é fixed e a página fica travada enquanto aberto', async () => {
    mockApi({ me: ok(me) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Nova receita' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nova receita' })
    const body = dialog.querySelector('[data-panel-body]')!
    expect(body.className).toMatch(/overflow-y-auto/)
    expect(body.className).toMatch(/overscroll-contain/)
    const submit = within(dialog).getByRole('button', { name: 'Adicionar receita' })
    const footer = submit.closest('div.sticky')!
    expect(body.contains(footer)).toBe(true)
    expect(footer.className).toMatch(/-bottom-5/)
    expect(footer.className).not.toMatch(/\bfixed\b/)
    expect(footer.className).toMatch(/bg-surface/)
    expect(document.body.style.overflow).toBe('hidden')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(document.body.style.overflow).toBe(''))
  })
})

describe('excluir uma repetição', () => {
  const fontes = [source({ id: 's2', name: 'VR (por dia)', kind: 'benefit', amountMode: 'per_unit', unitPriceCents: 6500, unitLabel: 'dia trabalhado', dateRule: { rule: 'day_of_month', n: 28, weekendAdjust: 'forward' }, startMonth: '2026-01-01' })]

  it('pede confirmação clara, exclui e oferece Desfazer que restaura o lote', async () => {
    withIncomes({ sources: ok(fontes) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: /Receitas que se repetem/ }))
    const lista = screen.getByRole('region', { name: 'Receitas que se repetem' })
    await userEvent.click(within(lista).getByRole('button', { name: 'Excluir VR (por dia)' }))
    expect(within(lista).getByText(/Excluir "VR \(por dia\)"\? Os meses já recebidos ficam; os próximos somem\./)).toBeInTheDocument()
    expect(api.DELETE).not.toHaveBeenCalledWith('/households/{householdId}/income-sources/{sourceId}', expect.anything())
    await userEvent.click(within(lista).getByRole('button', { name: 'Excluir a repetição' }))
    await waitFor(() =>
      expect(api.DELETE).toHaveBeenCalledWith('/households/{householdId}/income-sources/{sourceId}', { params: { path: { householdId: 'h1', sourceId: 's2' } } }),
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Desfazer' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/households/{householdId}/income-sources/{sourceId}/restore', { params: { path: { householdId: 'h1', sourceId: 's2' } } }),
    )
  })

  it('Cancelar não exclui nada', async () => {
    withIncomes({ sources: ok(fontes) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: /Receitas que se repetem/ }))
    const lista = screen.getByRole('region', { name: 'Receitas que se repetem' })
    await userEvent.click(within(lista).getByRole('button', { name: 'Excluir VR (por dia)' }))
    await userEvent.click(within(lista).getByRole('button', { name: 'Cancelar' }))
    expect(api.DELETE).not.toHaveBeenCalled()
  })

  it('o detalhe de uma receita que repete também tem "Excluir esta repetição"', async () => {
    withIncomes({ sources: ok(fontes) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Detalhes de Vale-refeição' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Excluir esta repetição' }))
    await userEvent.click(screen.getByRole('button', { name: 'Excluir a repetição' }))
    await waitFor(() =>
      expect(api.DELETE).toHaveBeenCalledWith('/households/{householdId}/income-sources/{sourceId}', { params: { path: { householdId: 'h1', sourceId: 's2' } } }),
    )
  })

  it('viewer não vê o botão Excluir', async () => {
    mockApi({ me: ok(viewerMe), incomes: ok([salarioPedro, vrPedro, salarioAna]), summary: ok(summaryWith()), sources: ok(fontes) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: /Receitas que se repetem/ }))
    const lista = screen.getByRole('region', { name: 'Receitas que se repetem' })
    expect(within(lista).queryByRole('button', { name: /Excluir/ })).not.toBeInTheDocument()
  })
})

describe('computador', () => {
  it('o detalhe abre ao lado da lista, sem janela por cima, e a lista tem colunas', async () => {
    mockDesktop()
    withIncomes()
    renderAt(mes)
    const linha = await screen.findByRole('button', { name: 'Detalhes de Salário Pedro' })
    expect(within(linha).getByText('Pedro', { selector: 'span.hidden' })).toBeInTheDocument()
    await userEvent.click(linha)
    const painel = await screen.findByRole('region', { name: 'Detalhes da receita' })
    expect(within(painel).getByText('2º dia útil')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('as seções "A receber" e "Recebidas" recolhem e lembram a escolha', async () => {
    mockDesktop()
    window.localStorage.clear()
    withIncomes()
    renderAt(mes)
    await screen.findByRole('button', { name: 'Detalhes de Salário Pedro' })
    const aReceber = screen.getByRole('region', { name: 'A receber' })
    expect(within(aReceber).getByRole('button', { name: 'Detalhes de Vale-refeição' })).toBeInTheDocument()
    await userEvent.click(within(aReceber).getByRole('button', { name: /A receber/ }))
    expect(screen.queryByRole('button', { name: 'Detalhes de Vale-refeição' })).not.toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem('prumia.receitas.secoesRecolhidas') ?? '[]')).toEqual(['pending'])
    window.localStorage.clear()
  })

  it('agrupa por pessoa quando pedido', async () => {
    mockDesktop()
    window.localStorage.clear()
    withIncomes()
    renderAt(mes)
    await screen.findByRole('button', { name: 'Detalhes de Salário Pedro' })
    await userEvent.click(screen.getByRole('button', { name: 'Por pessoa' }))
    expect(screen.getByRole('region', { name: 'Ana' })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Pedro' })).getAllByRole('button', { name: /Detalhes de/ })).toHaveLength(2)
    window.localStorage.clear()
  })

  it('ação rápida da linha: "caiu" e "não caiu" sem abrir o detalhe', async () => {
    mockDesktop()
    withIncomes()
    renderAt(mes)
    await screen.findByRole('button', { name: 'Detalhes de Salário Ana' })
    const secao = screen.getByRole('region', { name: 'A receber' })
    const linhaAna = within(secao).getByRole('button', { name: 'Detalhes de Salário Ana' }).closest('li')!
    await userEvent.click(within(linhaAna).getByText('caiu', { selector: 'button', ignore: '' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/households/{householdId}/incomes/{incomeId}/receive', expect.objectContaining({ params: { path: { householdId: 'h1', incomeId: 'r3' } } })),
    )
  })

  it('a tecla N abre o formulário num painel lateral e Esc fecha', async () => {
    mockDesktop()
    withIncomes()
    renderAt(mes)
    await screen.findByRole('button', { name: 'Detalhes de Salário Pedro' })
    await userEvent.keyboard('n')
    expect(await screen.findByRole('dialog', { name: 'Nova receita' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nova receita' })).not.toBeInTheDocument())
  })

  it('setas andam pela lista e Enter abre o detalhe', async () => {
    mockDesktop()
    withIncomes()
    renderAt(mes)
    await screen.findByRole('button', { name: 'Detalhes de Salário Pedro' })
    await userEvent.keyboard('{ArrowDown}')
    // a 1ª linha na ordem das seções ("A receber", na ordem que o servidor mandou)
    expect(screen.getByRole('button', { name: 'Detalhes de Vale-refeição' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('button', { name: 'Detalhes de Salário Ana' })).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('region', { name: 'Detalhes da receita' })).toBeInTheDocument()
  })

  it('o viewer não vê "Nova receita" nem a ação rápida', async () => {
    mockDesktop()
    mockApi({ me: ok(viewerMe), incomes: ok([salarioAna]), summary: ok(summaryWith()) })
    renderAt(mes)
    await screen.findByRole('button', { name: 'Detalhes de Salário Ana' })
    expect(screen.queryByRole('button', { name: 'Nova receita' })).not.toBeInTheDocument()
    expect(screen.queryByText('caiu', { selector: 'button' })).not.toBeInTheDocument()
  })
})
