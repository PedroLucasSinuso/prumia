import type { ComponentProps } from 'react'

import { InvoiceForm } from './InvoiceForm'
import { Sheet } from './Sheet'

type Props = ComponentProps<typeof InvoiceForm> & { onClose: () => void }

/**
 * O formulário de conta dentro de um painel que sobe da base da tela (celular). Ao editar, `onCancel` volta ao detalhe
 * (modo leitura) e `onClose` (×, Esc, tocar fora) fecha tudo.
 */
export function InvoiceSheet({ onClose, ...props }: Props) {
  return (
    <Sheet title={props.invoice ? 'Editar conta' : 'Nova conta'} onClose={onClose}>
      <InvoiceForm {...props} />
    </Sheet>
  )
}
