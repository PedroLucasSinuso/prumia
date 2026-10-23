import { configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import type { Category } from '../api/types'
import { resetThemeForTests } from '../lib/theme'
import { fail, me, mockApi, ok, renderAt, twoHousesMe } from '../test/utils'

// As telas são carregadas sob demanda (lazy): com a máquina carregada, o primeiro render pode passar de 1 s.
configure({ asyncUtilTimeout: 5000 })

beforeEach(() => vi.restoreAllMocks())
afterEach(() => {
  vi.unstubAllGlobals()
  resetThemeForTests()
  document.documentElement.removeAttribute('data-theme')
})

/** Finge um computador (>= 768 px) para o hook useIsDesktop. */
function asDesktop() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

const cats: Category[] = [
  { id: 'c1', name: 'Moradia', isEssential: true, sortOrder: 0, archived: false },
  { id: 'c2', name: 'Mercado', isEssential: false, sortOrder: 1, archived: false },
  { id: 'c3', name: 'Lazer', isEssential: false, sortOrder: 2, archived: false },
]

describe('navegação', () => {
  it('a barra tem os quatro destinos principais e a página ativa fica marcada', async () => {
    mockApi({ me: ok(me) })
    renderAt('/resumo')
    const nav = (await screen.findAllByRole('navigation', { name: 'Principal' }))[0]
    expect(within(nav).getAllByRole('link').map((l) => l.textContent?.replace('[ ▪ ]', '').trim())).toEqual(['Mês', 'Receitas', 'Resumo', 'Ajustes'])
    expect(within(nav).getAllByRole('link')).toHaveLength(4)
    expect(within(nav).getByRole('link', { name: /Resumo/ })).toHaveAttribute('aria-current', 'page')
  })

  it('endereços antigos redirecionam: /casa e /configuracoes', async () => {
    mockApi({ me: ok(me) })
    renderAt('/casa')
    expect(await screen.findByRole('heading', { name: 'Casa e pessoas' })).toBeInTheDocument()
  })

  it('/configuracoes leva ao menu de Ajustes', async () => {
    mockApi({ me: ok(me) })
    renderAt('/configuracoes')
    expect(await screen.findByRole('navigation', { name: 'Seções de ajustes' })).toBeInTheDocument()
  })

  it('a rota /parcelas continua funcionando fora da navegação', async () => {
    mockApi({ me: ok(me) })
    renderAt('/parcelas')
    expect(await screen.findByRole('heading', { name: /Parcelas/ })).toBeInTheDocument()
  })
})

describe('menu do usuário', () => {
  it('abre com Minha conta, Aparência e Sair, e leva às seções', async () => {
    mockApi({ me: ok(me) })
    renderAt('/')
    const trigger = (await screen.findAllByRole('button', { name: 'Conta de Pedro' }))[0]
    await userEvent.click(trigger)
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: /Minha conta/ })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: /Aparência/ })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: /Sair/ })).toBeInTheDocument()
    await userEvent.click(within(menu).getByRole('menuitem', { name: /Minha conta/ }))
    expect(await screen.findByRole('heading', { name: 'Minha conta' })).toBeInTheDocument()
  })

  it('com duas casas, troca de casa pelo menu', async () => {
    mockApi({ me: ok(twoHousesMe) })
    renderAt('/')
    await userEvent.click((await screen.findAllByRole('button', { name: 'Conta de Pedro' }))[0])
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitemradio', { name: /Casa do Pedro/ })).toHaveAttribute('aria-checked', 'true')
    expect(within(menu).getByRole('menuitemradio', { name: /Casa da Ana/ })).toHaveAttribute('aria-checked', 'false')
  })
})

