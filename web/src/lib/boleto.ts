/** Só os dígitos: é o que vai para a área de transferência (o app do banco aceita colar assim). */
export const onlyDigits = (text: string) => text.replace(/\D/g, '')

/** Limite do servidor para o arquivo do boleto (5 MB). Conferido também aqui para não enviar à toa. */
export const MAX_BOLETO_BYTES = 5 * 1024 * 1024

/**
 * Linha digitável agrupada para leitura (só na exibição; o dado continua só com dígitos):
 * - boleto bancário (47 dígitos): 00190.00009 01234.567890 12345.678901 2 12340000010000
 * - conta de consumo / arrecadação (48 dígitos, começa com 8): 4 blocos de 11 + dígito verificador
 * - outro tamanho: blocos de 5.
 */
export function formatDigitableLine(line: string): string {
  const d = onlyDigits(line)
  if (d.length === 47) {
    return `${d.slice(0, 5)}.${d.slice(5, 10)} ${d.slice(10, 15)}.${d.slice(15, 21)} ${d.slice(21, 26)}.${d.slice(26, 32)} ${d.slice(32, 33)} ${d.slice(33)}`
  }
  if (d.length === 48 && d.startsWith('8')) {
    return [0, 12, 24, 36].map((i) => `${d.slice(i, i + 11)}-${d.slice(i + 11, i + 12)}`).join(' ')
  }
  return d.match(/.{1,5}/g)?.join(' ') ?? ''
}
