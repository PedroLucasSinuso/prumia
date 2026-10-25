import type { ReactNode } from 'react'

import { Logo } from './Logo'
import { SectionTitle } from './ui/SectionTitle'

/**
 * Moldura das telas de entrada. Celular: faixa `nav` com a marca e o formulário abaixo.
 * Computador: painel `nav` à esquerda com a marca e o slogan, formulário à direita.
 */
export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="flex items-center gap-3 bg-nav px-4 py-4 text-on-nav md:w-[44%] md:flex-col md:items-start md:justify-between md:gap-0 md:p-12">
        <div className="flex items-center gap-3">
          <Logo size={40} tone="inverse" />
          <span className="font-display text-section font-semibold tracking-tight">prumia</span>
        </div>
        <p className="hidden max-w-sm font-display text-page font-bold leading-none tracking-tight font-stretch-condensed md:block">
          Clareza para construir o futuro.
        </p>
      </aside>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-8 md:px-12">
        <div>
          <SectionTitle as="h1" size="page" className="tracking-tight">{title}</SectionTitle>
          <p className="mt-1 text-sm text-muted md:hidden">Clareza para construir o futuro.</p>
        </div>
        {children}
      </main>
    </div>
  )
}
