import { configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import type { DocumentExtraction } from '../api/types'
import { RETRY_DELAYS_MS } from '../lib/importing'
import { fail, me, mockApi, ok, renderAt, viewerMe } from '../test/utils'

configure({ asyncUtilTimeout: 5000 })

// Dados sintéticos (empresa e CNPJ inventados).
const list: DocumentExtraction = {
  kind: 'list', method: 'ocr',
  items: [
    { description: 'Gás', amountCents: 15782 },
    { description: 'Mercado', amountCents: 56899 },
    { description: 'Ração gatos', amountCents: 19999 },
  ],
}
const bill: DocumentExtraction = {
  kind: 'bill', method: 'pdf_text',
  items: [{ description: 'Gasco Distribuidora SA', amountCents: 13043, dueDate: '2026-07-17', competenceMonth: '2026-06-01', beneficiaryName: 'Gasco Distribuidora SA', beneficiaryCnpj: '11222333000181' }],
}
const line = '0'.repeat(47)
const dupBoleto: DocumentExtraction = {
  kind: 'boleto', method: 'pdf_text',
  items: [{ description: 'Loja', amountCents: 100, boleto: { digitableLine: line }, duplicateOfInvoiceId: 'i9' }],
}

const png = (name: string) => new File(['\x89PNG'], name, { type: 'image/png' })
const pdf = (name: string) => new File(['%PDF-1.4'], name, { type: 'application/pdf' })
const batchCalls = () =>
  (vi.mocked(api.POST).mock.calls as unknown as Array<[string, { body: { items: Record<string, unknown>[] } }]>).filter(([url]) => url === '/households/{householdId}/invoices/batch')
const extractCalls = () =>
  (vi.mocked(api.POST).mock.calls as unknown as Array<[string, { body: { file: File; password?: string } }]>).filter(([url]) => url === '/households/{householdId}/documents/extract')

const saved = [...RETRY_DELAYS_MS]
beforeEach(() => {
  vi.restoreAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 22, 12))
  RETRY_DELAYS_MS.splice(0, RETRY_DELAYS_MS.length, 5, 5, 5)
})
afterEach(() => {
  vi.useRealTimers()
  RETRY_DELAYS_MS.splice(0, RETRY_DELAYS_MS.length, ...saved)
})

async function pick(user: ReturnType<typeof userEvent.setup>, ...files: File[]) {
  const input = await screen.findByLabelText('Arquivos para importar')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Escolher arquivos' })).toBeEnabled())
  await user.upload(input, files)
}

