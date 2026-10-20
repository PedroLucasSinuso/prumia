import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { api } from './api/client'
import type { Me, Problem } from './api/types'
import { AuthProvider } from './auth/AuthContext'

const me: Me = {
  id: 'u1',
  name: 'Pedro',
  email: 'pedro@exemplo.com',
  households: [{ id: 'h1', name: 'Casa do Pedro', role: 'admin' }],
}

type Reply = { data?: unknown; error?: Problem; response?: { ok: boolean } }

/** Simula a API por rota. Rotas não informadas respondem 401 (me) ou ok (healthz). */
function mockApi(routes: { me?: Reply; login?: Reply | Error; register?: Reply; logout?: Reply } = {}) {
  vi.spyOn(api, 'GET').mockImplementation((async (url: string) => {
    if (url === '/healthz') return { response: { ok: true } }
    if (url === '/auth/me') return routes.me ?? { error: { title: 'Unauthorized', status: 401 }, response: { ok: false } }
    throw new Error('GET inesperado: ' + url)
  }) as never)
  vi.spyOn(api, 'POST').mockImplementation((async (url: string) => {
    const pick = { '/auth/login': routes.login, '/auth/register': routes.register, '/auth/logout': routes.logout }[url]
    if (pick instanceof Error) throw pick
    return pick ?? { response: { ok: true } }
  }) as never)
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  )
}

const problem = (status: number, code: string, fields?: Record<string, string>): Problem => ({ title: code, status, code, fields })

describe('proteção de rotas', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('sem sessão, o app manda para a tela de entrar', async () => {
    mockApi()
    renderAt('/')
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument()
  })

  it('com sessão, mostra a casa e o nome do usuário', async () => {
    mockApi({ me: { data: me, response: { ok: true } } })
    renderAt('/')
    expect(await screen.findByRole('heading', { name: 'Casa do Pedro' })).toBeInTheDocument()
    expect(screen.getByText('Pedro')).toBeInTheDocument()
    expect(await screen.findByText(/api online/)).toBeInTheDocument()
  })

  it('quem já está logado não vê a tela de entrar', async () => {
    mockApi({ me: { data: me, response: { ok: true } } })
    renderAt('/entrar')
    expect(await screen.findByRole('heading', { name: 'Casa do Pedro' })).toBeInTheDocument()
  })
})

describe('login', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('entra e vai para o app', async () => {
    mockApi({ login: { data: me, response: { ok: true } } })
    renderAt('/entrar')
    await userEvent.type(await screen.findByLabelText('E-mail'), 'pedro@exemplo.com')
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-muito-segura')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByRole('heading', { name: 'Casa do Pedro' })).toBeInTheDocument()
    expect(api.POST).toHaveBeenCalledWith('/auth/login', { body: { email: 'pedro@exemplo.com', password: 'senha-muito-segura' } })
  })

  it('senha errada mostra o erro e permanece na tela', async () => {
    mockApi({ login: { error: problem(401, 'invalid_credentials'), response: { ok: false } } })
    renderAt('/entrar')
    await userEvent.type(await screen.findByLabelText('E-mail'), 'pedro@exemplo.com')
    await userEvent.type(screen.getByLabelText('Senha'), 'errada-errada')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha incorretos.')
    expect(screen.getByRole('heading', { name: 'Entrar' })).toBeInTheDocument()
  })

  it('falha de rede mostra aviso de conexão', async () => {
    mockApi({ login: new Error('rede') })
    renderAt('/entrar')
    await userEvent.type(await screen.findByLabelText('E-mail'), 'a@b.co')
    await userEvent.type(screen.getByLabelText('Senha'), 'qualquer-senha')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível falar com o servidor')
  })

  it('o botão fica desabilitado até preencher os campos', async () => {
    mockApi()
    renderAt('/entrar')
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeDisabled()
  })
})

describe('cadastro', () => {
  beforeEach(() => vi.restoreAllMocks())

  async function fill() {
    await userEvent.type(await screen.findByLabelText('Seu nome'), 'Pedro')
    await userEvent.type(screen.getByLabelText('E-mail'), 'pedro@exemplo.com')
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-muito-segura')
    await userEvent.type(screen.getByLabelText('Nome da casa'), 'Casa do Pedro')
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
  }

  it('cria a conta e entra no app', async () => {
    mockApi({ register: { data: me, response: { ok: true } } })
    renderAt('/cadastro')
    await fill()
    expect(await screen.findByRole('heading', { name: 'Casa do Pedro' })).toBeInTheDocument()
    expect(api.POST).toHaveBeenCalledWith('/auth/register', {
      body: { name: 'Pedro', email: 'pedro@exemplo.com', password: 'senha-muito-segura', householdName: 'Casa do Pedro' },
    })
  })

  it('mostra os erros de validação no campo certo', async () => {
    mockApi({
      register: { error: problem(400, 'validation_error', { email: 'e-mail inválido', password: 'a senha deve ter de 10 a 128 caracteres' }), response: { ok: false } },
    })
    renderAt('/cadastro')
    await fill()
    expect(await screen.findByText('e-mail inválido')).toBeInTheDocument()
    expect(screen.getByLabelText('E-mail')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('a senha deve ter de 10 a 128 caracteres')).toBeInTheDocument()
    expect(screen.getByLabelText('Seu nome')).not.toHaveAttribute('aria-invalid')
  })

  it('editar um campo apaga o aviso dele', async () => {
    mockApi({ register: { error: problem(400, 'validation_error', { email: 'e-mail inválido' }), response: { ok: false } } })
    renderAt('/cadastro')
    await fill()
    expect(await screen.findByText('e-mail inválido')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('E-mail'), 'x')
    expect(screen.queryByText('e-mail inválido')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('explica quando o cadastro livre está fechado', async () => {
    mockApi({ register: { error: problem(403, 'registration_closed'), response: { ok: false } } })
    renderAt('/cadastro')
    await fill()
    expect(await screen.findByRole('alert')).toHaveTextContent('Peça um convite')
  })
})

describe('sair', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('encerra a sessão e volta para a tela de entrar', async () => {
    mockApi({ me: { data: me, response: { ok: true } } })
    renderAt('/')
    await userEvent.click(await screen.findByRole('button', { name: 'Sair' }))
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument()
    await waitFor(() => expect(api.POST).toHaveBeenCalledWith('/auth/logout'))
  })
})
