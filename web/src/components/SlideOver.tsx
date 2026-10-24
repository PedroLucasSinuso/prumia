import type { ReactNode } from 'react'

import { Panel } from './ui/Panel'

type Props = {
  title: string
  /** Linha de apoio sob o título. */
  subtitle?: string
  onClose: () => void
  children: ReactNode
  /** Rodapé fixo opcional (ação primária e secundária). */
  footer?: ReactNode
  /** Seletor do elemento que recebe o foco ao abrir (padrão: o marcado com `data-autofocus`; sem ele, o próprio painel). */
  initialFocus?: string
}

/**
 * Painel lateral de altura total, à direita (computador). Fecha com Esc, com o × ou clicando fora. Enquanto aberto,
 * o Tab circula só dentro dele (foco preso) e, ao fechar, o foco volta para quem o abriu.
 * `role="dialog"` + `aria-modal` para leitores de tela. Celular usa o `Sheet` (sobe da base).
 * Cabeçalho, rodapé fixo e animações vêm de `ui/Panel` (ver a seção "Componentes de interface" do guia do front).
 */
export function SlideOver(props: Props) {
  return <Panel variant="side" {...props} />
}