describe('importar contas', () => {
  it('lê vários arquivos em sequência, sugere categoria e cria tudo num lote', async () => {
    const user = userEvent.setup()
    mockApi({ me: ok(me), extractDocument: ({ file }) => ok(file.name === 'lista.png' ? list : bill) })
    renderAt('/importar')
    await pick(user, png('lista.png'), pdf('luz.pdf'))

    expect(await screen.findByText(/2 arquivos lidos · 4 contas/i)).toBeInTheDocument()
    expect(extractCalls().map(([, init]) => init.body.file.name)).toEqual(['lista.png', 'luz.pdf'])

    const rows = screen.getAllByRole('listitem', { name: /^Conta \d/ })
    expect(rows).toHaveLength(4)
    // item da lista lido por OCR: selo pede conferência; categoria casada pelo nome
    expect(within(rows[1]).getByText(/OCR: confira/)).toBeInTheDocument()
    expect(within(rows[1]).getByLabelText('Categoria (sugerida)')).toHaveValue('c2')
    expect(within(rows[0]).getByLabelText('Vencimento')).toHaveValue('22/10/2026')
    // conta sem boleto: vencimento e competência do documento; oferece cadastrar o favorecido do CNPJ
    expect(within(rows[3]).getByText('conta')).toBeInTheDocument()
    expect(within(rows[3]).getByLabelText('Vencimento')).toHaveValue('17/07/2026')
    expect(within(rows[3]).getByLabelText('Competência')).toHaveTextContent(/junho de 2026/i)
    await user.type(within(rows[3]).getByLabelText(/Apelido do favorecido/), 'Gás')

    // tira uma linha do lote e corrige a descrição de outra
    await user.click(within(rows[2]).getByRole('checkbox', { name: 'criar' }))
    const desc = within(rows[0]).getByLabelText('Descrição')
    await user.clear(desc)
    await user.type(desc, 'Gás de cozinha')

    await user.click(screen.getByRole('button', { name: 'Criar 3 contas' }))
    await waitFor(() => expect(batchCalls()).toHaveLength(1))
    const items = batchCalls()[0][1].body.items
    expect(items).toEqual([
      { categoryId: 'c1', description: 'Gás de cozinha', amountCents: 15782, dueDate: '2026-10-22', competenceMonth: '2026-10-01' },
      { categoryId: 'c2', description: 'Mercado', amountCents: 56899, dueDate: '2026-10-22', competenceMonth: '2026-10-01' },
      {
        categoryId: 'c1', description: 'Gasco Distribuidora SA', amountCents: 13043, dueDate: '2026-07-17', competenceMonth: '2026-06-01',
        newPayee: { name: 'Gás', cnpj: '11222333000181', legalName: 'Gasco Distribuidora SA' },
      },
    ])
    // volta ao mês da primeira conta, com aviso e "Desfazer"
    expect(await screen.findByText('3 contas criadas.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desfazer' })).toBeInTheDocument()
  })

  it('espera e tenta de novo quando o servidor pede calma (429)', async () => {
    const user = userEvent.setup()
    let n = 0
    mockApi({ me: ok(me), extractDocument: () => (++n === 1 ? fail(429, 'too_many_requests') : ok(bill)) })
    renderAt('/importar')
    await pick(user, pdf('luz.pdf'))
    expect(await screen.findByText(/1 arquivo lido · 1 conta/i)).toBeInTheDocument()
    expect(extractCalls()).toHaveLength(2)
  })

  it('pede a senha do PDF sem travar os outros arquivos', async () => {
    const user = userEvent.setup()
    mockApi({
      me: ok(me),
      extractDocument: ({ file, password }) =>
        file.name === 'fatura.pdf' ? (password === 'segredo' ? ok(bill) : fail(422, password ? 'wrong_password' : 'password_required')) : ok(list),
    })
    renderAt('/importar')
    await pick(user, pdf('fatura.pdf'), png('lista.png'))
    expect(await screen.findByText(/2 arquivos lidos · 3 contas/i)).toBeInTheDocument()

    await user.type(screen.getByLabelText('Senha do PDF'), 'segredo')
    await user.click(screen.getByRole('button', { name: 'Abrir' }))
    expect(await screen.findByText(/2 arquivos lidos · 4 contas/i)).toBeInTheDocument()
    expect(extractCalls().at(-1)?.[1].body.password).toBe('segredo')
  })

  it('arquivo sem conta mostra o motivo; boleto já lançado fica de fora até pedir', async () => {
    const user = userEvent.setup()
    mockApi({ me: ok(me), extractDocument: ({ file }) => (file.name === 'foto.jpg' ? fail(422, 'boleto_not_found') : ok(dupBoleto)) })
    renderAt('/importar')
    await pick(user, new File(['\xff\xd8\xff'], 'foto.jpg', { type: 'image/jpeg' }), pdf('boleto.pdf'))
    expect(await screen.findByText(/Não encontrei boleto nem valor/)).toBeInTheDocument()
    expect(await screen.findByText(/Já existe uma conta com este boleto/)).toBeInTheDocument()
    const create = screen.getByRole('button', { name: 'Criar 0 contas' })
    expect(create).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: 'criar' }))
    expect(screen.getByRole('button', { name: 'Criar 1 conta' })).toBeEnabled()
  })

  it('erro de um item do lote aparece na linha certa', async () => {
    const user = userEvent.setup()
    mockApi({ me: ok(me), extractDocument: ok(list), createBatch: fail(400, 'validation_error', { 'items.1.categoryId': 'categoria inválida ou arquivada' }) })
    renderAt('/importar')
    await pick(user, png('lista.png'))
    await user.click(await screen.findByRole('button', { name: 'Criar 3 contas' }))
    const rows = screen.getAllByRole('listitem', { name: /^Conta \d/ })
    expect(await within(rows[1]).findByText('categoria inválida ou arquivada')).toBeInTheDocument()
    expect(screen.getByText('Confira as contas marcadas.')).toBeInTheDocument()
  })

  it('papel de leitura não importa', async () => {
    mockApi({ me: ok(viewerMe) })
    renderAt('/importar')
    expect(await screen.findByText(/somente leitura/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Arquivos para importar')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Colar texto/ })).not.toBeInTheDocument()
  })
})

