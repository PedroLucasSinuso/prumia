import { useState } from 'react'

import { useActiveHouse } from '../auth/useActiveHouse'
import { roleLabel } from '../lib/roles'
import { Sheet } from './Sheet'

/**
 * Casa ativa no topo (celular) ou na barra lateral (computador). Com uma casa só, é apenas o nome.
 * Com duas ou mais, o nome vira um botão que abre a lista de casas: um toque troca de casa.
 */
export function HouseSwitcher({ tone = 'light' }: { tone?: 'light' | 'inverse' }) {
  const { house, houses, selectHouse } = useActiveHouse()
  const [open, setOpen] = useState(false)
  const inverse = tone === 'inverse'
  const caption = inverse ? 'text-on-nav' : 'text-muted'

  // Barra lateral: uma linha compacta "papel · casa". Topo do celular: rótulo "casa" e o nome em destaque.
  const text = inverse ? (
    <span className="min-w-0 text-left leading-tight">
      <span className={`block text-caption uppercase tracking-wider ${caption}`}>casa</span>
      <span className="block truncate text-sm font-semibold">{house ? `${roleLabel[house.role]} · ${house.name}` : 'sem casa'}</span>
    </span>
  ) : (
    <span className="min-w-0 text-left leading-tight">
      <span className={`block text-caption uppercase tracking-wider ${caption}`}>casa</span>
      <span className="block truncate text-base font-semibold">{house?.name ?? 'Sem casa'}</span>
    </span>
  )

  if (houses.length < 2) return <div className="min-w-0">{text}</div>

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`Casa ativa: ${house?.name}. Trocar de casa`}
        onClick={() => setOpen(true)}
        className={`flex min-h-11 min-w-0 items-center gap-2 rounded-md px-1 ${inverse ? 'hover:bg-on-nav/8' : 'hover:bg-ink/5'}`}
      >
        {text}
        <span aria-hidden="true" className={`font-mono text-meta ${caption}`}>▾</span>
      </button>
      {open && (
        // text-ink: na barra lateral (teal) o texto herdado seria marfim sobre o painel marfim
        <div className="text-ink">
        <Sheet title="Trocar de casa" onClose={() => setOpen(false)}>
          <ul className="flex flex-col gap-2">
            {houses.map((h) => {
              const active = h.id === house?.id
              return (
                <li key={h.id}>
                  <button
                    type="button"
                    aria-current={active ? 'true' : undefined}
                    onClick={() => {
                      if (!active) selectHouse(h.id)
                      setOpen(false)
                    }}
                    className={`flex min-h-14 w-full items-center gap-3 rounded-md border px-3 text-left ${active ? 'border-accent bg-raised' : 'border-line hover:bg-raised'}`}
                  >
                    <span aria-hidden="true" className={`font-mono text-meta ${active ? 'text-heading' : 'text-muted'}`}>
                      {active ? '[ ▪ ]' : '[ ▫ ]'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-semibold text-ink">{h.name}</span>
                      <span className="block text-sm text-muted">{roleLabel[h.role]}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Sheet>
        </div>
      )}
    </>
  )
}
