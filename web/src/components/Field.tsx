import { forwardRef, useId, type InputHTMLAttributes } from 'react'

import { controlCls, labelCls } from './ui/styles'

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  error?: string
  hint?: string
}

/**
 * Campo de formulário da marca: rótulo em caixa alta pequena, borda `line-strong`, erro em `alert-text`. Acessível (label, aria).
 * Estados: hover (borda mais forte), foco (borda `accent` + contorno global), erro, desabilitado.
 * Celular: 44px; computador: 36px. O visual vem de `ui/styles` (igual ao DatePicker, Combobox e MonthPicker).
 */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field({ label, error, hint, id, className = '', ...input }, ref) {
  const auto = useId()
  const fieldId = id ?? auto
  const describedBy = [error ? `${fieldId}-erro` : null, hint ? `${fieldId}-dica` : null].filter(Boolean).join(' ')
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className={labelCls}>
        {label}
      </label>
      <input
        ref={ref}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`${controlCls(Boolean(error))} ${className}`}
        {...input}
      />
      {hint && !error && (
        <p id={`${fieldId}-dica`} className="text-meta text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${fieldId}-erro`} className="text-meta font-medium text-alert-text">
          {error}
        </p>
      )}
    </div>
  )
})
