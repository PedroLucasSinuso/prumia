import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { Button, ButtonLink } from './Button'
import { EmptyState } from './EmptyState'
import { Eyebrow } from './Eyebrow'
import { FilterChips } from './FilterChips'
import { ListSkeleton } from './ListSkeleton'
import { Notice } from './Notice'
import { SectionRule } from './SectionRule'
import { SectionTitle } from './SectionTitle'
import { Stat } from './Stat'
import { Surface } from './Surface'
import { Tag } from './Tag'

describe('Surface', () => {
  it('a profundidade é tonal: raised por padrão, sem borda nem sombra', () => {
    render(<Surface as="section" aria-label="Pagamento">conteúdo</Surface>)
    const box = screen.getByRole('region', { name: 'Pagamento' })
    expect(box).toHaveAttribute('data-tone', 'raised')
    expect(box).toHaveClass('bg-raised', 'rounded-md', 'p-4')
    expect(box.className).not.toMatch(/\bborder\b|shadow/)
  })

  it.each([['sunken', 'bg-sunken'], ['structure', 'bg-structure']] as const)('tom %s', (tone, cls) => {
    render(<Surface tone={tone}>x</Surface>)
    expect(screen.getByText('x')).toHaveClass(cls)
  })

  it('flat não pinta fundo', () => {
    render(<Surface tone="flat" pad="none">x</Surface>)
    expect(screen.getByText('x').className).not.toMatch(/bg-/)
  })
})

describe('Stat', () => {
  it('rótulo, valor em mono e nota', () => {
    render(<Stat label="a pagar no mês" value="R$ 1.700,00" note="2 pendentes" />)
    expect(screen.getByText('a pagar no mês')).toHaveClass('uppercase', 'text-muted')
    const value = screen.getByText('R$ 1.700,00')
    expect(value).toHaveClass('font-mono', 'tabular-nums', 'text-figure')
    expect(screen.getByText('2 pendentes')).toBeInTheDocument()
  })

  it.each([
    ['primary', 'text-heading'],
    ['default', 'text-ink'],
    ['alert', 'text-alert-text'],
    ['muted', 'text-muted'],
  ] as const)('ênfase %s pinta o valor com %s', (emphasis, cls) => {
    render(<Stat label="x" value="R$ 1,00" emphasis={emphasis} />)
    expect(screen.getByText('R$ 1,00')).toHaveClass(cls)
  })

  it('tamanhos da escala figure', () => {
    render(<Stat label="x" value="R$ 2,00" size="lg" />)
    expect(screen.getByText('R$ 2,00')).toHaveClass('text-figure-lg')
  })
})

describe('Eyebrow e SectionTitle', () => {
  it('eyebrow: 11 px em caixa alta, nível de cabeçalho escolhido por quem usa', () => {
    render(<Eyebrow as="h2">próximos 7 dias</Eyebrow>)
    expect(screen.getByRole('heading', { level: 2, name: 'próximos 7 dias' })).toHaveClass('text-caption', 'uppercase', 'tracking-wider', 'text-muted')
  })

  it('SectionTitle: Archivo condensada na escala section', () => {
    render(<SectionTitle>Contas do mês</SectionTitle>)
    expect(screen.getByRole('heading', { level: 2, name: 'Contas do mês' })).toHaveClass('font-display', 'font-stretch-condensed', 'text-section', 'text-heading')
  })
})

describe('SectionRule', () => {
  it('rótulo, contagem, filete e total, como cabeçalho', () => {
    render(<SectionRule title="Atrasadas" count={2} total="R$ 1.700,00" tone="alert" />)
    const h = screen.getByRole('heading', { level: 3 })
    expect(h).toHaveTextContent('Atrasadas(2)R$ 1.700,00')
    expect(within(h).getByText('Atrasadas')).toHaveClass('text-alert-text')
  })

  it('com onToggle vira um botão de recolher com aria-expanded', async () => {
    const onToggle = vi.fn()
    render(<SectionRule title="Pagas" count={1} onToggle={onToggle} expanded controls="secao-pagas" />)
    const btn = screen.getByRole('button', { name: /Pagas/ })
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    expect(btn).toHaveAttribute('aria-controls', 'secao-pagas')
    await userEvent.click(btn)
    expect(onToggle).toHaveBeenCalledOnce()
  })
})

