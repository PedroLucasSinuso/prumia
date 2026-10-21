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
