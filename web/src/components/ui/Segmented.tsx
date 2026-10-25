import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'

import { labelCls } from './styles'

export type SegmentedOption<T extends string> = {
  value: T
  label: ReactNode
  /** Texto para leitores de tela quando `label` não for só texto. */
  ariaLabel?: string
  disabled?: boolean
}

type Props<T extends string> = {
  /** Nome do grupo (lido por leitores de tela). Aparece como rótulo visível, a menos que `hideLabel`. */
  label: string
  hideLabel?: boolean
  options: SegmentedOption<T>[]
  value: T | null
  onChange: (value: T) => void
  disabled?: boolean
  /** Abaixo do celular as opções dividem a largura; use `wrap` quando houver rótulos longos. */
  wrap?: boolean
  className?: string
}

/**
 * Controle segmentado: um grupo de opções EXCLUSIVAS (como um radio, mas em botões lado a lado).
 *
 * - `role="radiogroup"` com `role="radio"` + `aria-checked` em cada opção; só a escolhida entra no Tab (tabindex
 *   itinerante) e as setas ←/→/↑/↓ movem e escolhem, Home/End vão às pontas. Igual a um `<input type="radio">`.
 * - `value={null}` = nenhuma escolhida (a 1ª fica focável).
 * - Visual (igual ao `FilterChips`): trilho `sunken`, a escolhida sobe para `raised` com texto `heading` e um filete
 *   `structure` embaixo (o estado não depende só do tom); alvos de 44px no celular, 36px no computador.
 *
 * Uso: `<Segmented label="Tipo" options={[{value:'a',label:'avulsa'},…]} value={kind} onChange={setKind} />`.
 */
export function Segmented<T extends string>({ label, hideLabel, options, value, onChange, disabled, wrap, className = '' }: Props<T>) {
  const labelId = useId()
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const enabled = options.map((o, i) => (o.disabled || disabled ? -1 : i)).filter((i) => i >= 0)
  const tabbable = options.findIndex((o) => o.value === value && !o.disabled)
  const focusIndex = tabbable >= 0 ? tabbable : (enabled[0] ?? -1)

  function onKeyDown(e: KeyboardEvent, index: number) {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
    let target: number | undefined
    if (e.key in keys) {
      const pos = enabled.indexOf(index)
      target = enabled[(pos + keys[e.key] + enabled.length) % enabled.length]
    } else if (e.key === 'Home') target = enabled[0]
    else if (e.key === 'End') target = enabled[enabled.length - 1]
    if (target === undefined) return
    e.preventDefault()
    refs.current[target]?.focus()
    onChange(options[target].value)
  }

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <span id={labelId} className={hideLabel ? 'sr-only' : labelCls}>
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={labelId} className={`gap-0.5 rounded-md bg-sunken p-0.5 ${wrap ? 'flex flex-wrap' : 'grid'}`} style={wrap ? undefined : { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((o, i) => {
          const on = o.value === value
          return (
            <button
              key={o.value}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={o.ariaLabel}
              tabIndex={i === focusIndex ? 0 : -1}
              disabled={disabled || o.disabled}
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`flex min-h-11 flex-auto items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border-b-2 px-3 text-ui transition-colors focus-visible:z-10 disabled:cursor-not-allowed disabled:opacity-50 md:min-h-8 ${
                on
                  ? 'border-structure bg-raised font-semibold text-heading'
                  : 'border-transparent font-medium text-ink hover:bg-ink/6 active:bg-ink/10'
              }`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
