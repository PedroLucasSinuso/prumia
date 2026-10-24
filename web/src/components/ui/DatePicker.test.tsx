import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DatePicker } from './DatePicker'
import { MonthPicker } from './MonthPicker'

function Harness({ initial = '2026-10-20', ...props }: { initial?: string; min?: string; max?: string; error?: string; spy?: (v: string) => void }) {
  const [v, setV] = useState(initial)
  return (
    <>
      <DatePicker label="Vencimento" value={v} onChange={(x) => { setV(x); props.spy?.(x) }} min={props.min} max={props.max} error={props.error} />
      <output>{v}</output>
    </>
  )
}

afterEach(() => vi.useRealTimers())

describe('DatePicker', () => {
  it('mostra a data no formato brasileiro e abre o calendário em pt-BR, semana começando no domingo', async () => {
    render(<Harness />)
    const input = screen.getByLabelText('Vencimento')
    expect(input).toHaveValue('20/10/2026')
    await userEvent.click(screen.getByRole('button', { name: 'Abrir calendário' }))
    const dialog = screen.getByRole('dialog', { name: 'Escolher data' })
    expect(within(dialog).getByText('Outubro de 2026')).toBeInTheDocument()
    const heads = within(dialog).getAllByRole('columnheader').map((h) => h.textContent)
    expect(heads).toEqual(['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'])
    // 20/10/2026 é uma terça-feira, e o dia escolhido já vem com o foco
    expect(within(dialog).getByRole('button', { name: 'terça-feira, 20 de outubro de 2026' })).toHaveFocus()
    expect(within(dialog).getByRole('button', { name: 'quinta-feira, 1 de outubro de 2026' })).toBeInTheDocument()
  })

  it('escolhe uma data com o clique, guarda AAAA-MM-DD e devolve o foco', async () => {
    const spy = vi.fn()
    render(<Harness spy={spy} />)
    await userEvent.click(screen.getByRole('button', { name: 'Abrir calendário' }))
    await userEvent.click(screen.getByRole('button', { name: 'sexta-feira, 30 de outubro de 2026' }))
    expect(spy).toHaveBeenCalledWith('2026-10-30')
    expect(screen.getByLabelText('Vencimento')).toHaveValue('30/10/2026')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abrir calendário' })).toHaveFocus()
  })

  it('navega pelo teclado: setas, semana, mês, Home/End; Enter escolhe; Esc fecha e devolve o foco', async () => {
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Abrir calendário' })
    await userEvent.click(opener)
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('button', { name: /^quarta-feira, 21 de outubro/ })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('button', { name: /^quarta-feira, 28 de outubro/ })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}') // 4/11: o calendário troca de mês junto
    expect(screen.getByText('Novembro de 2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^quarta-feira, 4 de novembro/ })).toHaveFocus()
    await userEvent.keyboard('{Home}')
    expect(screen.getByRole('button', { name: /^domingo, 1 de novembro/ })).toHaveFocus()
    await userEvent.keyboard('{PageDown}')
    expect(screen.getByRole('button', { name: /^terça-feira, 1 de dezembro/ })).toHaveFocus()
    await userEvent.keyboard('{PageUp}{PageUp}')
    expect(screen.getByText('Outubro de 2026')).toBeInTheDocument()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByLabelText('Vencimento')).toHaveValue('01/10/2026')

    await userEvent.click(opener)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('Esc no calendário NÃO fecha um painel em volta', async () => {
    const onKey = vi.fn()
    document.addEventListener('keydown', onKey)
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Abrir calendário' }))
    await userEvent.keyboard('{Escape}')
    expect(onKey).not.toHaveBeenCalled()
    document.removeEventListener('keydown', onKey)
  })

  it('prende o Tab dentro do calendário', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Abrir calendário' }))
    const dialog = screen.getByRole('dialog', { name: 'Escolher data' })
    const hoje = within(dialog).getByRole('button', { name: 'Hoje' })
    const amanha = within(dialog).getByRole('button', { name: 'Amanhã' })
    amanha.focus()
    await userEvent.tab()
    // do último foi para o primeiro (a seta do mês anterior), em vez de sair do calendário
    expect(within(dialog).getByRole('button', { name: 'Mês anterior' })).toHaveFocus()
    await userEvent.tab({ shift: true })
    expect(amanha).toHaveFocus()
    expect(hoje).toBeInTheDocument()
  })

  it('respeita min e max: dias fora ficam desabilitados e a digitação fora é recusada', async () => {
    const spy = vi.fn()
    render(<Harness min="2026-10-10" max="2026-10-25" spy={spy} />)
    await userEvent.click(screen.getByRole('button', { name: 'Abrir calendário' }))
    const fora = screen.getByRole('button', { name: /^sábado, 31 de outubro/ })
    expect(fora).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(fora)
    expect(spy).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.keyboard('{PageDown}') // o foco nunca sai do intervalo
    expect(screen.getByRole('button', { name: /^domingo, 25 de outubro/ })).toHaveFocus()
    await userEvent.keyboard('{Escape}')

    const input = screen.getByLabelText('Vencimento')
    await userEvent.clear(input)
    await userEvent.type(input, '31102026')
    expect(screen.getByText('Use uma data até 25/10/2026.')).toBeInTheDocument()
    expect(spy).not.toHaveBeenCalled()
  })

  it('aceita digitar com máscara e recusa data que não existe', async () => {
    const spy = vi.fn()
    render(<Harness initial="" spy={spy} />)
    const input = screen.getByLabelText('Vencimento')
    await userEvent.type(input, '30022026')
    expect(input).toHaveValue('30/02/2026')
    expect(screen.getByText('Essa data não existe.')).toBeInTheDocument()
    expect(spy).not.toHaveBeenCalled()
    await userEvent.clear(input)
    await userEvent.type(input, '05112026')
    expect(spy).toHaveBeenCalledWith('2026-11-05')
  })

  it('atalhos Hoje e Amanhã usam a data de hoje', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 9, 31, 12) })
    const spy = vi.fn()
    render(<Harness spy={spy} />)
    await userEvent.click(screen.getByRole('button', { name: 'Abrir calendário' }))
    await userEvent.click(screen.getByRole('button', { name: 'Amanhã' }))
    expect(spy).toHaveBeenCalledWith('2026-11-01') // vira o mês
  })

  it('marca hoje com aria-current e mostra o erro como o Field', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 9, 20, 12) })
    render(<Harness error="Data inválida" />)
    expect(screen.getByLabelText('Vencimento')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Data inválida')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Abrir calendário' }))
    expect(screen.getByRole('button', { name: /^terça-feira, 20 de outubro/ })).toHaveAttribute('aria-current', 'date')
  })
})

