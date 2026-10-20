import type { ReactNode } from 'react'

/** Moldura das telas de entrada: faixa teal com a marca, painel central e slogan. */
export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-teal text-ivory">
        <div className="mx-auto max-w-md px-4 py-4">
          <span className="text-xl font-semibold tracking-tight">prumia</span>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-graphite/70">Clareza para construir o futuro.</p>
        </div>
        {children}
      </main>
    </div>
  )
}
