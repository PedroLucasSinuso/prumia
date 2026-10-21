import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import { fail, mockApi, ok, me, renderAt, viewerMe } from '../test/utils'

beforeEach(() => vi.restoreAllMocks())

describe('casa', () => {
  it('admin gera um convite e vê o link uma única vez', async () => {
    mockApi({ me: ok(me), invite: ok({ id: 'i1', token: 'tok123', role: 'member', expiresAt: '2026-10-22T12:00:00Z' }) })
    renderAt('/casa')
    await userEvent.click(await screen.findByRole('button', { name: 'Gerar link de convite' }))
    const box = await screen.findByLabelText('Link do convite')
    expect(box).toHaveValue(`${window.location.origin}/convite?token=tok123`)
    expect(api.POST).toHaveBeenCalledWith('/households/{householdId}/invites', expect.objectContaining({ body: { role: 'member', expiresInHours: 48 } }))
  })

  it('admin troca o papel de outra pessoa', async () => {
    mockApi({ me: ok(me) })
    renderAt('/casa')
    await userEvent.selectOptions(await screen.findByLabelText('Papel de Ana'), 'viewer')
    await waitFor(() =>
      expect(api.PATCH).toHaveBeenCalledWith('/households/{householdId}/members/{userId}', expect.objectContaining({ body: { role: 'viewer' } })),
    )
  })

  it('mostra o aviso quando a casa ficaria sem admin', async () => {
    mockApi({ me: ok(me), setRole: fail(409, 'last_admin') })
    renderAt('/casa')
    await userEvent.selectOptions(await screen.findByLabelText('Papel de Pedro'), 'member')
    expect(await screen.findByRole('alert')).toHaveTextContent('pelo menos uma pessoa administradora')
  })

  it('remover pede confirmação e depois remove', async () => {
    mockApi({ me: ok(me) })
    renderAt('/casa')
    const list = await screen.findByRole('region', { name: 'Pessoas' })
    await userEvent.click(await within(list).findByRole('button', { name: 'remover' }))
    expect(api.DELETE).not.toHaveBeenCalled()
    await userEvent.click(within(list).getByRole('button', { name: 'Confirmar remoção de Ana' }))
    await waitFor(() => expect(api.DELETE).toHaveBeenCalledWith('/households/{householdId}/members/{userId}', expect.anything()))
  })

  it('gera o link de nova senha de um membro', async () => {
    mockApi({ me: ok(me), resetLink: ok({ token: 'rst9', expiresAt: '2026-10-21T12:00:00Z' }) })
    renderAt('/casa')
    await userEvent.click(await screen.findByRole('button', { name: 'link de nova senha' }))
    expect(await screen.findByLabelText('Link de nova senha para Ana')).toHaveValue(`${window.location.origin}/redefinir-senha?token=rst9`)
  })

  it('leitura só vê as pessoas: sem convite, sem exclusão, sem troca de papel', async () => {
    mockApi({ me: ok(viewerMe) })
    renderAt('/casa')
    expect(await screen.findByText('Só quem administra a casa pode convidar pessoas.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Gerar link de convite' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Papel de Ana')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Excluir casa…' })).not.toBeInTheDocument()
  })
})
