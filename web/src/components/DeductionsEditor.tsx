import type { Deduction, DeductionKind } from '../api/types'
import { deductionKinds, deductionLabel, sumDeductions } from '../lib/income'
import { formatCents } from '../lib/money'
import { Field } from './Field'
import { MoneyInput } from './MoneyInput'

type Props = {
  value: Deduction[]
  onChange: (next: Deduction[]) => void
  /** Erros por campo vindos da API: chaves como `deductions[1].amountCents`. */
  errors?: Record<string, string>
  disabled?: boolean
}

/**
 * Descontos itemizados do salário (INSS, IRRF, plano, coparticipação...). O app NÃO calcula imposto: só soma o que a pessoa
 * informou. Cada desconto tem tipo e valor; "Outro desconto" pede um nome.
 */
export function DeductionsEditor({ value, onChange, errors = {}, disabled }: Props) {
  const set = (i: number, patch: Partial<Deduction>) => onChange(value.map((d, k) => (k === i ? { ...d, ...patch } : d)))
  const setKind = (i: number, kind: DeductionKind) => set(i, { kind, name: kind === 'other' ? '' : deductionLabel[kind] })
  const add = () => onChange([...value, { kind: 'inss', name: deductionLabel.inss, amountCents: 0 }])

  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-1 text-xs font-medium uppercase tracking-wider text-ink/80">Descontos</legend>
      {value.length === 0 && <p className="text-xs text-ink/75">Sem descontos. Adicione INSS, IRRF, plano de saúde, coparticipação...</p>}
      {value.map((d, i) => (
        <div key={i} className="flex flex-col gap-1.5 rounded-md border border-line p-2">
          <div className="flex items-start gap-2">
            <select
              aria-label={`Tipo do desconto ${i + 1}`}
              value={d.kind}
              onChange={(e) => setKind(i, e.target.value as DeductionKind)}
              className="h-11 min-w-0 flex-1 rounded-md border border-ink/25 bg-white/40 px-2 text-sm"
            >
              {deductionKinds.map((k) => (
                <option key={k} value={k}>
                  {deductionLabel[k]}
                </option>
              ))}
            </select>
            <div className="w-36 shrink-0">
              <MoneyInput hideLabel label={`Valor do desconto ${i + 1}`} value={d.amountCents} onChange={(c) => set(i, { amountCents: c })} error={errors[`deductions[${i}].amountCents`]} />
            </div>
            <button
              type="button"
              aria-label={`Remover desconto ${i + 1}`}
              onClick={() => onChange(value.filter((_, k) => k !== i))}
              className="flex size-11 shrink-0 items-center justify-center rounded-md text-lg hover:bg-ink/5"
            >
              ×
            </button>
          </div>
          {d.kind === 'other' && (
            <Field aria-label={`Nome do desconto ${i + 1}`} label="Nome do desconto" value={d.name} onChange={(e) => set(i, { name: e.target.value })} error={errors[`deductions[${i}].name`]} />
          )}
        </div>
      ))}
      {errors.deductions && <p className="text-xs text-alert">{errors.deductions}</p>}
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={add} className="h-11 text-sm font-semibold text-accent underline underline-offset-4">
          + Adicionar desconto
        </button>
        {value.length > 0 && <span className="font-mono text-sm tabular-nums">− {formatCents(sumDeductions(value))}</span>}
      </div>
    </fieldset>
  )
}