const parseCalls = () =>
  (vi.mocked(api.POST).mock.calls as unknown as Array<[string, { body: { text: string } }]>).filter(([url]) => url === '/households/{householdId}/documents/parse-text')

// Texto sintético no padrão "descrição: valor".
const textList: DocumentExtraction = {
  kind: 'list', method: 'text',
  items: [
    { description: 'Gás', amountCents: 15000 },
    { description: 'Mercado', amountCents: 31025 },
  ],
}

async function paste(user: ReturnType<typeof userEvent.setup>, text: string) {
  await waitFor(() => expect(screen.getByRole('button', { name: /Colar texto/ })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: /Colar texto/ }))
  await user.click(screen.getByLabelText('Texto das contas'))
  await user.paste(text)
  await user.click(screen.getByRole('button', { name: 'Ler texto' }))
}

describe('importar contas colando texto', () => {
  it('lê o texto e mostra as contas na mesma tabela de revisão', async () => {
    const user = userEvent.setup()
    mockApi({ me: ok(me), parseText: ok(textList) })
    renderAt('/importar')
    expect(await screen.findByText(/descrição: valor/, { selector: 'strong' })).toBeInTheDocument()
    await paste(user, 'Gás: R$ 150,00\nMercado: 310,25')

    expect(await screen.findByText(/1 arquivo lido · 2 contas/i)).toBeInTheDocument()
    expect(parseCalls()).toHaveLength(1)
    expect(parseCalls()[0][1].body.text).toBe('Gás: R$ 150,00\nMercado: 310,25')
    expect(screen.getByRole('button', { name: 'texto' })).toBeInTheDocument()
    const rows = screen.getAllByRole('listitem', { name: /^Conta \d/ })
    expect(rows).toHaveLength(2)
    expect(within(rows[1]).getByLabelText('Descrição')).toHaveValue('Mercado')
    // não é OCR: sem o selo de conferência
    expect(screen.queryByText(/OCR: confira/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Criar 2 contas' }))
    await waitFor(() => expect(batchCalls()).toHaveLength(1))
    expect(batchCalls()[0][1].body.items).toHaveLength(2)
  })

  it('texto sem contas mostra o motivo', async () => {
    const user = userEvent.setup()
    mockApi({ me: ok(me), parseText: fail(422, 'boleto_not_found') })
    renderAt('/importar')
    await paste(user, 'Bom dia!')
    expect(await screen.findByText(/Não encontrei contas neste texto/)).toBeInTheDocument()
  })

  it('texto grande demais (413) avisa o limite', async () => {
    const user = userEvent.setup()
    mockApi({ me: ok(me), parseText: fail(413, 'text_too_large') })
    renderAt('/importar')
    await paste(user, 'Gás: 98,40')
    expect(await screen.findByText(/passa de 20\.000 caracteres/)).toBeInTheDocument()
  })

  it('espera e tenta de novo quando o servidor pede calma (429)', async () => {
    const user = userEvent.setup()
    let n = 0
    mockApi({ me: ok(me), parseText: () => (++n === 1 ? fail(429, 'too_many_requests') : ok(textList)) })
    renderAt('/importar')
    await paste(user, 'Gás: R$ 150,00\nMercado: 310,25')
    expect(await screen.findByText(/1 arquivo lido · 2 contas/i)).toBeInTheDocument()
    expect(parseCalls()).toHaveLength(2)
  })

  it('o vencimento usa o calendário do app: ano de 5 dígitos não passa, e o lote não sai com data torta', async () => {
    const user = userEvent.setup()
    mockApi({ me: ok(me), parseText: ok(list) })
    renderAt('/importar')
    await paste(user, 'Gás: R$ 150,00')
    const row = (await screen.findAllByRole('listitem', { name: /^Conta \d/ }))[0]
    const venc = within(row).getByLabelText('Vencimento')
    await user.clear(venc)
    await user.type(venc, '221020266')
    // a máscara corta no ano de 4 dígitos
    expect(venc).toHaveValue('22/10/2026')
    await user.click(screen.getByRole('button', { name: /^Criar \d+ contas?$/ }))
    const bodies = batchCalls().map(([, init]) => (init as { body: { items: { dueDate: string }[] } }).body.items.map((i) => i.dueDate))
    for (const dates of bodies) for (const d of dates) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('a competência acompanha o vencimento enquanto não foi escolhida à parte', async () => {
    const user = userEvent.setup()
    mockApi({ me: ok(me), parseText: ok(list) })
    renderAt('/importar')
    await paste(user, 'Gás: R$ 150,00')
    const row = (await screen.findAllByRole('listitem', { name: /^Conta \d/ }))[0]
    const venc = within(row).getByLabelText('Vencimento')
    await user.clear(venc)
    await user.type(venc, '05112026')
    expect(venc).toHaveValue('05/11/2026')
    expect(within(row).getByLabelText('Competência')).toHaveTextContent(/novembro de 2026/i)
  })

  it('item de lista com vencimento vem com a data e a competência do mês dela', async () => {
    const user = userEvent.setup()
    mockApi({
      me: ok(me),
      parseText: ok({ kind: 'list', method: 'text', items: [{ description: 'Luz', amountCents: 21035, dueDate: '2026-11-10' }, { description: 'Gás', amountCents: 15000 }] } as DocumentExtraction),
    })
    renderAt('/importar')
    await paste(user, 'Luz: R$ 210,35 vence 10/11\nGás: R$ 150,00')
    const rows = await screen.findAllByRole('listitem', { name: /^Conta \d/ })
    expect(within(rows[0]).getByLabelText('Vencimento')).toHaveValue('10/11/2026')
    expect(within(rows[0]).getByLabelText('Competência')).toHaveTextContent(/novembro de 2026/i)
    // sem data na linha: hoje
    expect(within(rows[1]).getByLabelText('Vencimento')).toHaveValue('22/10/2026')
  })

  it('400 genérico do servidor mostra uma mensagem que explica (não o "algo deu errado")', async () => {
    const user = userEvent.setup()
    mockApi({ me: ok(me), parseText: ok(list), createBatch: fail(400, 'bad_request') })
    renderAt('/importar')
    await paste(user, 'Gás: R$ 150,00')
    await screen.findAllByRole('listitem', { name: /^Conta \d/ })
    await user.click(screen.getByRole('button', { name: /^Criar \d+ contas?$/ }))
    expect(await screen.findByText(/formato inválido \(data, mês ou valor\)/)).toBeInTheDocument()
  })

  it('429 que não passa vira erro com "Tentar de novo"', async () => {
    const user = userEvent.setup()
    mockApi({ me: ok(me), parseText: fail(429, 'too_many_requests') })
    renderAt('/importar')
    await paste(user, 'Gás: R$ 150,00')
    expect(await screen.findByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument()
  })

  it('papel de leitura não vê "Colar texto"', async () => {
    mockApi({ me: ok(viewerMe) })
    renderAt('/importar')
    expect(await screen.findByText(/somente leitura/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Texto das contas')).not.toBeInTheDocument()
  })
})
