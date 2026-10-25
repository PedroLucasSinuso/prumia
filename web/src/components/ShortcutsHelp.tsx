import { Keyboard, X } from 'lucide-react'

import { Button } from './ui/Button'
import { Eyebrow } from './ui/Eyebrow'
import { Tooltip } from './ui/Tooltip'

/** Atalhos de teclado da tela do mês (computador). A mesma lista serve para a ajuda "?" e para a documentação. */
export type Shortcut = [keys: string, action: string]
const MONTH_SHORTCUTS: Shortcut[] = [
  ['N', 'nova conta'],
  ['← / →', 'mês anterior / próximo'],
  ['/', 'buscar'],
  ['↑ / ↓', 'andar pela lista'],
  ['Enter', 'abrir a conta'],
  ['Espaço ou P', 'pagar / desfazer'],
  ['Shift + clique', 'marcar várias'],
  ['Esc', 'fechar / limpar seleção'],
  ['?', 'mostrar estes atalhos'],
]

const kbd = 'inline-flex min-w-6 justify-center rounded-sm bg-sunken px-1.5 font-mono text-caption leading-5'

/** Botão "?" discreto que abre a lista de atalhos (sem janela modal: Esc ou o × fecham). */
export function ShortcutsHelp({ open, onToggle, items = MONTH_SHORTCUTS }: { open: boolean; onToggle: () => void; items?: Shortcut[] }) {
  return (
    <div className="relative">
      <Tooltip label="Atalhos de teclado" shortcut="?">
        <Button variant="icon" aria-label="Atalhos de teclado" aria-expanded={open} onClick={onToggle}>
          <Keyboard size={18} strokeWidth={1.5} aria-hidden="true" />
        </Button>
      </Tooltip>
      {open && (
        <section aria-label="Lista de atalhos" className="absolute right-0 top-11 z-30 w-72 rounded-md border border-line bg-raised p-4 motion-safe:animate-fade-in">
          <div className="mb-2 flex items-center justify-between">
            <Eyebrow as="h2">Atalhos</Eyebrow>
            <Button variant="icon" size="sm" aria-label="Fechar atalhos" onClick={onToggle}>
              <X size={16} strokeWidth={1.5} aria-hidden="true" />
            </Button>
          </div>
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-ui">
            {items.map(([k, v]) => (
              <div key={k} className="contents">
                <dt><kbd className={kbd}>{k}</kbd></dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  )
}
