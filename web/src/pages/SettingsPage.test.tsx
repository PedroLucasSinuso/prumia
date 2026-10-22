import { configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import type { Category } from '../api/types'
import { fail, invoice, me, mockApi, ok, renderAt, viewerMe } from '../test/utils'

// A tela é carregada sob demanda (lazy): com a máquina carregada, o primeiro render pode passar de 1 s.
configure({ asyncUtilTimeout: 5000 })

beforeEach(() => vi.restoreAllMocks())

const cats: Category[] = [
  { id: 'c1', name: 'Moradia', isEssential: true, sortOrder: 0, archived: false },
  { id: 'c2', name: 'Mercado', defaultWallet: 'benefit', isEssential: true, sortOrder: 1, archived: false },
  { id: 'c3', name: 'Lazer', isEssential: false, sortOrder: 2, archived: false },
  { id: 'c9', name: 'Academia', isEssential: false, sortOrder: 3, archived: true },
]

const patchCalls = () => vi.mocked(api.PATCH).mock.calls.map((c) => (c[1] as { body: unknown }).body)

describe('ajustes · categorias', () => {
  it('lista as ativas em ordem e as arquivadas à parte', async () => {
    mockApi({ me: ok(me), categories: ok(cats) })
    renderAt('/configuracoes')
    await screen.findByRole('button', { name: 'Abrir Moradia' })
    const list = screen.getByRole('list', { name: 'Categorias ativas' })
    expect(within(list).getAllByRole('button', { name: /^Abrir/ }).map((b) => b.getAttribute('aria-label'))).toEqual(['Abrir Moradia', 'Abrir Mercado', 'Abrir Lazer'])
    expect(within(list).getByText(/carteira de benefício · essencial/)).toBeInTheDocument()
    expect(screen.getByText('arquivadas (1)')).toBeInTheDocument()
    expect(api.GET).toHaveBeenCalledWith('/households/{householdId}/categories', expect.objectContaining({ params: expect.objectContaining({ query: { includeArchived: true } }) }))
  })

  it('cria uma categoria com carteira e essencial', async () => {
    mockApi({ me: ok(me), categories: ok(cats), createCategory: ok({ id: 'c10', name: 'Pets', isEssential: false, sortOrder: 4, archived: false }) })
    renderAt('/configuracoes')
    await userEvent.click(await screen.findByRole('button', { name: /Nova categoria/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Nova categoria' })
    await userEvent.type(within(dialog).getByLabelText('Nome'), 'Pets')
    await userEvent.click(within(dialog).getByRole('button', { name: 'livre' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar categoria' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/households/{householdId}/categories', expect.objectContaining({ body: { name: 'Pets', defaultWallet: 'free', isEssential: false } })),
    )
    expect(await screen.findByText('Pets criada.')).toBeInTheDocument()
  })

  it('edita nome, carteira e essencial (nenhuma carteira vai como null)', async () => {
    mockApi({ me: ok(me), categories: ok(cats) })
    renderAt('/configuracoes')
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir Mercado' }))
    const dialog = await screen.findByRole('dialog', { name: 'Mercado' })
    const name = within(dialog).getByLabelText('Nome')
    await userEvent.clear(name)
    await userEvent.type(name, 'Supermercado')
    await userEvent.click(within(dialog).getByRole('button', { name: 'nenhuma' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'não' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar categoria' }))
    await waitFor(() => expect(patchCalls()).toContainEqual({ name: 'Supermercado', defaultWallet: null, isEssential: false }))
  })

  it('arquiva uma ativa e restaura uma arquivada', async () => {
    mockApi({ me: ok(me), categories: ok(cats) })
    renderAt('/configuracoes')
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir Lazer' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Arquivar categoria' }))
    await waitFor(() => expect(patchCalls()).toContainEqual({ archived: true }))
    expect(await screen.findByText('Lazer arquivada.')).toBeInTheDocument()

    await userEvent.click(screen.getByText('arquivadas (1)'))
    await userEvent.click(screen.getByRole('button', { name: 'Abrir Academia' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Restaurar categoria' }))
    await waitFor(() => expect(patchCalls()).toContainEqual({ archived: false }))
  })

  it('reordena com subir: grava sortOrder só nas que mudaram', async () => {
    mockApi({ me: ok(me), categories: ok(cats) })
    renderAt('/configuracoes')
    expect(await screen.findByRole('button', { name: 'Subir Moradia' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Descer Lazer' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Subir Lazer' }))
    await waitFor(() => expect(api.PATCH).toHaveBeenCalledTimes(2))
    const calls = vi.mocked(api.PATCH).mock.calls.map((c) => [(c[1] as { params: { path: { categoryId: string } } }).params.path.categoryId, (c[1] as { body: unknown }).body])
    expect(calls).toEqual([
      ['c3', { sortOrder: 1 }],
      ['c2', { sortOrder: 2 }],
    ])
  })

  it('viewer só lê: sem criar, reordenar, salvar ou arquivar', async () => {
    mockApi({ me: ok(viewerMe), categories: ok(cats) })
    renderAt('/configuracoes')
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir Moradia' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Nome')).toBeDisabled()
    expect(within(dialog).queryByRole('button', { name: /Salvar|Arquivar/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Nova categoria/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Subir/ })).not.toBeInTheDocument()
  })

  it('nome repetido mostra o erro em pt-BR no campo', async () => {
    mockApi({ me: ok(me), categories: ok(cats), createCategory: fail(409, 'category_exists') })
    renderAt('/configuracoes')
    await userEvent.click(await screen.findByRole('button', { name: /Nova categoria/ }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Nome'), 'mercado')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar categoria' }))
    expect(await within(dialog).findByText(/Já existe uma categoria com este nome/)).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Nome')).toHaveAttribute('aria-invalid', 'true')
  })

  it('erro ao carregar oferece tentar de novo', async () => {
    mockApi({ me: ok(me), categories: fail(500, 'internal') })
    renderAt('/configuracoes')
    expect(await screen.findByText(/Não foi possível carregar as categorias/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument()
  })

  it('conta antiga de categoria arquivada continua com o nome no mês', async () => {
    const treino = invoice({ id: 'i1', description: 'Mensalidade', categoryId: 'c9', dueDate: '2026-10-10', status: 'pending' })
    mockApi({ me: ok(me), categories: ok(cats), invoices: ok({ items: [treino] }) })
    renderAt('/?mes=2026-10')
    expect(await screen.findByText(/Academia/)).toBeInTheDocument()
    expect(screen.queryByText(/Sem categoria/)).not.toBeInTheDocument()
  })
})

describe('ajustes · favorecidos', () => {
  const gas = { id: 'p1', name: 'Gás', cnpj: '01695370000153', legalName: 'CEG RIO S/A', defaultCategoryId: 'c1', archived: false }

  it('lista com CNPJ formatado e a categoria sugerida', async () => {
    mockApi({ me: ok(me), categories: ok(cats), payees: ok([gas, { id: 'p2', name: 'Antigo', archived: true }]) })
    renderAt('/configuracoes')
    await screen.findByRole('button', { name: 'Abrir favorecido Gás' })
    const list = screen.getByRole('list', { name: 'Favorecidos ativos' })
    expect(within(list).getByText('01.695.370/0001-53 · Moradia')).toBeInTheDocument()
    expect(screen.getByText('arquivados (1)')).toBeInTheDocument()
  })

  it('cria um favorecido: o CNPJ é mascarado ao digitar e vai só com dígitos', async () => {
    mockApi({ me: ok(me), categories: ok(cats), createPayee: ok({ ...gas, id: 'p3' }) })
    renderAt('/configuracoes')
    await userEvent.click(await screen.findByRole('button', { name: /Novo favorecido/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Novo favorecido' })
    await userEvent.type(within(dialog).getByLabelText('Nome'), 'Gás')
    await userEvent.type(within(dialog).getByLabelText('CNPJ (opcional)'), '01695370000153')
    expect(within(dialog).getByLabelText('CNPJ (opcional)')).toHaveValue('01.695.370/0001-53')
    await userEvent.selectOptions(within(dialog).getByLabelText(/categoria sugerida/), 'c1')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar favorecido' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        '/households/{householdId}/payees',
        expect.objectContaining({ body: { name: 'Gás', cnpj: '01695370000153', legalName: null, defaultCategoryId: 'c1' } }),
      ),
    )
    expect(await screen.findByText('Gás criado.')).toBeInTheDocument()
  })

  it('CNPJ incompleto é recusado antes de enviar e CNPJ repetido mostra o aviso do servidor', async () => {
    mockApi({ me: ok(me), categories: ok(cats), createPayee: fail(409, 'payee_cnpj_exists') })
    renderAt('/configuracoes')
    await userEvent.click(await screen.findByRole('button', { name: /Novo favorecido/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Novo favorecido' })
    await userEvent.type(within(dialog).getByLabelText('Nome'), 'Gás')
    await userEvent.type(within(dialog).getByLabelText('CNPJ (opcional)'), '0169')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar favorecido' }))
    expect(await within(dialog).findByText('O CNPJ tem 14 dígitos.')).toBeInTheDocument()
    expect(api.POST).not.toHaveBeenCalled()

    await userEvent.clear(within(dialog).getByLabelText('CNPJ (opcional)'))
    await userEvent.type(within(dialog).getByLabelText('CNPJ (opcional)'), '01695370000153')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar favorecido' }))
    await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(1))
    expect(await within(dialog).findAllByText(/CNPJ/)).not.toHaveLength(0)
  })

  it('arquiva e limpa o CNPJ (null) ao editar', async () => {
    mockApi({ me: ok(me), categories: ok(cats), payees: ok([gas]) })
    renderAt('/configuracoes')
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir favorecido Gás' }))
    const dialog = await screen.findByRole('dialog', { name: 'Gás' })
    await userEvent.clear(within(dialog).getByLabelText('CNPJ (opcional)'))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar favorecido' }))
    await waitFor(() => expect(patchCalls()).toContainEqual({ name: 'Gás', cnpj: null, legalName: 'CEG RIO S/A', defaultCategoryId: 'c1' }))
  })

  it('viewer vê a lista sem botão de criar', async () => {
    mockApi({ me: ok(viewerMe), categories: ok(cats), payees: ok([gas]) })
    renderAt('/configuracoes')
    await screen.findByRole('button', { name: 'Abrir favorecido Gás' })
    expect(screen.queryByRole('button', { name: /Novo favorecido/ })).not.toBeInTheDocument()
  })
})
