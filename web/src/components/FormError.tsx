/** Aviso geral de um formulário (acima dos campos). role=alert para leitores de tela anunciarem. */
export function FormError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p role="alert" className="rounded-md border border-alert/60 bg-alert/10 px-3 py-2 text-sm text-ink">
      <span className="font-mono text-alert">[ ✖ ]</span> {message}
    </p>
  )
}
