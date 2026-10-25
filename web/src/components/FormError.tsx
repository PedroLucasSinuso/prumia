import { Notice } from './ui/Notice'

/** Aviso geral de um formulário (acima dos campos). É um `Notice` (role=alert, texto em `alert-text`) sem "Tentar de novo". */
export function FormError({ message }: { message?: string }) {
  if (!message) return null
  return <Notice>{message}</Notice>
}
