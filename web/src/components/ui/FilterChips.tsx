import type { ReactNode } from 'react'

export type FilterChip<T extends string> = {
  value: T
  label: ReactNode
  /** Número ao lado do rótulo (em mono): "A pagar 2". */
  count?: number
}

type Props<T extends string> = {
  /** Nome do grupo para leitores de tela ("Filtrar contas"). */
  label: string
  options: FilterChip<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
}

/**
 * Filtro segmentado: as opções lado a lado sobre um trilho `sunken`; a ativa sobe para `raised` (tom, não cor de marca).
 * Diferente do `Segmented` (escolha de formulário, radiogroup): aqui cada opção é um botão de alternância com
 * `aria-pressed`, num `role="group"`, porque ele filtra o que se vê em vez de preencher um valor.
 * Celular: alvos de 44 px; computador: 36 px.
 * Uso: `<FilterChips label="Filtrar contas" options={[{ value: 'all', label: 'Todas', count: 3 }, …]} value={f} onChange={setF} />`.
 */
export function FilterChips<T extends string>({ label, options, value, onChange, className = '' }: Props<T>) {
  return (
    <div role="group" aria-label={label} className={`inline-flex gap-0.5 rounded-md bg-sunken p-0.5 ${className}`}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`flex h-11 items-center gap-1.5 whitespace-nowrap rounded-sm px-3 text-ui transition-colors md:h-8 ${
              on ? 'bg-raised font-semibold text-heading' : 'font-medium text-ink hover:bg-ink/6'
            }`}
          >
            {o.label}
            {/* o espaço entra no nome acessível ("A pagar 2"); no flex ele não ocupa lugar */}
            {o.count !== undefined && <>{' '}<span className={`font-mono ${on ? 'text-ink' : 'text-muted'}`}>{o.count}</span></>}
          </button>
        )
      })}
    </div>
  )
}
