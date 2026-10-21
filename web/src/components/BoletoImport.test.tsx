import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import type { BoletoExtraction } from '../api/types'
import { fail, invoice, me, mockApi, ok, renderAt } from '../test/utils'

// Linha digitável de 47 dígitos (boleto bancário).
const line = '00190' + '00009' + '01234' + '567890' + '12345' + '678901' + '2' + '12340000010000'
const grouped = '00190.00009 01234.567890 12345.678901 2 12340000010000'

const extraction = (over: Partial<BoletoExtraction> = {}): BoletoExtraction => ({
  boleto: {
    digitableLine: line, barcode: '00192123400000100000000901234567891234567890',
    beneficiaryName: 'Companhia de Luz', documentAmountCents: 18990, documentDueDate: '2026-10-28',
  },
  method: 'pdf_text',
  ...over,
})

const pdf = () => new File(['%PDF-1.4'], 'boleto.pdf', { type: 'application/pdf' })
const extractCalls = () =>
  (vi.mocked(api.POST).mock.calls as unknown as Array<[string, unknown]>).filter(([url]) => url === '/households/{householdId}/boletos/extract')

beforeEach(() => {
  vi.restoreAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 20, 12))
})
afterEach(() => vi.useRealTimers())

async function openNew(user: ReturnType<typeof userEvent.setup>) {
  renderAt('/?mes=2026-10')
  await user.click(await screen.findByRole('button', { name: 'Nova conta' }))
  return screen.getByRole('dialog')
}

