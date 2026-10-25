import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { Button } from './Button'
import { Sheet } from '../Sheet'
import { SlideOver } from '../SlideOver'
import { PanelFooter } from './Panel'

function App({ side = false, onClose }: { side?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  const Cmp = side ? SlideOver : Sheet
  return (
    <>
      <button onClick={() => setOpen(true)}>Abrir</button>
      {open && (
        <Cmp title="Nova conta" subtitle="Outubro de 2026" onClose={() => { setOpen(false); onClose?.() }} footer={<Button>Salvar</Button>}>
          <input aria-label="Valor" data-autofocus />
          <input aria-label="Descrição" />
        </Cmp>
      )}
    </>
  )
}

describe.each([['Sheet', false], ['SlideOver', true]])('%s (cromo de painel)', (_name, side) => {
  it('tem cabeçalho (título, subtítulo, fechar) e rodapé fixo, como diálogo modal', async () => {
    render(<App side={side} />)
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    const dialog = screen.getByRole('dialog', { name: 'Nova conta' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByText('Outubro de 2026')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Fechar' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Salvar' })).toBeInTheDocument()
  })

  it('foca o campo marcado, prende o Tab dentro e devolve o foco ao fechar com Esc', async () => {
    const onClose = vi.fn()
    render(<App side={side} onClose={onClose} />)
    const opener = screen.getByRole('button', { name: 'Abrir' })
    await userEvent.click(opener)
    expect(screen.getByLabelText('Valor')).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByLabelText('Descrição')).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Salvar' })).toHaveFocus() // o rodapé entra no Tab
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Fechar' })).toHaveFocus() // ...e no fim dá a volta (o 1º do painel)
    await userEvent.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Salvar' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('fecha com o × e ao clicar no fundo, mas não ao clicar dentro', async () => {
    const onClose = vi.fn()
    const { container } = render(<App side={side} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    await userEvent.click(screen.getByLabelText('Descrição'))
    expect(onClose).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    const backdrop = container.querySelector('.fixed')!
    await userEvent.pointer({ keys: '[MouseLeft]', target: backdrop })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('PanelFooter', () => {
  it('renderiza a ação principal no fim do formulário', () => {
    render(
      <form>
        <PanelFooter>
          <Button type="submit">Adicionar conta</Button>
        </PanelFooter>
      </form>,
    )
    expect(screen.getByRole('button', { name: 'Adicionar conta' })).toBeInTheDocument()
  })
})

describe('Button loading', () => {
  it('desabilita, mostra o texto de carregamento e marca aria-busy', () => {
    const { rerender } = render(<Button loading>Criar</Button>)
    const btn = screen.getByRole('button', { name: 'Salvando…' })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-busy', 'true')
    rerender(<Button loading loadingLabel="Criando…">Criar</Button>)
    expect(screen.getByRole('button', { name: 'Criando…' })).toBeDisabled()
    rerender(<Button>Criar</Button>)
    expect(screen.getByRole('button', { name: 'Criar' })).toBeEnabled()
  })
})
