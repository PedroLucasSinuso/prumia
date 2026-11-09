import { noteResponse, resetOffline } from './offline'

// O estado é lido pelo hook; aqui basta observar o efeito via useStaleSince com um componente mínimo.
import { render, screen, act } from '@testing-library/react'
import { OfflineBanner } from '../components/OfflineBanner'

const cached = (at: number, status = 200) => new Response('{}', { status, headers: { 'x-prumia-cached-at': String(at) } })

describe('OfflineBanner', () => {
  afterEach(() => act(() => resetOffline()))

  it('fica oculto com dados frescos', () => {
    render(<OfflineBanner />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('aparece quando a resposta é uma cópia guardada e some com uma resposta fresca', () => {
    render(<OfflineBanner />)
    act(() => noteResponse(cached(new Date(2026, 10, 7, 21, 40).getTime())))
    expect(screen.getByRole('status')).toHaveTextContent('Sem conexão com o servidor')
    expect(screen.getByRole('status')).toHaveTextContent('07/11')
    act(() => noteResponse(new Response('{}')))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('ignora escritas e respostas 5xx sem cópia', () => {
    render(<OfflineBanner />)
    act(() => noteResponse(cached(1000), 'POST'))
    act(() => noteResponse(new Response('', { status: 530 })))
    expect(screen.queryByRole('status')).toBeNull()
  })
})
