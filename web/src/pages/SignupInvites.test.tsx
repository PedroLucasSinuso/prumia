import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import { fail, me, mockApi, ok, renderAt } from '../test/utils'

const owner = { ...me, isSystemOwner: true }

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('convites de cadastro (Ajustes > Minha conta)', () => {
  it('o dono do sistema gera o link com o token no fragmento e vê os pendentes', async () => {
    mockApi({
      me: ok(owner),
      signupInvites: ok([{ id: 's1', createdAt: '2026-10-25T12:00:00Z', expiresAt: '2026-10-27T12:00:00Z' }]),
      createSignupInvite: ok({ id: 's2', token: 'cad123', expiresAt: '2026-11-01T12:00:00Z' }),
    })
    renderAt('/ajustes/conta')
    const card = await screen.findByRole('region', { name: 'Convites de cadastro' })
    expect(await within(card).findByRole('list', { name: 'Links de cadastro pendentes' })).toBeInTheDocument()
    await userEvent.selectOptions(within(card).getByRole('combobox'), '168')
    await userEvent.click(within(card).getByRole('button', { name: 'Gerar link de cadastro' }))
    await waitFor(() => expect(api.POST).toHaveBeenCalledWith('/auth/signup-invites', { body: { expiresInHours: 168 } }))
    expect(await within(card).findByLabelText('Link de cadastro')).toHaveValue(`${window.location.origin}/cadastro#token=cad123`)
  })

  it('quem não é dono do sistema não vê a opção', async () => {
    mockApi({ me: ok(me) })
    renderAt('/ajustes/conta')
    await screen.findByText(/Entrou como/)
    expect(screen.queryByRole('region', { name: 'Convites de cadastro' })).not.toBeInTheDocument()
    expect(api.GET).not.toHaveBeenCalledWith('/auth/signup-invites')
  })
})

describe('cadastro com o link', () => {
  it('manda o signupToken e cria a conta com casa própria', async () => {
    mockApi({ register: ok(me) })
    renderAt('/cadastro#token=cad123')
    expect(await screen.findByText(/Você recebeu um convite/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Seu nome'), 'Bia')
    await userEvent.type(screen.getByLabelText('E-mail'), 'bia@exemplo.com')
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-bem-longa')
    await userEvent.type(screen.getByLabelText('Nome da casa'), 'Casa da Bia')
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith('/auth/register', {
        body: { name: 'Bia', email: 'bia@exemplo.com', password: 'senha-bem-longa', householdName: 'Casa da Bia', signupToken: 'cad123' },
      }),
    )
  })

  it('link inválido explica o que fazer', async () => {
    mockApi({ register: fail(400, 'invalid_signup_invite') })
    renderAt('/cadastro#token=velho')
    await userEvent.type(await screen.findByLabelText('Seu nome'), 'Bia')
    await userEvent.type(screen.getByLabelText('E-mail'), 'bia@exemplo.com')
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-bem-longa')
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
    expect(await screen.findByText(/link de cadastro é inválido/)).toBeInTheDocument()
  })
})