describe('ajustes · estrutura', () => {
  it('celular: /ajustes é um menu de seções; abrir uma mostra "voltar"', async () => {
    mockApi({ me: ok(me) })
    renderAt('/ajustes')
    const nav = await screen.findByRole('navigation', { name: 'Seções de ajustes' })
    expect(within(nav).getAllByRole('link').map((l) => l.querySelector('span span')?.textContent)).toEqual([
      'Casa e pessoas', 'Categorias', 'Favorecidos', 'Aparência', 'Minha conta', 'Dados', 'Sobre',
    ])
    await userEvent.click(within(nav).getByRole('link', { name: /Sobre/ }))
    expect(await screen.findByRole('heading', { name: 'Sobre' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Ajustes' }))
    expect(await screen.findByRole('navigation', { name: 'Seções de ajustes' })).toBeInTheDocument()
  })

  it('computador: /ajustes cai em Casa e pessoas, com sub-navegação ao lado', async () => {
    asDesktop()
    mockApi({ me: ok(me) })
    renderAt('/ajustes')
    expect(await screen.findByRole('heading', { name: 'Casa e pessoas' })).toBeInTheDocument()
    const sub = screen.getByRole('navigation', { name: 'Seções de ajustes' })
    expect(within(sub).getByRole('link', { name: 'Casa e pessoas' })).toHaveAttribute('aria-current', 'page')
    await userEvent.click(within(sub).getByRole('link', { name: 'Dados' }))
    expect(await screen.findByRole('heading', { name: 'Dados' })).toBeInTheDocument()
  })

  it('seção desconhecida volta ao menu', async () => {
    mockApi({ me: ok(me) })
    renderAt('/ajustes/nada')
    expect(await screen.findByRole('navigation', { name: 'Seções de ajustes' })).toBeInTheDocument()
  })
})

describe('ajustes · categorias no computador', () => {
  it('reordena pela alça com as setas do teclado', async () => {
    asDesktop()
    mockApi({ me: ok(me), categories: ok(cats) })
    renderAt('/ajustes/categorias')
    const handle = await screen.findByRole('button', { name: 'Reordenar Lazer' })
    handle.focus()
    await userEvent.keyboard('{ArrowUp}')
    await waitFor(() => expect(api.PATCH).toHaveBeenCalledTimes(2))
    const calls = vi.mocked(api.PATCH).mock.calls.map((c) => [(c[1] as { params: { path: { categoryId: string } } }).params.path.categoryId, (c[1] as { body: unknown }).body])
    expect(calls).toEqual([
      ['c3', { sortOrder: 1 }],
      ['c2', { sortOrder: 2 }],
    ])
  })

  it('o menu ⋯ tem as ações da linha e Esc o fecha', async () => {
    asDesktop()
    mockApi({ me: ok(me), categories: ok(cats) })
    renderAt('/ajustes/categorias')
    await userEvent.click(await screen.findByRole('button', { name: 'Ações de Mercado' }))
    const menu = await screen.findByRole('menu', { name: 'Ações de Mercado' })
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Editar', 'Nova subcategoria', 'Mover para…', 'Arquivar'])
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('selecionar uma categoria abre o painel lateral (não modal)', async () => {
    asDesktop()
    mockApi({ me: ok(me), categories: ok(cats) })
    renderAt('/ajustes/categorias')
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir Mercado' }))
    expect(await screen.findByRole('region', { name: 'Mercado' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('ajustes · aparência e tema da conta', () => {
  it('usa o tema da conta ao entrar', async () => {
    mockApi({ me: ok({ ...me, theme: 'grafite' }) })
    renderAt('/')
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('grafite'))
  })

  it('falha ao gravar o tema: avisa, mas o tema vale neste aparelho', async () => {
    mockApi({ me: ok(me), updateMe: fail(500, 'internal') })
    renderAt('/ajustes/aparencia')
    await userEvent.click(await screen.findByRole('radio', { name: /Contraste/ }))
    expect(document.documentElement.dataset.theme).toBe('contraste')
    expect(await screen.findByText(/não deu para salvar na sua conta/)).toBeInTheDocument()
  })
})

describe('ajustes · minha conta', () => {
  it('edita o nome', async () => {
    mockApi({ me: ok(me) })
    renderAt('/ajustes/conta')
    const name = await screen.findByLabelText('Nome')
    await userEvent.clear(name)
    await userEvent.type(name, 'Pedro L.')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar nome' }))
    await waitFor(() => expect(api.PATCH).toHaveBeenCalledWith('/auth/me', { body: { name: 'Pedro L.' } }))
    expect(await screen.findByText('Nome atualizado.')).toBeInTheDocument()
  })

  it('troca a senha e limpa os campos', async () => {
    mockApi({ me: ok(me) })
    renderAt('/ajustes/conta')
    await userEvent.type(await screen.findByLabelText('Senha atual'), 'senha-antiga-123')
    await userEvent.type(screen.getByLabelText('Nova senha'), 'senha-nova-456')
    await userEvent.click(screen.getByRole('button', { name: 'Trocar senha' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/auth/password', { body: { currentPassword: 'senha-antiga-123', newPassword: 'senha-nova-456' } }),
    )
    expect(await screen.findByText(/Senha trocada/)).toBeInTheDocument()
    expect(screen.getByLabelText('Senha atual')).toHaveValue('')
  })

  it('nova senha curta é recusada antes de enviar', async () => {
    mockApi({ me: ok(me) })
    renderAt('/ajustes/conta')
    await userEvent.type(await screen.findByLabelText('Senha atual'), 'senha-antiga-123')
    await userEvent.type(screen.getByLabelText('Nova senha'), 'curta')
    await userEvent.click(screen.getByRole('button', { name: 'Trocar senha' }))
    expect(await screen.findByText('Use pelo menos 10 caracteres.')).toBeInTheDocument()
    expect(api.POST).not.toHaveBeenCalledWith('/auth/password', expect.anything())
  })

  it('senha atual errada aparece no campo', async () => {
    mockApi({ me: ok(me), changePassword: fail(400, 'validation_error', { currentPassword: 'Senha atual incorreta.' }) })
    renderAt('/ajustes/conta')
    await userEvent.type(await screen.findByLabelText('Senha atual'), 'errada-errada')
    await userEvent.type(screen.getByLabelText('Nova senha'), 'senha-nova-456')
    await userEvent.click(screen.getByRole('button', { name: 'Trocar senha' }))
    expect(await screen.findByText('Senha atual incorreta.')).toBeInTheDocument()
    expect(screen.getByLabelText('Senha atual')).toHaveAttribute('aria-invalid', 'true')
  })

  it('sai dos outros aparelhos', async () => {
    mockApi({ me: ok(me), endOthers: ok({ ended: 2 }) })
    renderAt('/ajustes/conta')
    await userEvent.click(await screen.findByRole('button', { name: 'Sair dos outros aparelhos' }))
    expect(await screen.findByText('Desconectado de 2 outros aparelhos.')).toBeInTheDocument()
  })
})

describe('ajustes · dados e sobre', () => {
  it('exporta o CSV com o filtro de vencimento', async () => {
    mockApi({ me: ok(me) })
    const fetchMock = vi.fn().mockResolvedValue(new Response('a;b\n', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    renderAt('/ajustes/dados')
    await userEvent.type(await screen.findByLabelText('Vencimento de'), '2026-10-01')
    await userEvent.click(screen.getByRole('button', { name: 'Baixar CSV' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/households/h1/export/invoices.csv?from=2026-10-01', expect.anything()))
  })

  it('mostra erro se a exportação falhar', async () => {
    mockApi({ me: ok(me) })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })))
    renderAt('/ajustes/dados')
    await userEvent.click(await screen.findByRole('button', { name: 'Baixar CSV' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Não foi possível exportar/)
  })

  it('sobre mostra a versão e os guias', async () => {
    mockApi({ me: ok(me) })
    renderAt('/ajustes/sobre')
    expect(await screen.findByText(/Versão/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Fazer backup' })).toHaveAttribute('href', expect.stringContaining('fazer-backup.md'))
  })
})
