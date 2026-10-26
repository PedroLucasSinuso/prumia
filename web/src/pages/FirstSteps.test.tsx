import { configure, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { me, mockApi, ok, renderAt, viewerMe } from '../test/utils'

configure({ asyncUtilTimeout: 5000 })

beforeEach(() => {
  vi.restoreAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 22, 12))
  try { localStorage.clear() } catch { /* sem armazenamento */ }
})

describe('primeiros passos (onboarding no Mês)', () => {
  it('casa nova vê os passos, com o que já foi feito riscado, e pode dispensar', async () => {
    mockApi({ me: ok(me) })
    renderAt('/?mes=2026-10')
    const card = await screen.findByRole('region', { name: 'Primeiros passos' })
    expect(within(card).getByRole('link', { name: /Cadastre o salário/ })).toHaveAttribute('href', '/receitas')
    expect(within(card).getByRole('button', { name: /Lance a primeira conta/ })).toBeInTheDocument()
    expect(within(card).getByText(/Convide quem mora com você/)).toHaveClass('line-through') // a casa do teste já tem 2 pessoas
    expect(within(card).getByText('1 de 5')).toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: 'Dispensar' }))
    expect(screen.queryByRole('region', { name: 'Primeiros passos' })).not.toBeInTheDocument()
  })

  it('quem é Só leitura não vê os passos', async () => {
    mockApi({ me: ok(viewerMe) })
    renderAt('/?mes=2026-10')
    await screen.findByRole('heading', { name: 'outubro de 2026' })
    expect(screen.queryByRole('region', { name: 'Primeiros passos' })).not.toBeInTheDocument()
  })
})