describe('importar boleto', () => {
  it('lê o arquivo, pré-preenche o formulário e envia o boleto junto ao salvar', async () => {
    const user = userEvent.setup()
    mockApi({ me: ok(me), extract: ok(extraction()), create: ok(invoice({ id: 'n1', description: 'Companhia de Luz' })) })
    const dialog = await openNew(user)

    await user.upload(within(dialog).getByLabelText('Arquivo do boleto'), pdf())

    const review = await within(dialog).findByRole('region', { name: 'Conferir antes de salvar' })
    expect(within(review).getByText(grouped)).toBeInTheDocument()
    expect(within(review).getByText(/Companhia de Luz/)).toBeInTheDocument()
    expect(within(review).getByText(/lido do texto do PDF/)).toBeInTheDocument()
    expect(within(dialog).getByLabelText('O que é')).toHaveValue('Companhia de Luz')
    expect(within(dialog).getByLabelText('Data de vencimento')).toHaveValue('2026-10-28')
    expect(within(dialog).getByLabelText('Valor')).toHaveValue('R$ 189,90')

    const [, init] = extractCalls()[0] as [string, { body: { file: File; password?: string } }]
    expect(init.body.file.name).toBe('boleto.pdf')
    expect(init.body.password).toBeUndefined()

    await user.click(within(dialog).getByRole('button', { name: 'Adicionar conta' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        '/households/{householdId}/invoices',
        expect.objectContaining({
          body: expect.objectContaining({
            description: 'Companhia de Luz', amountCents: 18990, dueDate: '2026-10-28',
            boleto: { digitableLine: line, beneficiaryName: 'Companhia de Luz' },
          }),
        }),
      ),
    )
  })

  it('não troca a descrição que a pessoa já digitou', async () => {
    const user = userEvent.setup()
    mockApi({ me: ok(me), extract: ok(extraction()) })
    const dialog = await openNew(user)
    await user.type(within(dialog).getByLabelText('O que é'), 'Luz de casa')
    await user.upload(within(dialog).getByLabelText('Arquivo do boleto'), pdf())
    await within(dialog).findByRole('region', { name: 'Conferir antes de salvar' })
    expect(within(dialog).getByLabelText('O que é')).toHaveValue('Luz de casa')
  })

  it('PDF com senha: pede a senha, reenvia e limpa o campo', async () => {
    const user = userEvent.setup()
    mockApi({
      me: ok(me),
      extract: (body) => (body.password === '12345' ? ok(extraction({ method: 'ocr' })) : fail(422, body.password ? 'wrong_password' : 'password_required')),
    })
    const dialog = await openNew(user)
    await user.upload(within(dialog).getByLabelText('Arquivo do boleto'), pdf())

    const senha = await within(dialog).findByLabelText('Senha do PDF')
    await user.type(senha, '999')
    await user.click(within(dialog).getByRole('button', { name: 'Abrir PDF' }))
    expect(await within(dialog).findByText('Senha incorreta. Confira e tente de novo.')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Senha do PDF')).toHaveValue('')

    await user.type(within(dialog).getByLabelText('Senha do PDF'), '12345{Enter}')
    expect(await within(dialog).findByText(/lido por OCR: confira os números/)).toBeInTheDocument()
    const sent = extractCalls().map(([, init]) => (init as { body: { password?: string } }).body.password)
    expect(sent).toEqual([undefined, '999', '12345'])
    // Enter no campo da senha não cria a conta
    expect(api.POST).not.toHaveBeenCalledWith('/households/{householdId}/invoices', expect.anything())
  })

  it('falha na leitura: explica e oferece tentar de novo ou preencher à mão', async () => {
    const user = userEvent.setup()
    mockApi({ me: ok(me), extract: fail(422, 'boleto_not_found') })
    const dialog = await openNew(user)
    await user.upload(within(dialog).getByLabelText('Arquivo do boleto'), pdf())

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Não consegui ler este boleto')
    expect(within(dialog).getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Preencher manualmente' }))
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(dialog).getByLabelText('O que é')).toHaveFocus()
    expect(within(dialog).getByRole('button', { name: 'Importar boleto' })).toBeInTheDocument()
  })

  it('arquivo que não é PDF/PNG/JPG tem texto próprio', async () => {
    const user = userEvent.setup()
    mockApi({ me: ok(me), extract: fail(422, 'unsupported_file') })
    const dialog = await openNew(user)
    await user.upload(within(dialog).getByLabelText('Arquivo do boleto'), pdf())
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('não é PDF, PNG ou JPG')
  })

  it('linha digitável recusada ao salvar aparece junto ao boleto', async () => {
    const user = userEvent.setup()
    mockApi({ me: ok(me), extract: ok(extraction()), create: fail(400, 'validation_error', { 'boleto.digitableLine': 'invalid' }) })
    const dialog = await openNew(user)
    await user.upload(within(dialog).getByLabelText('Arquivo do boleto'), pdf())
    await within(dialog).findByRole('region', { name: 'Conferir antes de salvar' })
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar conta' }))
    expect(await within(dialog).findByText(/linha digitável deste boleto é inválida/)).toBeInTheDocument()
  })

  it('arquivo grande demais nem é enviado', async () => {
    const user = userEvent.setup()
    mockApi({ me: ok(me) })
    const dialog = await openNew(user)
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'grande.pdf', { type: 'application/pdf' })
    await user.upload(within(dialog).getByLabelText('Arquivo do boleto'), big)
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('passa de 5 MB')
    expect(extractCalls()).toHaveLength(0)
  })

  it('muitas tentativas (429) tem texto próprio', async () => {
    const user = userEvent.setup()
    mockApi({ me: ok(me), extract: fail(429, 'too_many_requests') })
    const dialog = await openNew(user)
    await user.upload(within(dialog).getByLabelText('Arquivo do boleto'), pdf())
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Muitas tentativas')
    // o mesmo arquivo pode ser reenviado
    await user.click(within(dialog).getByRole('button', { name: 'Tentar de novo' }))
    await waitFor(() => expect(extractCalls()).toHaveLength(2))
  })

  it('boleto já cadastrado: avisa, abre a conta existente ou fecha o aviso', async () => {
    const user = userEvent.setup()
    const existing = invoice({ id: 'old', description: 'Luz de setembro', competenceMonth: '2026-10-01', boleto: extraction().boleto })
    mockApi({ me: ok(me), extract: ok(extraction({ duplicateOfInvoiceId: 'old' })), invoices: ok({ items: [existing] }), invoiceDetail: ok(existing) })
    const dialog = await openNew(user)
    await user.upload(within(dialog).getByLabelText('Arquivo do boleto'), pdf())

    const aviso = await within(dialog).findByRole('alert')
    expect(aviso).toHaveTextContent('Já existe uma conta com este boleto')
    await user.click(within(aviso).getByRole('button', { name: 'Fechar aviso' }))
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()

    // de novo, agora abrindo a conta existente
    await user.upload(within(dialog).getByLabelText('Arquivo do boleto'), pdf())
    await user.click(within(await within(dialog).findByRole('alert')).getByRole('button', { name: 'Abrir a conta' }))
    expect(await screen.findByRole('dialog', { name: 'Detalhes da conta' })).toBeInTheDocument()
    expect(screen.getByLabelText('O que é')).toHaveValue('Luz de setembro')
  })

  it('copiar linha digitável copia só os dígitos e avisa', async () => {
    const user = userEvent.setup()
    const write = vi.spyOn(navigator.clipboard, 'writeText')
    mockApi({ me: ok(me), extract: ok(extraction()) })
    const dialog = await openNew(user)
    await user.upload(within(dialog).getByLabelText('Arquivo do boleto'), pdf())
    await user.click(await within(dialog).findByRole('button', { name: 'Copiar linha digitável' }))
    expect(write).toHaveBeenCalledWith(line)
    expect(await screen.findByText('Linha digitável copiada.')).toBeInTheDocument()
  })

  it('na edição, uma conta com boleto mostra a linha digitável para copiar', async () => {
    const user = userEvent.setup()
    const comBoleto = invoice({ id: 'b1', description: 'Internet', boleto: extraction().boleto })
    mockApi({ me: ok(me), invoices: ok({ items: [comBoleto] }) })
    renderAt('/?mes=2026-10')
    await user.click(await screen.findByRole('button', { name: 'Detalhes de Internet' }))
    const box = within(screen.getByRole('dialog')).getByRole('region', { name: 'Boleto' })
    expect(within(box).getByText(grouped)).toBeInTheDocument()
    expect(within(box).getByRole('button', { name: 'Copiar linha digitável' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Importar boleto' })).not.toBeInTheDocument()
  })
})
