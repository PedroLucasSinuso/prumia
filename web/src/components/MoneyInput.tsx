import { forwardRef, useId } from 'react'

import { digitsToCents, formatCents } from '../lib/money'

type Props = {
  label: string
  value: number // centavos
  onChange: (cents: number) => void
  error?: string
  id?: string
  /** Rótulo só para leitores de tela (campos em linha, como o valor de um desconto). */
  hideLabel?: boolean
  /** `hero`: o valor em destaque (números grandes num bloco com borda teal), usado ao cadastrar uma conta. */
  hero?: boolean
  /** Recebe o foco ao aparecer (o valor é o 1º campo ao lançar uma conta). */
  autoFocus?: boolean
}

/**
 * Campo de dinheiro: a pessoa digita só números e o valor vai se formando da direita para a esquerda
 * ("1", "15", "150", ... => R$ 0,01, R$ 0,15, R$ 1,50). Teclado numérico no celular. Guarda centavos (inteiro).
 * `forwardRef` deixa quem usa focar o campo (ex.: "Adicionar e lançar outra" volta ao valor).
 */
export const MoneyInput = forwardRef<HTMLInputElement, Props>(function MoneyInput({ label, value, onChange, error, id, hero, hideLabel, autoFocus }, ref) {
  const auto = useId()
  const fieldId = id ?? auto
  const label_ = (
    <label htmlFor={fieldId} className={hideLabel ? 'sr-only' : 'text-xs font-medium uppercase tracking-wider text-ink/80'}>
      {label}
    </label>
  )
  const input = (
    <input
      ref={ref}
      id={fieldId}
      inputMode="numeric"
      autoComplete="off"
      autoFocus={autoFocus}
      data-autofocus={autoFocus ? '' : undefined}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${fieldId}-erro` : undefined}
      className={
        hero
          ? 'w-full border-0 bg-transparent p-0 font-mono text-[40px] font-semibold leading-tight tabular-nums text-heading outline-none'
          : `h-11 rounded-md border bg-raised/40 px-3 font-mono text-base tabular-nums text-ink ${error ? 'border-alert' : 'border-ink/25'}`
      }
      value={formatCents(value)}
      onChange={(e) => onChange(digitsToCents(e.target.value))}
    />
  )
  const err = error && (
    <p id={`${fieldId}-erro`} className="text-xs text-alert">
      {error}
    </p>
  )
  if (hero) {
    return (
      <div className={`flex flex-col gap-0.5 rounded-md border-2 bg-raised/35 px-3 py-2.5 transition-colors focus-within:border-accent ${error ? 'border-alert' : 'border-structure'}`}>
        {label_}
        {input}
        <p className="text-xs text-ink/75">digite só os números: 18735 vira R$ 187,35</p>
        {err}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1">
      {label_}
      {input}
      {err}
    </div>
  )
})
