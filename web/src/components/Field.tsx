import { useId, type InputHTMLAttributes } from 'react'

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  error?: string
  hint?: string
}

/** Campo de formulário da marca: rótulo em caixa alta pequena, borda fina, erro em coral. Acessível (label, aria). */
export function Field({ label, error, hint, id, ...input }: FieldProps) {
  const auto = useId()
  const fieldId = id ?? auto
  const describedBy = [error ? `${fieldId}-erro` : null, hint ? `${fieldId}-dica` : null].filter(Boolean).join(' ')
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="text-xs font-medium uppercase tracking-wider text-graphite/70">
        {label}
      </label>
      <input
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`h-11 rounded-md border bg-white/40 px-3 text-base text-graphite placeholder:text-graphite/40 ${
          error ? 'border-signal' : 'border-graphite/25'
        }`}
        {...input}
      />
      {hint && !error && (
        <p id={`${fieldId}-dica`} className="text-xs text-graphite/60">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${fieldId}-erro`} className="text-xs text-signal">
          {error}
        </p>
      )}
    </div>
  )
}
