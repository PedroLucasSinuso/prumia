import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Tooltip } from './Tooltip'

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
afterEach(() => vi.useRealTimers())

describe('Tooltip', () => {
  it('aparece depois de um atraso curto ao passar o mouse, com role=tooltip e o atalho', async () => {
    render(
      <Tooltip label="Fechar" shortcut="Esc">
        <button aria-label="Fechar">x</button>
      </Tooltip>,
    )
    const btn = screen.getByRole('button', { name: 'Fechar' })
    fireEvent.pointerEnter(btn, { pointerType: 'mouse' })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    act(() => void vi.advanceTimersByTime(450))
    const tip = screen.getByRole('tooltip')
    expect(tip).toHaveTextContent('Fechar')
    expect(tip).toHaveTextContent('Esc')
    expect(btn).toHaveAttribute('aria-describedby', tip.id)
    fireEvent.pointerLeave(btn)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(btn).not.toHaveAttribute('aria-describedby')
  })

  it('não aparece no toque e some ao clicar', () => {
    render(
      <Tooltip label="Pagar">
        <button>p</button>
      </Tooltip>,
    )
    const btn = screen.getByRole('button')
    fireEvent.pointerEnter(btn, { pointerType: 'touch' })
    act(() => void vi.advanceTimersByTime(1000))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    fireEvent.pointerEnter(btn, { pointerType: 'mouse' })
    act(() => void vi.advanceTimersByTime(450))
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    fireEvent.pointerDown(btn)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('aparece na hora com o foco do teclado, e Esc fecha só a dica', async () => {
    const outer = vi.fn()
    document.addEventListener('keydown', outer)
    render(
      <Tooltip label="Próximo mês" shortcut="→">
        <button>n</button>
      </Tooltip>,
    )
    await userEvent.tab()
    expect(screen.getByRole('tooltip')).toHaveTextContent('Próximo mês')
    outer.mockClear() // o próprio Tab passou por aqui
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(outer).not.toHaveBeenCalled()
    document.removeEventListener('keydown', outer)
  })

  it('some quando o foco sai', async () => {
    render(
      <>
        <Tooltip label="Dica">
          <button>a</button>
        </Tooltip>
        <button>b</button>
      </>,
    )
    await userEvent.tab()
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    await userEvent.tab()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})
