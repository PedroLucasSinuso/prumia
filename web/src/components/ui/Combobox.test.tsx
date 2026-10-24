import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { Combobox, type ComboOption } from './Combobox'

const options: ComboOption[] = [
  { value: 'm', label: 'Moradia' },
  { value: 'g', label: 'Gás', group: 'Moradia' },
  { value: 'l', label: 'Luz', group: 'Moradia' },
  { value: 'e', label: 'Educação' },
  { value: 'k', label: 'Mercado', badge: 'VR', badgeTitle: 'Sugere a carteira de benefício' },
]

function Harness({ onCreate, emptyLabel, onSubmit }: { onCreate?: (t: string) => void; emptyLabel?: string; onSubmit?: () => void }) {
  const [v, setV] = useState('m')
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit?.() }}>
      <Combobox label="Categoria" options={options} value={v} onChange={setV} onCreate={onCreate} createLabel="Nova categoria" emptyLabel={emptyLabel} />
      <output aria-label="valor">{v}</output>
    </form>
  )
}

const box = () => screen.getByRole('combobox', { name: 'Categoria' })
const names = () => screen.getAllByRole('option').map((o) => o.getAttribute('aria-label') ?? o.textContent)

describe('Combobox', () => {
  it('mostra a escolha atual e lista mãe e filhas agrupadas ("Mãe › filha") com o selo VR', async () => {
    render(<Harness />)
    expect(box()).toHaveValue('Moradia')
    await userEvent.click(box())
    expect(names()).toEqual(['Moradia', 'Moradia › Gás', 'Moradia › Luz', 'Educação', 'Mercado, Sugere a carteira de benefício'])
    expect(screen.getByText('VR')).toBeInTheDocument()
    expect(box()).toHaveAttribute('aria-expanded', 'true')
  })

  it('digitar filtra ignorando acento e caixa; filha casa pelo nome completo; a mãe arrasta as filhas', async () => {
    render(<Harness />)
    await userEvent.type(box(), 'educa')
    expect(names()).toEqual(['Educação'])
    await userEvent.clear(box())
    await userEvent.type(box(), 'moradia gas')
    expect(names()).toEqual(['Moradia › Gás'])
    await userEvent.clear(box())
    await userEvent.type(box(), 'morad')
    expect(names()).toEqual(['Moradia', 'Moradia › Gás', 'Moradia › Luz'])
    await userEvent.clear(box())
    await userEvent.type(box(), 'zzz')
    expect(screen.getByText('Nada encontrado.')).toBeInTheDocument()
  })

  it('teclado: ↓/↑ movem (anunciando a ativa), Enter escolhe, Esc fecha sem escolher', async () => {
    render(<Harness />)
    box().focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(box()).toHaveAttribute('aria-expanded', 'true')
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    const active = box().getAttribute('aria-activedescendant')
    expect(document.getElementById(active!)).toHaveAttribute('aria-label', 'Moradia › Luz')
    await userEvent.keyboard('{Enter}')
    expect(box()).toHaveValue('Moradia › Luz')
    expect(box()).toHaveAttribute('aria-expanded', 'false')

    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Escape}')
    expect(box()).toHaveAttribute('aria-expanded', 'false')
    expect(box()).toHaveValue('Moradia › Luz')
    await userEvent.keyboard('{End}')
  })

  it('Enter com a lista fechada deixa o formulário enviar; aberta, só escolhe', async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    box().focus()
    await userEvent.keyboard('{Enter}')
    expect(onSubmit).toHaveBeenCalledTimes(1)
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(box()).toHaveValue('Moradia › Gás')
  })

  it('Esc com a lista aberta não sobe para o painel em volta', async () => {
    const onKey = vi.fn()
    document.addEventListener('keydown', onKey)
    render(<Harness />)
    await userEvent.click(box())
    await userEvent.keyboard('{Escape}')
    expect(onKey).not.toHaveBeenCalled()
    await userEvent.keyboard('{Escape}') // fechada: segue para quem estiver ouvindo
    expect(onKey).toHaveBeenCalledTimes(1)
    document.removeEventListener('keydown', onKey)
  })

  it('"+ Nova …" fica sempre no fim e entrega o texto digitado', async () => {
    const onCreate = vi.fn()
    render(<Harness onCreate={onCreate} />)
    await userEvent.type(box(), 'Pets')
    expect(names()).toEqual(['Nova categoria “Pets”'])
    await userEvent.click(screen.getByRole('option', { name: /Nova categoria/ }))
    expect(onCreate).toHaveBeenCalledWith('Pets')
    expect(box()).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(box())
    expect(names().at(-1)).toBe('Nova categoria')
  })

  it('opção vazia ("nenhuma") limpa a escolha', async () => {
    render(<Harness emptyLabel="nenhuma" />)
    await userEvent.click(box())
    await userEvent.click(screen.getByRole('option', { name: 'nenhuma' }))
    expect(screen.getByLabelText('valor')).toHaveTextContent('')
    expect(box()).toHaveValue('')
  })
})
