import { Component, type ErrorInfo, type ReactNode } from 'react'

import { Button } from './ui/Button'

type Props = { children: ReactNode; /** Mudou a chave (ex.: o endereço), a tela tenta de novo sozinha. */ resetKey?: string }
type State = { failed: boolean }

/**
 * Rede de segurança: se um componente quebrar ao desenhar, o React desmonta a árvore inteira e a pessoa fica com a tela
 * em branco. Aqui o erro para nesta moldura e vira um aviso com saída. É uma classe porque o React só oferece
 * `componentDidCatch`/`getDerivedStateFromError` em componentes de classe (não existe hook para isso).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Só no console do navegador: o erro pode citar dados da tela, então não vai para servidor nenhum.
    console.error('erro ao desenhar a tela', error, info.componentStack)
  }

  componentDidUpdate(prev: Props) {
    // oxlint-disable-next-line react/no-did-update-set-state -- é o jeito de "tentar de novo" quando a tela muda; só roda depois de um erro
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false })
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" className="mx-auto flex max-w-md flex-col items-start gap-3 p-6">
        <p className="font-mono text-alert" aria-hidden="true">[ ✖ ]</p>
        <h1 className="font-display text-title font-semibold text-heading">Algo deu errado nesta tela</h1>
        <p className="text-sm text-muted">Seus dados estão salvos. Recarregue a página; se continuar, volte para o Mês.</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => window.location.reload()}>Recarregar</Button>
          <Button variant="secondary" onClick={() => window.location.assign(import.meta.env.BASE_URL)}>Ir para o Mês</Button>
        </div>
      </div>
    )
  }
}
