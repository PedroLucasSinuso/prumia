/**
 * Esqueleto de carregamento de uma tela: a moldura (AppShell) aparece na hora e só o conteúdo "pisca" em blocos
 * neutros enquanto o código da tela é baixado. Animação desligada para quem pediu menos movimento.
 */
export function PageSkeleton() {
  const block = 'rounded-md bg-ink/8 motion-safe:animate-pulse'
  return (
    <main role="status" aria-label="Carregando" className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pt-4 md:max-w-none md:px-10 md:pt-8">
      <span className="sr-only">Carregando…</span>
      <div className={`${block} h-8 w-48`} />
      <div className={`${block} h-4 w-72 max-w-full`} />
      <div className="mt-2 grid gap-4 md:grid-cols-3">
        <div className={`${block} h-24`} />
        <div className={`${block} hidden h-24 md:block`} />
        <div className={`${block} hidden h-24 md:block`} />
      </div>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className={`${block} h-12`} />
      ))}
    </main>
  )
}
