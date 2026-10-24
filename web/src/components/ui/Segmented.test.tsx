import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { Segmented } from './Segmented'

const options = [
  { value: 'a', label: 'avulsa' },
  { value: 'b', label: 'parcelada' },
  { value: 'c', label: 'fixa', disabled: true },
  { value: 'd', label: 'outra' },
]

function Harness({ spy }: { spy?: (v: string) => void }) {
  const [v, setV] = useState<string | null>('a')
  return <Segmented label="Tipo de conta" options={options} value={v} onChange={(x) => { setV(x); spy?.(x) }} />
}

describe('Segmented', () => {
  it('é um radiogroup com o nome do grupo e a opção escolhida marcada', () => {
    render(<Harness />)
    const group = screen.getByRole('radiogroup', { name: 'Tipo de conta' })
    expect(group).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'avulsa' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'parcelada' })).not.toBeChecked()
  })

  it('clicar escolhe; só a escolhida entra no Tab (tabindex itinerante)', async () => {
    const spy = vi.fn()
    render(<Harness spy={spy} />)
    await userEvent.click(screen.getByRole('radio', { name: 'parcelada' }))
    expect(spy).toHaveBeenCalledWith('b')
    expect(screen.getByRole('radio', { name: 'parcelada' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('radio', { name: 'avulsa' })).toHaveAttribute('tabindex', '-1')
  })

  it('setas movem e escolhem, pulando as desabilitadas; Home/End vão às pontas', async () => {
    render(<Harness />)
    screen.getByRole('radio', { name: 'avulsa' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'parcelada' })).toHaveFocus()
    expect(screen.getByRole('radio', { name: 'parcelada' })).toBeChecked()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'outra' })).toBeChecked() // 'fixa' está desabilitada
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'avulsa' })).toBeChecked() // dá a volta
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('radio', { name: 'outra' })).toBeChecked()
    await userEvent.keyboard('{Home}')
    expect(screen.getByRole('radio', { name: 'avulsa' })).toBeChecked()
  })

  it('opção desabilitada não é escolhida', async () => {
    const spy = vi.fn()
    render(<Harness spy={spy} />)
    await userEvent.click(screen.getByRole('radio', { name: 'fixa' }))
    expect(spy).not.toHaveBeenCalled()
  })

  it('sem valor escolhido, a primeira opção continua alcançável pelo Tab', () => {
    render(<Segmented label="Quando" options={options} value={null} onChange={() => {}} />)
    expect(screen.getByRole('radio', { name: 'avulsa' })).toHaveAttribute('tabindex', '0')
  })
})
