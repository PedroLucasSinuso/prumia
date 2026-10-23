import { configure, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import type { Purchase, Recurrence } from '../api/types'
import { invoice, mockApi, ok, me, renderAt, viewerMe } from '../test/utils'

// A tela é carregada sob demanda (lazy): com a máquina carregada (ou o CI), o primeiro render pode passar de 1 s.
configure({ asyncUtilTimeout: 5000 })

const mes = '/?mes=2026-10'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 20, 12))
})
afterEach(() => vi.useRealTimers())

const abrir = async () => userEvent.click(await screen.findByRole('button', { name: 'Nova conta' }))

describe('lançar parcelada e fixa', () => {
  it('compra parcelada: 6x de R$ 660 cria uma compra só', async () => {
    mockApi({ me: ok(me), createPurchase: ok({}) })
    renderAt(mes)
    await abrir()
    await userEvent.click(screen.getByRole('button', { name: 'parcelada' }))
    await userEvent.type(screen.getByLabelText('Descrição'), 'Notebook')
    await userEvent.type(screen.getByLabelText('Valor de cada parcela'), '66000')
    expect(screen.getByText(/6x de R\$ 660,00 = R\$ 3\.960,00/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar compra parcelada' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        '/households/{householdId}/purchases',
        expect.objectContaining({
          body: {
            categoryId: 'c1', description: 'Notebook', purchaseDate: '2026-10-20', firstDueDate: '2026-10-20',
            installmentsCount: 6, totalAmountCents: 396000, installmentAmountCents: 66000,
          },
        }),
      ),
    )
  })

  it('informar o total deixa o servidor dividir (sem installmentAmountCents)', async () => {
    mockApi({ me: ok(me), createPurchase: ok({}) })
    renderAt(mes)
    await abrir()
    await userEvent.click(screen.getByRole('button', { name: 'parcelada' }))
    await userEvent.click(screen.getByRole('button', { name: 'total da compra' }))
    await userEvent.type(screen.getByLabelText('Descrição'), 'Sofá')
    await userEvent.type(screen.getByLabelText('Valor total da compra'), '100000')
    const parcelas = screen.getByLabelText('Parcelas')
    await userEvent.clear(parcelas)
    await userEvent.type(parcelas, '3')
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar compra parcelada' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        '/households/{householdId}/purchases',
        expect.objectContaining({ body: expect.objectContaining({ totalAmountCents: 100000, installmentsCount: 3 }) }),
      ),
    )
    const body = (api.POST as unknown as { mock: { calls: Array<[string, { body: Record<string, unknown> }]> } }).mock.calls.find((c) => c[0].endsWith('/purchases'))![1].body
    expect(body).not.toHaveProperty('installmentAmountCents')
  })

  it('conta fixa: usa o dia do vencimento e começa neste mês', async () => {
    mockApi({ me: ok(me), createRecurrence: ok({}) })
    renderAt(mes)
    await abrir()
    await userEvent.click(screen.getByRole('button', { name: 'fixa todo mês' }))
    await userEvent.type(screen.getByLabelText('Descrição'), 'Internet')
    await userEvent.type(screen.getByLabelText('Valor'), '9990')
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar conta fixa' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        '/households/{householdId}/recurrences',
        expect.objectContaining({ body: { categoryId: 'c1', description: 'Internet', amountCents: 9990, dayOfMonth: 20, startMonth: '2026-10-01' } }),
      ),
    )
  })
})

const parcela = invoice({
  id: 'p3', description: 'Notebook (3/6)', amountCents: 66000, dueDate: '2026-10-25',
  series: { kind: 'installment', purchaseId: 'pu1', installmentNumber: 3, installmentsCount: 6 },
})

