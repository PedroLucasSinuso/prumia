/** Links que o app entrega a quem convida / redefine. O token vai no fragmento (`#`): ele só existe no navegador de quem
 * recebe e nunca chega ao servidor nem aos logs (quem lê é `useLinkToken`). */
// `base` é o endereço público configurado no servidor (`me.publicUrl`); sem ele, o endereço do navegador de quem gera o link
// (que em `localhost` não abre no celular de quem recebe).
export const inviteLink = (token: string, base?: string) => `${base ?? window.location.origin}/convite#token=${encodeURIComponent(token)}`
export const signupLink = (token: string, base?: string) => `${base ?? window.location.origin}/cadastro#token=${encodeURIComponent(token)}`
export const resetLink = (token: string, base?: string) => `${base ?? window.location.origin}/redefinir-senha#token=${encodeURIComponent(token)}`

/** Copia para a área de transferência; false se o navegador não deixar (o link continua na tela para copiar à mão). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
