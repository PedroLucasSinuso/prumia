import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import { fail, mockApi, ok, me, renderAt } from '../test/utils'

beforeEach(() => vi.restoreAllMocks())

describe('convite', () => {
  it('cadastra com o token do link e entra no app', async () => {
    mockApi({ register: ok(me) })
    renderAt('/convite?token=abc')
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
    renderAt('/convite?token=velho')
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
    renderAt('/convite?token=abc')
    expect(await screen.findByRole('button', { name: 'Sair e usar o convite' })).toBeInTheDocument()
    expect(api.POST).not.toHaveBeenCalled()
  })
})

describe('redefinir senha', () => {
  it('envia a nova senha com o token e volta ao login', async () => {
    mockApi({ passwordReset: ok() })
    renderAt('/redefinir-senha?token=rst')
    await userEvent.type(await screen.findByLabelText('Nova senha'), 'outra-senha-longa')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar nova senha' }))
    await waitFor(() => expect(api.POST).toHaveBeenCalledWith('/auth/password-reset', { body: { token: 'rst', newPassword: 'outra-senha-longa' } }))
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument()
  })

  it('link expirado mostra aviso', async () => {
    mockApi({ passwordReset: fail(400, 'invalid_reset_token') })
    renderAt('/redefinir-senha?token=rst')
    await userEvent.type(await screen.findByLabelText('Nova senha'), 'outra-senha-longa')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar nova senha' }))
    expect(await screen.findByText(/inválido ou expirou/)).toBeInTheDocument()
  })
})
