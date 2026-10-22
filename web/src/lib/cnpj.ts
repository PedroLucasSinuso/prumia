/** Só os dígitos (o servidor aceita qualquer máscara, mas guarda assim). */
export const cnpjDigits = (s: string) => s.replace(/\D/g, '')

/** 00.000.000/0000-00 enquanto digita; o que passar de 14 dígitos é descartado. */
export function formatCnpj(s: string): string {
  const d = cnpjDigits(s).slice(0, 14)
  const parts = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 8), d.slice(8, 12), d.slice(12)]
  let out = parts[0]
  if (parts[1]) out += '.' + parts[1]
  if (parts[2]) out += '.' + parts[2]
  if (parts[3]) out += '/' + parts[3]
  if (parts[4]) out += '-' + parts[4]
  return out
}