describe('parcela no mês', () => {
  it('mostra a etiqueta 3/6 e a de conta fixa', async () => {
    const fixa = invoice({ id: 'f1', description: 'Internet', series: { kind: 'recurrence', recurrenceId: 'r1' } })
    mockApi({ me: ok(me), invoices: ok({ items: [parcela, fixa] }) })
    renderAt(mes)
    expect(await screen.findByText('3/6')).toBeInTheDocument()
    expect(screen.getByText('fixa')).toBeInTheDocument()
  })

  it('"esta e as seguintes" manda o escopo, a descrição-base e não manda data', async () => {
    mockApi({ me: ok(me), invoices: ok({ items: [parcela] }) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Detalhes de Notebook (3/6)' }))
    await userEvent.click(screen.getByRole('button', { name: 'esta e as seguintes' }))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(api.PATCH).toHaveBeenCalled())
    const [, args] = (api.PATCH as unknown as { mock: { calls: Array<[string, { params: { query: { scope: string } }; body: Record<string, unknown> }]> } }).mock.calls[0]
    expect(args.params.query).toEqual({ scope: 'following' })
    expect(args.body.description).toBe('Notebook')
    expect(args.body).not.toHaveProperty('dueDate')
    expect(args.body).not.toHaveProperty('competenceMonth')
  })

  it('só esta mantém a descrição e a data', async () => {
    mockApi({ me: ok(me), invoices: ok({ items: [parcela] }) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Detalhes de Notebook (3/6)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(api.PATCH).toHaveBeenCalledWith(
      '/households/{householdId}/invoices/{invoiceId}',
      expect.objectContaining({ params: { path: { householdId: 'h1', invoiceId: 'p3' }, query: { scope: 'this' } }, body: expect.objectContaining({ dueDate: '2026-10-25', description: 'Notebook (3/6)' }) }),
    ))
  })

  it('exclui esta e as seguintes', async () => {
    mockApi({ me: ok(me), invoices: ok({ items: [parcela] }) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Detalhes de Notebook (3/6)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Excluir esta e as seguintes' }))
    await waitFor(() =>
      expect(api.DELETE).toHaveBeenCalledWith('/households/{householdId}/invoices/{invoiceId}', { params: { path: { householdId: 'h1', invoiceId: 'p3' }, query: { scope: 'following' } } }),
    )
    expect(await screen.findByText('Esta e as seguintes foram excluídas.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Desfazer' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        '/households/{householdId}/invoices/{invoiceId}/restore',
        { params: { path: { householdId: 'h1', invoiceId: 'p3' }, query: { scope: 'following' } } },
      ),
    )
  })

  it('conta avulsa não mostra a escolha de escopo', async () => {
    mockApi({ me: ok(me), invoices: ok({ items: [invoice({ id: 'a', description: 'Luz' })] }) })
    renderAt(mes)
    await userEvent.click(await screen.findByRole('button', { name: 'Detalhes de Luz' }))
    expect(screen.queryByRole('button', { name: 'esta e as seguintes' })).not.toBeInTheDocument()
  })
})

const compra: Purchase = {
  id: 'pu1', categoryId: 'c1', description: 'Notebook', purchaseDate: '2026-08-10', totalAmountCents: 396000, installmentsCount: 6,
  installments: [
    { ...parcela, id: 'x1', status: 'paid', dueDate: '2026-08-25', series: { kind: 'installment', purchaseId: 'pu1', installmentNumber: 1, installmentsCount: 6 } },
    { ...parcela, id: 'x2', dueDate: '2026-09-25', series: { kind: 'installment', purchaseId: 'pu1', installmentNumber: 2, installmentsCount: 6 } },
  ],
}
const aluguel: Recurrence = { id: 'r1', categoryId: 'c1', description: 'Aluguel', amountCents: 150000, dayOfMonth: 5, startMonth: '2026-01-01' }

describe('parcelas e contas fixas', () => {
  it('lista a compra com parcelas e a conta fixa', async () => {
    mockApi({ me: ok(me), purchases: ok({ items: [compra] }), recurrences: ok([aluguel]) })
    renderAt('/parcelas')
    expect(await screen.findByText('Notebook')).toBeInTheDocument()
    expect(screen.getByText(/comprada em .*2026/)).toBeInTheDocument()
    expect(screen.getByText('6x R$ 660,00')).toBeInTheDocument()
    expect(screen.getByText(/1 de 6 pagas/)).toBeInTheDocument()
    expect(screen.getByText(/todo dia 5/)).toBeInTheDocument()
    expect(screen.getByText(/sem fim/)).toBeInTheDocument()
  })

  it('a lista já traz as parcelas: expande e mostra cada uma com o status', async () => {
    const vazia: Purchase = { ...compra, id: 'pu2', description: 'Sofá', installments: [] }
    mockApi({ me: ok(me), purchases: ok({ items: [compra, vazia] }) })
    renderAt('/parcelas')
    await userEvent.click(await screen.findByText('Notebook'))
    const lista = screen.getByRole('list', { name: 'Parcelas de Notebook' })
    expect(lista).toHaveTextContent('[ ▪ ] 1/6')
    expect(lista).toHaveTextContent('[ ▫ ] 2/6')
    // compra com todas as parcelas excluídas: "0 de 6" e o aviso, sem lista
    expect(screen.getByText(/0 de 6 pagas/)).toBeInTheDocument()
    await userEvent.click(screen.getByText('Sofá'))
    expect(screen.getByText('Todas as parcelas foram excluídas.')).toBeInTheDocument()
    // uma consulta só (a lista), nenhuma busca de detalhe por compra
    expect(api.GET).not.toHaveBeenCalledWith('/households/{householdId}/purchases/{purchaseId}', expect.anything())
  })

  it('busca "quando comprei o notebook?" consulta o servidor com q', async () => {
    mockApi({ me: ok(me), purchases: ok({ items: [compra] }) })
    renderAt('/parcelas')
    await userEvent.type(await screen.findByLabelText('Buscar compra'), 'note')
    await waitFor(() =>
      expect(api.GET).toHaveBeenCalledWith('/households/{householdId}/purchases', expect.objectContaining({ params: expect.objectContaining({ query: { q: 'note', limit: 100 } }) })),
    )
  })

  it('cria uma compra parcelada direto da tela de parcelas, já no tipo parcelada', async () => {
    mockApi({ me: ok(me), createPurchase: ok({}) })
    renderAt('/parcelas')
    await userEvent.click(await screen.findByRole('button', { name: 'Nova compra parcelada' }))
    expect(await screen.findByRole('button', { name: 'parcelada' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.type(screen.getByLabelText('Descrição'), 'Geladeira')
    await userEvent.type(screen.getByLabelText('Valor de cada parcela'), '50000')
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar compra parcelada' }))
    await waitFor(() => expect(api.POST).toHaveBeenCalledWith('/households/{householdId}/purchases', expect.anything()))
  })

  it('"Nova conta fixa" abre o formulário no tipo fixa; leitura não vê os botões', async () => {
    mockApi({ me: ok(me) })
    renderAt('/parcelas')
    await userEvent.click(await screen.findByRole('button', { name: 'Nova conta fixa' }))
    expect(await screen.findByRole('button', { name: 'fixa todo mês' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('leitura não vê os botões de criar', async () => {
    mockApi({ me: ok(viewerMe) })
    renderAt('/parcelas')
    await screen.findByRole('heading', { name: /Parcelas/ })
    expect(screen.queryByRole('button', { name: 'Nova compra parcelada' })).not.toBeInTheDocument()
  })

  it('edita o valor da conta fixa', async () => {
    mockApi({ me: ok(me), recurrences: ok([aluguel]) })
    renderAt('/parcelas')
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Aluguel' }))
    const valor = screen.getByLabelText('Valor')
    await userEvent.clear(valor)
    await userEvent.type(valor, '160000')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(api.PATCH).toHaveBeenCalledWith(
        '/households/{householdId}/recurrences/{recurrenceId}',
        expect.objectContaining({ body: expect.objectContaining({ amountCents: 160000, dayOfMonth: 5 }) }),
      ),
    )
  })

  it('leitura não vê o botão de salvar da conta fixa', async () => {
    mockApi({ me: ok(viewerMe), recurrences: ok([aluguel]) })
    renderAt('/parcelas')
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Aluguel' }))
    expect(screen.queryByRole('button', { name: 'Salvar' })).not.toBeInTheDocument()
  })
})
