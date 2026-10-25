import { useState } from 'react'

/**
 * Faixa fixa da demonstração: avisa que os dados são fictícios e que nada é salvo. Pode ser recolhida (fica só o selo).
 * "Recomeçar" recarrega a página, o que volta a casa de exemplo ao estado inicial.
 */
export function DemoBanner() {
  const [open, setOpen] = useState(true)
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-3 md:bottom-4 z-50 rounded-md bg-structure px-2.5 py-1 text-meta font-semibold text-on-structure shadow-sm"
      >
        demonstração
      </button>
    )
  }
  return (
    <div role="note" aria-label="Demonstração" className="fixed bottom-20 right-3 md:bottom-4 z-50 max-w-xs rounded-md border border-line bg-raised p-3 text-ink shadow-sm">
      <p className="text-meta font-semibold uppercase tracking-wider text-heading">demonstração</p>
      <p className="mt-1 text-meta text-muted">
        Casa de exemplo com dados fictícios. Mexa à vontade: nada é salvo e tudo volta ao início ao recarregar.
      </p>
      <div className="mt-2 flex gap-3 text-meta">
        <button type="button" className="font-semibold text-accent underline underline-offset-2" onClick={() => location.reload()}>
          Recomeçar
        </button>
        <button type="button" className="text-muted underline underline-offset-2" onClick={() => setOpen(false)}>
          Recolher
        </button>
      </div>
    </div>
  )
}
