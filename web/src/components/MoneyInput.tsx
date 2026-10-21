import { useId } from 'react'

import { digitsToCents, formatCents } from '../lib/money'

type Props = {
  label: string
  value: number // centavos
  onChange: (cents: number) => void
  error?: string
  id?: string
}

/**
 * Campo de dinheiro: a pessoa digita só números e o valor vai se formando da direita para a esquerda
 * ("1", "15", "150", ... => R$ 0,01, R$ 0,15, R$ 1,50). Teclado numérico no celular. Guarda centavos (inteiro).
 */
export function MoneyInput({ label, value, onChange, error, id }: Props) {
  const auto = useId()
  const fieldId = id ?? auto
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="text-xs font-medium uppercase tracking-wider text-graphite/70">
        {label}
      </label>
      <input
        id={fieldId}
        inputMode="numeric"
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-erro` : undefined}
        className={`h-11 rounded-md border bg-white/40 px-3 font-mono text-base tabular-nums text-graphite ${
          error ? 'border-signal' : 'border-graphite/25'
        }`}
        value={formatCents(value)}
        onChange={(e) => onChange(digitsToCents(e.target.value))}
      />
      {error && (
        <p id={`${fieldId}-erro`} className="text-xs text-signal">
          {error}
        </p>
      )}
    </div>
  )
}