describe('MonthPicker', () => {
  function Month({ min, max, spy }: { min?: string; max?: string; spy?: (v: string) => void }) {
    const [v, setV] = useState('2026-10')
    return <MonthPicker label="Competência" value={v} onChange={(x) => { setV(x); spy?.(x) }} min={min} max={max} clearable />
  }

  it('mostra o mês por extenso, escolhe pelo teclado e limpa', async () => {
    const spy = vi.fn()
    render(<Month spy={spy} />)
    const trigger = screen.getByRole('button', { name: /Competência/ })
    expect(trigger).toHaveTextContent('outubro de 2026')
    await userEvent.click(trigger)
    expect(screen.getByRole('button', { name: 'outubro de 2026' })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}{ArrowDown}{Enter}')
    expect(spy).toHaveBeenCalledWith('2027-02')
    expect(trigger).toHaveTextContent('fevereiro de 2027')
    expect(trigger).toHaveFocus()

    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('button', { name: 'Limpar' }))
    expect(spy).toHaveBeenLastCalledWith('')
    expect(trigger).toHaveTextContent('Escolher mês')
  })

  it('respeita min e max e fecha com Esc devolvendo o foco', async () => {
    const spy = vi.fn()
    render(<Month min="2026-09" max="2026-11" spy={spy} />)
    const trigger = screen.getByRole('button', { name: /Competência/ })
    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('button', { name: 'dezembro de 2026' }))
    expect(spy).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Ano anterior' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
