import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'

import { ErrorBoundary } from './ErrorBoundary'

function Quebra({ quebrar }: { quebrar: boolean }): never | string {
  if (quebrar) throw new Error('falha de teste')
  return 'tela boa'
}

describe('ErrorBoundary', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}))

  it('mostra o aviso com saída em vez de tela em branco', () => {
    render(<ErrorBoundary><Quebra quebrar /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toHaveTextContent('Algo deu errado nesta tela')
    expect(screen.getByRole('button', { name: 'Recarregar' })).toBeInTheDocument()
  })

  it('tenta de novo quando a chave muda (troca de tela)', () => {
    const { rerender } = render(<ErrorBoundary resetKey="/a"><Quebra quebrar /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    rerender(<ErrorBoundary resetKey="/b"><Quebra quebrar={false} /></ErrorBoundary>)
    expect(screen.getByText('tela boa')).toBeInTheDocument()
  })
})
