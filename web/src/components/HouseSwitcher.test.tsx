import { QueryClient } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import { fail, me, mockApi, ok, renderAt, twoHousesMe } from '../test/utils'

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

// Alguma listagem da casa `id` foi pedida? (as telas passam o householdId em params.path)
const askedFor = (id: string) =>
  (vi.mocked(api.GET).mock.calls as unknown as [string, unknown][]).some(([, init]) => (init as { params?: { path?: { householdId?: string } } } | undefined)?.params?.path?.householdId === id)

describe('seletor de casa', () => {
  it('com uma casa só, mostra o nome sem seletor', async () => {
    mockApi({ me: ok(me) })
    renderAt('/')
    expect((await screen.findAllByText('Casa do Pedro')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /Trocar de casa/ })).not.toBeInTheDocument()
  })

  it('com duas casas, troca em um toque, guarda a escolha e limpa o cache', async () => {
    const clear = vi.spyOn(QueryClient.prototype, 'clear')
    mockApi({ me: ok(twoHousesMe) })
    renderAt('/')
    const [trigger] = await screen.findAllByRole('button', { name: /Casa ativa: Casa do Pedro\. Trocar de casa/ })
    await waitFor(() => expect(askedFor('h1')).toBe(true))
    expect(askedFor('h2')).toBe(false)

    await userEvent.click(trigger)
    const sheet = screen.getByRole('dialog', { name: 'Trocar de casa' })
    expect(within(sheet).getByText('membro')).toBeInTheDocument() // o papel aparece em cada casa
    await userEvent.click(within(sheet).getByRole('button', { name: /Casa da Ana/ }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(clear).toHaveBeenCalled()
    expect(localStorage.getItem('prumia.casaAtiva.u1')).toBe('h2')
    expect((await screen.findAllByRole('button', { name: /Casa ativa: Casa da Ana/ })).length).toBeGreaterThan(0)
    await waitFor(() => expect(askedFor('h2')).toBe(true))
  })

  it('abre na casa guardada para o usuário', async () => {
    localStorage.setItem('prumia.casaAtiva.u1', 'h2')
    mockApi({ me: ok(twoHousesMe) })
    renderAt('/')
    expect((await screen.findAllByRole('button', { name: /Casa ativa: Casa da Ana/ })).length).toBeGreaterThan(0)
    await waitFor(() => expect(askedFor('h2')).toBe(true))
    expect(askedFor('h1')).toBe(false)
  })

  it('casa guardada que não existe mais cai na 1ª casa', async () => {
    localStorage.setItem('prumia.casaAtiva.u1', 'casa-excluida')
    mockApi({ me: ok(twoHousesMe) })
    renderAt('/')
    expect((await screen.findAllByRole('button', { name: /Casa ativa: Casa do Pedro/ })).length).toBeGreaterThan(0)
    await waitFor(() => expect(askedFor('h1')).toBe(true))
  })
})

describe('casas na tela /casa', () => {
  it('cria outra casa e passa a usá-la', async () => {
    let current = twoHousesMe
    mockApi({
      me: () => ok(current),
      createHousehold: ok({ id: 'h3', name: 'Casa da praia', createdAt: '2026-10-21T00:00:00Z' }),
    })
    vi.mocked(api.POST).mockImplementationOnce(async () => {
      current = { ...twoHousesMe, households: [...twoHousesMe.households, { id: 'h3', name: 'Casa da praia', role: 'admin' }] }
      return ok({ id: 'h3', name: 'Casa da praia', createdAt: '2026-10-21T00:00:00Z' }) as never
    })
    renderAt('/ajustes/casa')
    await userEvent.click(await screen.findByRole('button', { name: 'Criar outra casa' }))
    await userEvent.type(screen.getByLabelText('Nome da nova casa'), 'Casa da praia')
    await userEvent.click(screen.getByRole('button', { name: 'Criar casa' }))
    expect(await screen.findByRole('heading', { name: 'Casa da praia' })).toBeInTheDocument()
    expect(api.POST).toHaveBeenCalledWith('/households', { body: { name: 'Casa da praia' } })
    expect(localStorage.getItem('prumia.casaAtiva.u1')).toBe('h3')
  })

  it('avisa quando passou do limite de casas', async () => {
    mockApi({ me: ok(me), createHousehold: fail(409, 'household_limit') })
    renderAt('/ajustes/casa')
    await userEvent.click(await screen.findByRole('button', { name: 'Criar outra casa' }))
    await userEvent.type(screen.getByLabelText('Nome da nova casa'), 'Sexta casa')
    await userEvent.click(screen.getByRole('button', { name: 'Criar casa' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('limite de casas')
  })

  it('sair de uma casa tendo outra troca de casa sem encerrar a sessão', async () => {
    localStorage.setItem('prumia.casaAtiva.u1', 'h2')
    let current = twoHousesMe
    mockApi({ me: () => ok(current) })
    vi.mocked(api.DELETE).mockImplementation((async () => {
      current = me // depois de sair, só sobra a casa do Pedro
      return { response: { ok: true } }
    }) as never)
    renderAt('/ajustes/casa')
    expect(await screen.findByRole('heading', { name: 'Casa da Ana' })).toBeInTheDocument()
    const list = await screen.findByRole('region', { name: 'Pessoas' })
    await userEvent.click(await within(list).findByRole('button', { name: 'sair da casa' }))
    await userEvent.click(within(list).getByRole('button', { name: 'Confirmar saída' }))
    await waitFor(() => expect(localStorage.getItem('prumia.casaAtiva.u1')).toBe('h1'))
    expect(api.POST).not.toHaveBeenCalledWith('/auth/logout')
    expect(await screen.findByText(/Agora você está em Casa do Pedro/)).toBeInTheDocument()
  })

  it('sair da ÚLTIMA casa encerra a sessão', async () => {
    mockApi({ me: ok(me), members: ok([{ userId: 'u1', name: 'Pedro', email: 'pedro@exemplo.com', role: 'member', joinedAt: '2026-01-01T00:00:00Z' }]) })
    renderAt('/ajustes/casa')
    const list = await screen.findByRole('region', { name: 'Pessoas' })
    await userEvent.click(await within(list).findByRole('button', { name: 'sair da casa' }))
    await userEvent.click(within(list).getByRole('button', { name: 'Confirmar saída' }))
    await waitFor(() => expect(api.POST).toHaveBeenCalledWith('/auth/logout'))
  })
})
