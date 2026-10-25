import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import { fail, mockApi, ok, me, renderAt } from '../test/utils'

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('convite', () => {
  it('cadastra com o token do link e entra no app', async () => {
    mockApi({ register: ok(me) })
    renderAt('/convite#token=abc')
    await userEvent.type(await screen.findByLabelText('Seu nome'), 'Ana')
    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@exemplo.com')
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-bem-longa')
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta e entrar' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/auth/register', {
        body: { name: 'Ana', email: 'ana@exemplo.com', password: 'senha-bem-longa', inviteToken: 'abc' },
      }),
    )
  })

  it('explica quando o convite não vale mais', async () => {
    mockApi({ register: fail(400, 'invalid_invite') })
    renderAt('/convite#token=velho')
    await userEvent.type(await screen.findByLabelText('Seu nome'), 'Ana')
    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@exemplo.com')
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-bem-longa')
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta e entrar' }))
    expect(await screen.findByText(/inválido, expirou ou foi revogado/)).toBeInTheDocument()
  })

  it('sem token no link, pede um novo convite', async () => {
    mockApi()
    renderAt('/convite')
    expect(await screen.findByText(/link está incompleto/)).toBeInTheDocument()
  })

  it('quem já está logado não consome o convite sem querer', async () => {
    mockApi({ me: ok(me) })
    renderAt('/convite#token=abc')
    expect(await screen.findByRole('button', { name: 'Entrar na casa' })).toBeInTheDocument()
    expect(api.POST).not.toHaveBeenCalled()
  })

  it('com conta logada, "Entrar na casa" aceita o convite e ativa a casa nova', async () => {
    let current = me
    mockApi({ me: () => ok(current) })
    vi.mocked(api.POST).mockImplementation((async (url: string) => {
      if (url !== '/invites/accept') return ok()
      current = { ...me, households: [...me.households, { id: 'h2', name: 'Casa da Ana', role: 'member' }] }
      return ok({ id: 'h2', name: 'Casa da Ana', createdAt: '2026-10-21T00:00:00Z' })
    }) as never)
    renderAt('/convite#token=abc')
    await userEvent.click(await screen.findByRole('button', { name: 'Entrar na casa' }))
    expect(api.POST).toHaveBeenCalledWith('/invites/accept', { body: { token: 'abc' } })
    expect((await screen.findAllByRole('button', { name: /Casa ativa: Casa da Ana/ })).length).toBeGreaterThan(0)
    expect(localStorage.getItem('prumia.casaAtiva.u1')).toBe('h2')
  })

  it.each([
    ['invalid_invite', 400, /inválido, expirou ou foi revogado/],
    ['invite_used', 409, /já foi usado/],
    ['already_member', 409, /já faz parte desta casa/],
  ])('com conta logada, %s mostra o aviso', async (code, status, text) => {
    mockApi({ me: ok(me), acceptInvite: fail(status, code) })
    renderAt('/convite#token=abc')
    await userEvent.click(await screen.findByRole('button', { name: 'Entrar na casa' }))
    expect(await screen.findByText(text)).toBeInTheDocument()
  })

  it('sem sessão, "entrar e aceitar" faz login e volta ao convite com o token', async () => {
    mockApi({ login: ok(me), acceptInvite: ok({ id: 'h1', name: 'Casa do Pedro', createdAt: '2026-10-21T00:00:00Z' }) })
    renderAt('/convite#token=abc')
    await userEvent.click(await screen.findByRole('link', { name: 'Entrar e aceitar o convite' }))
    await userEvent.type(await screen.findByLabelText('E-mail'), 'ana@exemplo.com')
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-bem-longa')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByRole('button', { name: 'Entrar na casa' })).toBeInTheDocument()
    vi.mocked(api.POST).mockClear()
    await userEvent.click(screen.getByRole('button', { name: 'Entrar na casa' }))
    expect(api.POST).toHaveBeenCalledWith('/invites/accept', { body: { token: 'abc' } })
  })
})

describe('links antigos (token na query)', () => {
  it('convite com ?token= continua valendo', async () => {
    mockApi({ register: ok(me) })
    renderAt('/convite?token=antigo')
    await userEvent.type(await screen.findByLabelText('Seu nome'), 'Ana')
    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@exemplo.com')
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-bem-longa')
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta e entrar' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/auth/register', {
        body: { name: 'Ana', email: 'ana@exemplo.com', password: 'senha-bem-longa', inviteToken: 'antigo' },
      }),
    )
  })

  it('nova senha com ?token= continua valendo', async () => {
    mockApi({ passwordReset: ok() })
    renderAt('/redefinir-senha?token=rst-antigo')
    await userEvent.type(await screen.findByLabelText('Nova senha'), 'outra-senha-longa')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar nova senha' }))
    await waitFor(() => expect(api.POST).toHaveBeenCalledWith('/auth/password-reset', { body: { token: 'rst-antigo', newPassword: 'outra-senha-longa' } }))
  })
})

describe('redefinir senha', () => {
  it('envia a nova senha com o token e volta ao login', async () => {
    mockApi({ passwordReset: ok() })
    renderAt('/redefinir-senha#token=rst')
    await userEvent.type(await screen.findByLabelText('Nova senha'), 'outra-senha-longa')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar nova senha' }))
    await waitFor(() => expect(api.POST).toHaveBeenCalledWith('/auth/password-reset', { body: { token: 'rst', newPassword: 'outra-senha-longa' } }))
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument()
  })

  it('link expirado mostra aviso', async () => {
    mockApi({ passwordReset: fail(400, 'invalid_reset_token') })
    renderAt('/redefinir-senha#token=rst')
    await userEvent.type(await screen.findByLabelText('Nova senha'), 'outra-senha-longa')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar nova senha' }))
    expect(await screen.findByText(/inválido ou expirou/)).toBeInTheDocument()
  })
})
