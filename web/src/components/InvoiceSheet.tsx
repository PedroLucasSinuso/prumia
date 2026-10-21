import type { ComponentProps } from 'react'

import { InvoiceForm } from './InvoiceForm'
import { Sheet } from './Sheet'

type Props = ComponentProps<typeof InvoiceForm>

/** O formulário de conta dentro de um painel que sobe da base da tela (celular). */
export function InvoiceSheet(props: Props) {
  return (
    <Sheet title={props.invoice ? 'Detalhes da conta' : 'Nova conta'} onClose={props.onDone}>
      <InvoiceForm {...props} />
    </Sheet>
  )
}
