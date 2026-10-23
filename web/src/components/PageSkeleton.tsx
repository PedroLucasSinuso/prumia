import { AppShell } from './AppShell'

/** Esqueleto enquanto uma tela carrega: a moldura (menu) aparece na hora e só o conteúdo "respira", em vez de tela em branco. */
export function PageSkeleton() {
  const block = 'rounded-md bg-ink/10 motion-safe:animate-pulse'
  return (
    <AppShell>
      <div role="status" aria-label="Carregando" className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pt-6 md:max-w-none md:px-10 md:pt-8">
        <div className={`${block} h-9 w-56`} />
        <div className="grid gap-4 md:grid-cols-3">
          <div className={`${block} h-24`} />
          <div className={`${block} hidden h-24 md:block`} />
          <div className={`${block} hidden h-24 md:block`} />
        </div>
        <div className={`${block} h-40`} />
        <div className={`${block} h-16`} />
        <div className={`${block} h-16`} />
      </div>
    </AppShell>
  )
}
