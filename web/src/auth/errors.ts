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
  household_limit: 'Você chegou ao limite de casas criadas por você. Exclua uma casa que não usa para criar outra.',
  last_admin: 'A casa precisa de pelo menos uma pessoa administradora.',
  forbidden: 'Apenas administradores da casa podem fazer isso.',
  validation_error: 'Confira os campos destacados.',
  bad_request: 'Algum campo está num formato inválido (data, mês ou valor). Confira cada conta e tente de novo.',
  not_implemented: 'Este recurso ainda não está disponível.',
  category_exists: 'Já existe uma categoria com este nome (maiúsculas não contam).',
  category_in_use: 'Esta categoria está em uso. Arquive em vez de apagar.',
  payee_exists: 'Já existe um favorecido com este nome (maiúsculas não contam).',
  payee_cnpj_exists: 'Já existe um favorecido com este CNPJ.',
  payee_in_use: 'Este favorecido está em uso. Arquive em vez de apagar.',
  not_found: 'Não encontrado. Recarregue a página.',
}

// Leitura de boleto (POST /boletos/extract): códigos do servidor -> texto. `boleto_not_found` = nada válido no arquivo.
const boletoMessages: Record<string, string> = {
  file_too_large: 'O arquivo passa de 5 MB. Envie um PDF menor ou uma foto do boleto.',
  unsupported_file: 'Este arquivo não é PDF, PNG ou JPG. Escolha o PDF, uma foto ou um print do boleto.',
  boleto_not_found: 'Não consegui ler este boleto. Tente o PDF original ou uma foto mais nítida, ou preencha à mão.',
  password_required: 'Este PDF tem senha. Digite a senha para abrir.',
  wrong_password: 'Senha incorreta. Confira e tente de novo.',
  text_too_large: 'O texto passa de 20.000 caracteres. Cole menos linhas.',
  too_many_requests: messages.too_many_requests,
  busy: 'O servidor está lendo outros boletos agora. Tente de novo em alguns segundos.',
}

/** Mensagem de falha ao ler um boleto. Código desconhecido vira "não consegui ler" (nunca o texto cru do servidor). */
export function boletoErrorMessage(problem: Problem | undefined): string {
  return (problem?.code && boletoMessages[problem.code]) || boletoMessages.boleto_not_found
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
