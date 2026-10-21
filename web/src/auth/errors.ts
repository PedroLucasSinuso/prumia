import type { Problem } from '../api/types'

// Textos em pt-BR para os códigos estáveis de erro da API. O front nunca mostra a mensagem crua do servidor
// para erros inesperados: só estes textos (ou um genérico).
const messages: Record<string, string> = {
  invalid_credentials: 'E-mail ou senha incorretos.',
  email_taken: 'Já existe uma conta com este e-mail.',
  registration_closed:
    'O cadastro livre está desativado. Peça um convite a quem administra a casa.',
  too_many_requests: 'Muitas tentativas. Aguarde um minuto e tente de novo.',
  bad_origin: 'Requisição bloqueada por segurança. Recarregue a página e tente de novo.',
  invalid_invite: 'Este convite é inválido, expirou ou foi revogado. Peça um novo a quem administra a casa.',
  invite_used: 'Este convite já foi usado.',
  already_member: 'Você já faz parte desta casa.',
  last_admin: 'A casa precisa de pelo menos uma pessoa administradora.',
  forbidden: 'Apenas administradores da casa podem fazer isso.',
  validation_error: 'Confira os campos destacados.',
  not_implemented: 'Este recurso ainda não está disponível.',
  // boleto (POST /boletos/extract). Códigos sem texto próprio caem em "não consegui ler" (ver boletoErrorMessage).
  file_too_large: 'O arquivo passa de 5 MB. Envie um PDF menor ou uma foto do boleto.',
  boleto_unreadable: 'Não consegui ler este boleto. Tente o PDF original ou uma foto mais nítida, ou preencha à mão.',
  password_required: 'Este PDF tem senha. Digite a senha para abrir.',
  invalid_password: 'Senha incorreta. Confira e tente de novo.',
}

// Sinônimos que o servidor pode usar para os mesmos casos do boleto.
const boletoAliases: Record<string, string> = {
  payload_too_large: 'file_too_large', wrong_password: 'invalid_password', bad_password: 'invalid_password',
}

/** Mensagem de falha ao ler um boleto. Qualquer código desconhecido vira "não consegui ler" (nunca o texto cru do servidor). */
export function boletoErrorMessage(problem: Problem | undefined): string {
  const code = problem?.code ? (boletoAliases[problem.code] ?? problem.code) : 'boleto_unreadable'
  if (code === 'too_many_requests') return messages.too_many_requests
  return messages[code] && code !== 'validation_error' ? messages[code] : messages.boleto_unreadable
}

/** Normaliza o código de erro do boleto (aceita sinônimos). */
export function boletoErrorCode(problem: Problem | undefined): string | undefined {
  return problem?.code ? (boletoAliases[problem.code] ?? problem.code) : undefined
}

export const networkErrorMessage = 'Não foi possível falar com o servidor. Verifique sua conexão.'
const genericMessage = 'Algo deu errado. Tente de novo em instantes.'

/** Mensagem geral (acima do formulário) para um erro da API. */
export function problemMessage(problem: Problem | undefined): string {
  if (!problem) return genericMessage
  return (problem.code && messages[problem.code]) || genericMessage
}

/** Erros por campo (ex.: { email: "e-mail inválido" }), vindos de validation_error. */
export function problemFields(problem: Problem | undefined): Record<string, string> {
  return problem?.fields ?? {}
}
