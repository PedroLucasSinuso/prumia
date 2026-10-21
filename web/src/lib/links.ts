/** Links que o app entrega a quem convida / redefine. O token vai na query e só existe no navegador de quem recebe. */
export const inviteLink = (token: string) => `${window.location.origin}/convite?token=${encodeURIComponent(token)}`
export const resetLink = (token: string) => `${window.location.origin}/redefinir-senha?token=${encodeURIComponent(token)}`

/** Copia para a área de transferência; false se o navegador não deixar (o link continua na tela para copiar à mão). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
