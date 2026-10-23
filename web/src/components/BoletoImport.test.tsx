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
    beneficiaryName: 'Companhia de Luz', documentAmountCents: 18990, documentDueDate: '2026-10-28', documentCompetenceMonth: '2026-10-01',
  },
  method: 'pdf_text',
  ...over,
})

const pdf = () => new File(['%PDF-1.4'], 'boleto.pdf', { type: 'application/pdf' })
const extractCalls = () =>
  (vi.mocked(api.POST).mock.calls as unknown as Array<[string, unknown]>).filter(([url]) => url === '/households/{householdId}/documents/extract')

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
    expect(within(dialog).getByLabelText('Descrição')).toHaveValue('Companhia de Luz')
    expect(within(dialog).getByLabelText('Data de vencimento')).toHaveValue('2026-10-28')
    expect(within(dialog).getByLabelText('Valor')).toHaveValue('R$ 189,90')
    expect(within(dialog).getByLabelText(/Mês de competência/)).toHaveValue('2026-10')

    const [, init] = extractCalls()[0] as [string, { body: { file: File; password?: string } }]
    expect(init.body.file.name).toBe('boleto.pdf')
    expect(init.body.password).toBeUndefined()

    await user.click(within(dialog).getByRole('button', { name: 'Adicionar conta' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        '/households/{householdId}/invoices',
        expect.objectContaining({
          body: expect.objectContaining({
            description: 'Companhia de Luz', amountCents: 18990, dueDate: '2026-10-28', competenceMonth: '2026-10-01',
            boleto: { digitableLine: line, beneficiaryName: 'Companhia de Luz' },
          }),
        }),
      ),
    )
  })

  describe('favorecido', () => {
    const cnpj = '11222333000181'
    const comCnpj = (payee?: unknown) =>
      extraction({ boleto: { ...extraction().boleto, beneficiaryName: 'GASCO DISTRIBUIDORA S/A', beneficiaryCnpj: cnpj }, ...(payee ? { payee } : {}) } as Partial<BoletoExtraction>)
    const gas = { id: 'p1', name: 'Gás', cnpj, defaultCategoryId: 'c2', archived: false }

    it('cadastra o favorecido na própria importação: o apelido vai como newPayee e substitui o nome do boleto', async () => {
      const user = userEvent.setup()
      mockApi({ me: ok(me), extract: ok(comCnpj()), create: ok(invoice({ id: 'n1', description: 'Gás' })) })
      const dialog = await openNew(user)
      await user.upload(within(dialog).getByLabelText('Arquivo do boleto'), pdf())
      const apelido = await within(dialog).findByLabelText(/Como vocês chamam GASCO DISTRIBUIDORA S\/A/)
      expect(within(dialog).getByLabelText('Descrição')).toHaveValue('GASCO DISTRIBUIDORA S/A')
      await user.type(apelido, 'Gás')
      expect(within(dialog).getByLabelText('Descrição')).toHaveValue('Gás')
      await user.click(within(dialog).getByRole('button', { name: 'Adicionar conta' }))
      await waitFor(() =>
        expect(api.POST).toHaveBeenCalledWith(
          '/households/{householdId}/invoices',
          expect.objectContaining({
            body: expect.objectContaining({
              description: 'Gás', newPayee: { name: 'Gás' },
              boleto: { digitableLine: line, beneficiaryName: 'GASCO DISTRIBUIDORA S/A', beneficiaryCnpj: cnpj },
            }),
          }),
        ),
      )
    })

    it('mostra o selo quando o nome foi conferido pelo CNPJ', async () => {
      const user = userEvent.setup()
      const ex = comCnpj()
      ex.boleto.beneficiaryVerified = true
      mockApi({ me: ok(me), extract: ok(ex) })
      const dialog = await openNew(user)
      await user.upload(within(dialog).getByLabelText('Arquivo do boleto'), pdf())
      const review = await within(dialog).findByRole('region', { name: 'Conferir antes de salvar' })
      expect(within(review).getByText(/conferido pelo CNPJ/)).toBeInTheDocument()
    })

    it('apelido em branco: nada é cadastrado', async () => {
      const user = userEvent.setup()
      mockApi({ me: ok(me), extract: ok(comCnpj()), create: ok(invoice({ id: 'n1', description: 'GASCO DISTRIBUIDORA S/A' })) })
      const dialog = await openNew(user)
      await user.upload(within(dialog).getByLabelText('Arquivo do boleto'), pdf())
      await within(dialog).findByLabelText(/Como vocês chamam/)
      await user.click(within(dialog).getByRole('button', { name: 'Adicionar conta' }))
      await waitFor(() => expect(api.POST).toHaveBeenCalledWith('/households/{householdId}/invoices', expect.anything()))
      const call = vi.mocked(api.POST).mock.calls.find((c) => c[0] === '/households/{householdId}/invoices')
      expect((call?.[1] as unknown as { body: Record<string, unknown> }).body.newPayee).toBeUndefined()
    })

    it('favorecido reconhecido pelo CNPJ: já vem escolhido, com nome e categoria sugerida, sem pedir apelido', async () => {
      const user = userEvent.setup()
      mockApi({ me: ok(me), payees: ok([gas]), extract: ok(comCnpj(gas)), create: ok(invoice({ id: 'n1', description: 'Gás' })) })
      const dialog = await openNew(user)
      await user.upload(within(dialog).getByLabelText('Arquivo do boleto'), pdf())
      expect(await within(dialog).findByText('Gás', { selector: 'strong' })).toBeInTheDocument()
      expect(within(dialog).queryByLabelText(/Como vocês chamam/)).not.toBeInTheDocument()
      expect(within(dialog).getByLabelText('Descrição')).toHaveValue('Gás')
      expect(within(dialog).getByRole('button', { name: /Mercado/ })).toHaveAttribute('aria-pressed', 'true')
      await user.click(within(dialog).getByRole('button', { name: 'Adicionar conta' }))
      await waitFor(() =>
        expect(api.POST).toHaveBeenCalledWith(
          '/households/{householdId}/invoices',
          expect.objectContaining({ body: expect.objectContaining({ payeeId: 'p1', categoryId: 'c2' }) }),
        ),
      )
    })

    it('escolher um favorecido existente no lugar de criar: some o campo de apelido e o CNPJ será associado', async () => {
      const user = userEvent.setup()
      const antigo = { id: 'p9', name: 'Gás de rua', archived: false }
      mockApi({ me: ok(me), payees: ok([antigo]), extract: ok(comCnpj()), create: ok(invoice({ id: 'n1', description: 'x' })) })
      const dialog = await openNew(user)
      await user.upload(within(dialog).getByLabelText('Arquivo do boleto'), pdf())
      await within(dialog).findByLabelText(/Como vocês chamam/)
      // sem favorecido reconhecido e com algum cadastrado, "Mais opções" já vem aberto
      await user.selectOptions(within(dialog).getByLabelText('Favorecido (opcional)'), 'p9')
      expect(within(dialog).queryByLabelText(/Como vocês chamam/)).not.toBeInTheDocument()
      expect(within(dialog).getByText(/CNPJ deste boleto será associado/)).toBeInTheDocument()
      await user.click(within(dialog).getByRole('button', { name: 'Adicionar conta' }))
      await waitFor(() =>
        expect(api.POST).toHaveBeenCalledWith(
          '/households/{householdId}/invoices',
          expect.objectContaining({ body: expect.objectContaining({ payeeId: 'p9', boleto: expect.objectContaining({ beneficiaryCnpj: cnpj }) }) }),
        ),
      )
    })
  })

  it('só vale para conta avulsa: parcelada ou fixa descarta o boleto e esconde o botão', async () => {
    const user = userEvent.setup()
    mockApi({ me: ok(me), extract: ok(extraction()) })
    const dialog = await openNew(user)
    await user.upload(within(dialog).getByLabelText('Arquivo do boleto'), pdf())
    await within(dialog).findByRole('region', { name: 'Conferir antes de salvar' })

    await user.click(within(dialog).getByRole('button', { name: 'parcelada' }))
    expect(within(dialog).queryByRole('region', { name: 'Conferir antes de salvar' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Importar boleto' })).not.toBeInTheDocument()

    // de volta à avulsa: o botão volta, sem o boleto anterior
    await user.click(within(dialog).getByRole('button', { name: 'avulsa' }))
    expect(within(dialog).getByRole('button', { name: 'Importar boleto' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar conta' }))
    await waitFor(() => expect(api.POST).toHaveBeenCalledWith('/households/{householdId}/invoices', expect.anything()))
    const create = (vi.mocked(api.POST).mock.calls as unknown as Array<[string, { body: object }]>).find(([url]) => url === '/households/{householdId}/invoices')
    expect(create?.[1].body).not.toHaveProperty('boleto')
  })

  it('não troca a descrição que a pessoa já digitou', async () => {
    const user = userEvent.setup()
    mockApi({ me: ok(me), extract: ok(extraction()) })
    const dialog = await openNew(user)
    await user.type(within(dialog).getByLabelText('Descrição'), 'Luz de casa')
    await user.upload(within(dialog).getByLabelText('Arquivo do boleto'), pdf())
    await within(dialog).findByRole('region', { name: 'Conferir antes de salvar' })
    expect(within(dialog).getByLabelText('Descrição')).toHaveValue('Luz de casa')
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
    expect(within(dialog).getByLabelText('Descrição')).toHaveFocus()
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
    // abre em modo leitura (o detalhe), com a descrição como título
    expect(screen.getByRole('heading', { name: 'Luz de setembro' })).toBeInTheDocument()
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

describe('importar conta sem boleto e lista', () => {
  it('conta sem boleto: preenche valor, vencimento, competência e descrição, sem enviar boleto', async () => {
    const user = userEvent.setup()
    mockApi({
      me: ok(me),
      extractDocument: ok({
        kind: 'bill', method: 'pdf_text',
        items: [{ description: 'Gasco Distribuidora SA', amountCents: 13043, dueDate: '2026-07-17', competenceMonth: '2026-06-01', beneficiaryName: 'Gasco Distribuidora SA' }],
      }),
      create: ok(invoice({ id: 'n1', description: 'Gasco Distribuidora SA' })),
    })
    const dialog = await openNew(user)
    await user.upload(within(dialog).getByLabelText('Arquivo do boleto'), pdf())
    const review = await within(dialog).findByRole('region', { name: 'Conferir antes de salvar' })
    expect(within(review).getByText(/Conta sem código de barras/)).toBeInTheDocument()
    expect(within(review).queryByRole('button', { name: 'Copiar linha digitável' })).not.toBeInTheDocument()
    expect(within(dialog).getByLabelText('Valor')).toHaveValue('R$ 130,43')
    expect(within(dialog).getByLabelText('Data de vencimento')).toHaveValue('2026-07-17')
    expect(within(dialog).getByLabelText('Descrição')).toHaveValue('Gasco Distribuidora SA')
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar conta' }))
    await waitFor(() => expect(api.POST).toHaveBeenCalledWith('/households/{householdId}/invoices', expect.anything()))
    const create = (vi.mocked(api.POST).mock.calls as unknown as Array<[string, { body: object }]>).find(([url]) => url === '/households/{householdId}/invoices')
    expect(create?.[1].body).toMatchObject({ amountCents: 13043, dueDate: '2026-07-17', competenceMonth: '2026-06-01' })
    expect(create?.[1].body).not.toHaveProperty('boleto')
  })

  it('lista: mostra as contas e abre em Importar com os itens', async () => {
    const user = userEvent.setup()
    mockApi({
      me: ok(me),
      extractDocument: ok({ kind: 'list', method: 'ocr', items: [{ description: 'Gás', amountCents: 15782 }, { description: 'Mercado', amountCents: 56899 }] }),
    })
    const dialog = await openNew(user)
    await user.upload(within(dialog).getByLabelText('Arquivo do boleto'), new File(['\x89PNG'], 'conversa.png', { type: 'image/png' }))
    const box = await within(dialog).findByRole('region', { name: 'Várias contas no arquivo' })
    expect(within(box).getByText('Encontrei 2 contas neste arquivo')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Descrição')).toHaveValue('')
    await user.click(within(box).getByRole('button', { name: 'Abrir em Importar' }))
    expect(await screen.findByRole('heading', { name: 'Importar contas' }, { timeout: 5000 })).toBeInTheDocument()
    expect(await screen.findAllByRole('listitem', { name: /^Conta \d/ })).toHaveLength(2)
    expect(screen.getAllByText('conversa.png').length).toBeGreaterThan(0)
  })
})
