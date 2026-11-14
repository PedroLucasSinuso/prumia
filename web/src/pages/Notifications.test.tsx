import { configure, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import * as push from '../lib/push'
import { fail, me, mockApi, ok, renderAt } from '../test/utils'

configure({ asyncUtilTimeout: 5000 })

// O jsdom não tem service worker nem PushManager: o que o navegador faz (lib/push.ts) é trocado por um falso, e o teste
// cobre o que a tela decide mostrar em cada estado.
vi.mock('../lib/push', () => ({
  pushState: vi.fn(),
  enablePush: vi.fn(),
  disablePush: vi.fn(),
  dropLocalPush: vi.fn(async () => {}),
}))

const ligado = ok({ enabled: true, publicKey: 'chave-publica-de-teste' })

beforeEach(() => {
  vi.restoreAllMocks()
  vi.mocked(push.pushState).mockResolvedValue('off')
})

describe('ajustes · avisos', () => {
  it('servidor sem chaves: explica e não oferece o botão', async () => {
    mockApi({ me: ok(me) })
    renderAt('/ajustes/avisos')
    expect(await screen.findByText(/não estão ligados neste servidor/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ligar avisos/ })).not.toBeInTheDocument()
  })

  it('navegador sem suporte (ou iPhone sem instalar): explica o que fazer', async () => {
    vi.mocked(push.pushState).mockResolvedValue('unsupported')
    mockApi({ me: ok(me), pushConfig: ligado })
    renderAt('/ajustes/avisos')
    expect(await screen.findByText(/instale o prumia na tela inicial/)).toBeInTheDocument()
  })

  it('notificações bloqueadas no navegador: diz onde liberar', async () => {
    vi.mocked(push.pushState).mockResolvedValue('denied')
    mockApi({ me: ok(me), pushConfig: ligado })
    renderAt('/ajustes/avisos')
    expect(await screen.findByText(/estão bloqueadas neste navegador/)).toBeInTheDocument()
  })

  it('liga com a chave do servidor, testa e desliga', async () => {
    vi.mocked(push.enablePush).mockResolvedValue('on')
    vi.mocked(push.disablePush).mockResolvedValue('off')
    mockApi({ me: ok(me), pushConfig: ligado, pushTest: ok({ sent: 1 }) })
    renderAt('/ajustes/avisos')
    expect(await screen.findByText('Desligados neste aparelho.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Ligar avisos neste aparelho' }))
    expect(push.enablePush).toHaveBeenCalledWith('chave-publica-de-teste')
    expect(await screen.findByText('Ligados neste aparelho.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Enviar aviso de teste' }))
    await waitFor(() => expect(api.POST).toHaveBeenCalledWith('/push/test'))
    expect(await screen.findByText(/Aviso de teste enviado/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Desligar avisos' }))
    expect(await screen.findByText('Desligados neste aparelho.')).toBeInTheDocument()
  })

  it('se a API recusar, mostra o erro e continua desligado', async () => {
    vi.mocked(push.enablePush).mockRejectedValue(new Error('falhou'))
    mockApi({ me: ok(me), pushConfig: ligado })
    renderAt('/ajustes/avisos')
    await userEvent.click(await screen.findByRole('button', { name: 'Ligar avisos neste aparelho' }))
    expect(await screen.findByText(/Não foi possível falar com o servidor/)).toBeInTheDocument()
    expect(screen.getByText('Desligados neste aparelho.')).toBeInTheDocument()
  })

  it('muitos testes seguidos: avisa para aguardar', async () => {
    vi.mocked(push.pushState).mockResolvedValue('on')
    mockApi({ me: ok(me), pushConfig: ligado, pushTest: fail(429, 'too_many_requests') })
    renderAt('/ajustes/avisos')
    await userEvent.click(await screen.findByRole('button', { name: 'Enviar aviso de teste' }))
    expect(await screen.findByText(/Muitos testes seguidos/)).toBeInTheDocument()
  })
})
