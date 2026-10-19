// Dinheiro é sempre inteiro em centavos (igual ao backend). Nunca use float para somar valores.
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/** Formata centavos como "R$ 1.234,56". */
export function formatCents(cents: number): string {
  // Intl usa espaço não separável entre "R$" e o número; normaliza para facilitar testes e cópia.
  return brl.format(cents / 100).replace(/ /g, ' ')
}
