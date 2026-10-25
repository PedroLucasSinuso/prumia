import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { Button } from './Button'
import { Sheet } from '../Sheet'
import { SlideOver } from '../SlideOver'
import { PanelFooter } from './Panel'

function Tall({ side }: { side: boolean }) {
  const Cmp = side ? SlideOver : Sheet
  return (
    <Cmp title="Alto" onClose={() => {}} footer={<Button>Salvar</Button>}>
      {Array.from({ length: 40 }, (_, i) => (
        <input key={i} aria-label={`Campo ${i}`} />
      ))}
    </Cmp>
  )
}

describe('rolagem do painel', () => {
  it.each([['Sheet', false], ['SlideOver', true]])('%s: o corpo é o único que rola e o rodapé fica no fluxo do painel', (_n, side) => {
    render(<Tall side={side} />)
    const dialog = screen.getByRole('dialog')
    const body = dialog.querySelector('[data-panel-body]')!
    expect(body.className).toMatch(/overflow-y-auto/)
    expect(body.className).toMatch(/min-h-0/)
    expect(body.className).toMatch(/overscroll-contain/)
    expect(body.className).toMatch(/scroll-pb-/)
    expect(dialog.className).toMatch(/flex-col/)
    expect(dialog.parentElement!.innerHTML).toMatch(/dvh/)
    const footer = screen.getByRole('button', { name: 'Salvar' }).parentElement!
    expect(footer.parentElement).toBe(dialog) // irmão do corpo, não filho dele nem da página
    expect(footer.className).not.toMatch(/\bfixed\b/)
    expect(footer.className).toMatch(/shrink-0/)
    expect(footer.className).toMatch(/bg-surface/)
    expect(footer.className).toMatch(/border-t/)
    expect(footer.className).toMatch(/safe-area-inset-bottom/)
  })

  it('PanelFooter é sticky (nunca fixed) com fundo opaco e borda', () => {
    render(
      <form>
        <PanelFooter>
          <Button>Ok</Button>
        </PanelFooter>
      </form>,
    )
    const f = screen.getByRole('button', { name: 'Ok' }).parentElement!
    expect(f.className).toMatch(/sticky/)
    expect(f.className).not.toMatch(/\bfixed\b/)
    expect(f.className).toMatch(/bg-surface/)
    expect(f.className).toMatch(/border-line/)
  })

  it('trava a rolagem da página enquanto aberto e restaura ao fechar e ao desmontar', async () => {
    document.body.style.overflow = 'scroll'
    const { unmount } = render(<Tall side={false} />)
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('scroll')
    document.body.style.overflow = ''

    function Toggle() {
      const [open, setOpen] = useState(true)
      return open ? <Sheet title="x" onClose={() => setOpen(false)}>a</Sheet> : <p>fechado</p>
    }
    render(<Toggle />)
    expect(document.body.style.overflow).toBe('hidden')
    await userEvent.keyboard('{Escape}')
    expect(document.body.style.overflow).toBe('')
  })

  it('dois painéis empilhados só destravam quando o último fecha', () => {
    const a = render(<Sheet title="a" onClose={() => {}}>a</Sheet>)
    const b = render(<Sheet title="b" onClose={() => {}}>b</Sheet>)
    b.unmount()
    expect(document.body.style.overflow).toBe('hidden')
    a.unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
