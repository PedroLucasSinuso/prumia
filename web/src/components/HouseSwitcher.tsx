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
  const caption = inverse ? 'text-ivory/75' : 'text-graphite/70'

  // Barra lateral: uma linha compacta "papel · casa". Topo do celular: rótulo "casa" e o nome em destaque.
  const text = inverse ? (
    <span className="min-w-0 text-left leading-tight">
      <span className={`block text-[11px] uppercase tracking-wider ${caption}`}>casa</span>
      <span className="block truncate text-sm font-semibold">{house ? `${roleLabel[house.role]} · ${house.name}` : 'sem casa'}</span>
    </span>
  ) : (
    <span className="min-w-0 text-left leading-tight">
      <span className={`block text-[11px] uppercase tracking-wider ${caption}`}>casa</span>
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
        className={`flex min-h-11 min-w-0 items-center gap-2 rounded-md px-1 ${inverse ? 'hover:bg-ivory/8' : 'hover:bg-graphite/5'}`}
      >
        {text}
        <span aria-hidden="true" className={`font-mono text-xs ${caption}`}>▾</span>
      </button>
      {open && (
        // text-graphite: na barra lateral (teal) o texto herdado seria marfim sobre o painel marfim
        <div className="text-graphite">
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
                    className={`flex min-h-14 w-full items-center gap-3 rounded-md border px-3 text-left ${active ? 'border-teal bg-teal/8' : 'border-graphite/15 hover:bg-graphite/5'}`}
                  >
                    <span aria-hidden="true" className={`font-mono text-xs ${active ? 'text-teal' : 'text-graphite/60'}`}>
                      {active ? '[ ▪ ]' : '[ ▫ ]'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-semibold text-graphite">{h.name}</span>
                      <span className="block text-sm text-graphite/75">{roleLabel[h.role]}</span>
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
