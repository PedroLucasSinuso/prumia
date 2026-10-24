import { Keyboard, X } from 'lucide-react'

import { Tooltip } from './ui/Tooltip'

/** Atalhos de teclado da tela do mês (computador). A mesma lista serve para a ajuda "?" e para a documentação. */
const MONTH_SHORTCUTS: Array<[string, string]> = [
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

const kbd = 'inline-flex min-w-6 justify-center rounded-sm border border-ink/30 px-1.5 font-mono text-[11px] leading-5'

/** Botão "?" discreto que abre a lista de atalhos (sem janela modal: Esc ou o × fecham). */
export function ShortcutsHelp({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="relative">
      <Tooltip label="Atalhos de teclado" shortcut="?">
        <button
          aria-label="Atalhos de teclado"
          aria-expanded={open}
          onClick={onToggle}
          className="flex size-9 items-center justify-center rounded-md border border-ink/30 text-ink transition-colors hover:bg-ink/5 active:bg-ink/10"
        >
          <Keyboard size={18} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </Tooltip>
      {open && (
        <section aria-label="Lista de atalhos" className="absolute right-0 top-11 z-30 w-72 rounded-md border border-line bg-surface p-4 motion-safe:animate-fade-in">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider">Atalhos</h2>
            <button aria-label="Fechar atalhos" onClick={onToggle} className="flex size-7 items-center justify-center rounded-sm hover:bg-ink/5">
              <X size={16} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-[13px]">
            {MONTH_SHORTCUTS.map(([k, v]) => (
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
