import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import type { Category } from '../api/types'
import { fail, me, mockApi, ok, renderAt, viewerMe } from '../test/utils'

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
})
