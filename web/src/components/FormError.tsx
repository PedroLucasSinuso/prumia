/** Aviso geral de um formulário (acima dos campos). role=alert para leitores de tela anunciarem. */
export function FormError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p role="alert" className="rounded-md border border-signal/60 bg-signal/10 px-3 py-2 text-sm text-graphite">
      <span className="font-mono text-signal">[ ✖ ]</span> {message}
    </p>
  )
}
