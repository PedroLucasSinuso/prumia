import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { api } from './api/client'

describe('App', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('mostra a API online quando /healthz responde ok', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({ response: { ok: true } } as never)
    render(<App />)
    expect(await screen.findByText(/api online/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /clareza para construir o futuro/i })).toBeInTheDocument()
  })

  it('mostra indisponível quando /healthz devolve erro', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({ response: { ok: false } } as never)
    render(<App />)
    expect(await screen.findByText(/api indisponível/)).toBeInTheDocument()
  })

  it('mostra indisponível quando a rede falha', async () => {
    vi.spyOn(api, 'GET').mockRejectedValue(new Error('rede'))
    render(<App />)
    expect(await screen.findByText(/api indisponível/)).toBeInTheDocument()
  })
})