describe('Button', () => {
  it.each([
    ['primary', 'bg-structure'],
    ['secondary', 'border-line-strong'],
    ['quiet', 'hover:bg-ink/6'],
    ['danger', 'text-alert-text'],
  ] as const)('variante %s', (variant, cls) => {
    render(<Button variant={variant}>Ação</Button>)
    expect(screen.getByRole('button', { name: 'Ação' })).toHaveClass(cls)
  })

  it('tamanhos: md e sm mantêm 44 px no celular', () => {
    render(<><Button>Grande</Button><Button size="sm">Pequeno</Button></>)
    expect(screen.getByRole('button', { name: 'Grande' })).toHaveClass('h-11', 'md:h-9')
    expect(screen.getByRole('button', { name: 'Pequeno' })).toHaveClass('h-11', 'md:h-8')
  })

  it('icon é quadrado e usa o aria-label como nome', () => {
    render(<Button variant="icon" aria-label="Mês anterior">‹</Button>)
    expect(screen.getByRole('button', { name: 'Mês anterior' })).toHaveClass('size-11', 'md:size-9')
  })

  it('loading desabilita, marca aria-busy e troca o texto', () => {
    render(<Button loading loadingLabel="Criando…">Criar</Button>)
    const btn = screen.getByRole('button', { name: 'Criando…' })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-busy', 'true')
  })

  it('ButtonLink é um link com o visual do botão', () => {
    render(<MemoryRouter><ButtonLink to="/importar">Importar</ButtonLink></MemoryRouter>)
    const link = screen.getByRole('link', { name: 'Importar' })
    expect(link).toHaveAttribute('href', '/importar')
    expect(link).toHaveClass('border-line-strong', 'h-11')
  })
})

describe('FilterChips', () => {
  function Harness() {
    const [v, setV] = useState<'all' | 'open' | 'paid'>('all')
    return <FilterChips label="Filtrar contas" value={v} onChange={setV} options={[{ value: 'all', label: 'Todas', count: 3 }, { value: 'open', label: 'A pagar', count: 2 }, { value: 'paid', label: 'Pagas', count: 1 }]} />
  }

  it('grupo com botões de alternância; a ativa sobe para raised', async () => {
    render(<Harness />)
    const group = screen.getByRole('group', { name: 'Filtrar contas' })
    expect(group).toHaveClass('bg-sunken')
    const todas = within(group).getByRole('button', { name: 'Todas 3' })
    expect(todas).toHaveAttribute('aria-pressed', 'true')
    expect(todas).toHaveClass('bg-raised')
    await userEvent.click(within(group).getByRole('button', { name: 'A pagar 2' }))
    expect(within(group).getByRole('button', { name: 'A pagar 2' })).toHaveAttribute('aria-pressed', 'true')
    expect(todas).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('estados', () => {
  it('Notice: alerta anunciado, texto em alert-text e "Tentar de novo"', async () => {
    const retry = vi.fn()
    render(<Notice onRetry={retry}>Não foi possível carregar as contas.</Notice>)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Não foi possível carregar as contas.')
    expect(within(alert).getByText('Não foi possível carregar as contas.').parentElement).toHaveClass('text-alert-text')
    await userEvent.click(within(alert).getByRole('button', { name: 'Tentar de novo' }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it('Notice sem onRetry não mostra botão', () => {
    render(<Notice>Falhou.</Notice>)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('EmptyState: frase, explicação e ações, sem borda tracejada', () => {
    render(<EmptyState title="Nenhuma conta neste mês." actions={<Button>Lançar</Button>}>Comece pela primeira.</EmptyState>)
    const title = screen.getByText('Nenhuma conta neste mês.')
    expect(screen.getByText('Comece pela primeira.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lançar' })).toBeInTheDocument()
    expect(title.closest('div')!.className).not.toMatch(/dashed/)
  })

  it('ListSkeleton: status com nome, linhas decorativas que só pulsam com motion-safe', () => {
    render(<ListSkeleton label="Carregando as contas" rows={4} />)
    const status = screen.getByRole('status', { name: 'Carregando as contas' })
    const lines = status.querySelectorAll('[aria-hidden="true"]')
    expect(lines).toHaveLength(4)
    expect(lines[0]).toHaveClass('motion-safe:animate-pulse')
    expect(lines[0].className).not.toMatch(/(^|\s)animate-pulse/)
  })

  it('Tag: selo mono discreto', () => {
    render(<Tag title="Benefício">VR</Tag>)
    expect(screen.getByText('VR')).toHaveClass('font-mono', 'text-caption', 'text-muted')
    expect(screen.getByText('VR')).toHaveAttribute('title', 'Benefício')
  })
})
