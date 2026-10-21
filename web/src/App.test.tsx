import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from './api/client'
import type { Problem } from './api/types'
import { mockApi, me, ok, renderAt } from './test/utils'

const problem = (status: number, code: string, fields?: Record<string, string>): Problem => ({ title: code, status, code, fields })

describe('proteção de rotas', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('sem sessão, o app manda para a tela de entrar', async () => {
    mockApi()
    renderAt('/')
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument()
  })

  it('com sessão, mostra a casa e o nome do usuário', async () => {
    mockApi({ me: ok(me) })
    renderAt('/')
    expect(await screen.findByText('Casa do Pedro')).toBeInTheDocument()
    // o nome aparece na barra lateral (computador) e no menu da conta (celular); o CSS decide qual se vê
    expect(screen.getAllByText('Pedro').length).toBeGreaterThan(0)
    expect(await screen.findByText(/Nenhuma conta neste mês/)).toBeInTheDocument()
  })

  it('quem já está logado não vê a tela de entrar', async () => {
    mockApi({ me: ok(me) })
    renderAt('/entrar')
    expect(await screen.findByText('Casa do Pedro')).toBeInTheDocument()
  })
})

describe('login', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('entra e vai para o app', async () => {
    mockApi({ login: ok(me) })
    renderAt('/entrar')
    await userEvent.type(await screen.findByLabelText('E-mail'), 'pedro@exemplo.com')
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-muito-segura')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByText('Casa do Pedro')).toBeInTheDocument()
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
    mockApi({ register: ok(me) })
    renderAt('/cadastro')
    await fill()
    expect(await screen.findByText('Casa do Pedro')).toBeInTheDocument()
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
    mockApi({ me: ok(me) })
    renderAt('/')
    await userEvent.click(await screen.findByRole('button', { name: 'Sair' }))
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument()
    await waitFor(() => expect(api.POST).toHaveBeenCalledWith('/auth/logout'))
  })
})
