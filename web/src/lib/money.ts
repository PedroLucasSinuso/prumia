// Dinheiro é sempre inteiro em centavos (igual ao backend). Nunca use float para somar valores.
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/** Formata centavos como "R$ 1.234,56". */
export function formatCents(cents: number): string {
  // Intl usa espaço não separável entre "R$" e o número; normaliza para facilitar testes e cópia.
  return brl.format(cents / 100).replace(/ /g, ' ')
}

/** Como `formatCents`, mas com o sinal sempre à vista ("+R$ 12,00", "-R$ 3,00"): diferenças e ajustes. */
export function formatSignedCents(cents: number): string {
  return cents > 0 ? '+' + formatCents(cents) : formatCents(cents)
}

/**
 * Converte o que a pessoa digitou num campo de dinheiro em centavos: só os dígitos contam
 * ("R$ 1.500,00" -> 150000; "15" -> 15 centavos). Limita a 12 dígitos (R$ 10 bilhões), como o backend.
 */
export function digitsToCents(text: string): number {
  const digits = text.replace(/\D/g, '').slice(0, 12)
  return digits ? Number(digits) : 0
}
