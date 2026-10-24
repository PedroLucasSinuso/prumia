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
  initialFocus?: string
}

/**
 * Painel que sobe da base da tela (celular) ou fica centralizado (a partir de `sm`). Fecha com Esc, com o botão
 * ou tocando fora; prende o foco e o devolve ao fechar. `role="dialog"` + `aria-modal` para leitores de tela.
 * Cabeçalho, rodapé fixo e animações vêm de `ui/Panel`.
 */
export function Sheet(props: Props) {
  return <Panel variant="sheet" {...props} />
}
