type Props = {
  /** 0 a 1: fração do mês já paga (por valor). */
  fraction: number
  /** Cores para fundo claro (padrão) ou sobre o teal. */
  tone?: 'light' | 'dark'
  className?: string
}

const SEGMENTS = 10

/** Medidor segmentado, direto do manual da marca: `[ ▪ ▪ ▪ ▫ ▫ ]`. Cada segmento vale 10% do valor do mês. */
export function PaidGauge({ fraction, tone = 'light', className = '' }: Props) {
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * SEGMENTS)
  const on = tone === 'dark' ? 'bg-on-structure border-on-structure' : 'bg-structure border-structure'
  const off = tone === 'dark' ? 'border-on-structure/55' : 'border-ink/35'
  return (
    <div role="img" aria-label={`${Math.round(fraction * 100)}% do valor do mês já foi pago`} className={`flex gap-1 ${className}`}>
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <span key={i} className={`h-2.5 flex-1 rounded-xs border ${i < filled ? on : off}`} />
      ))}
    </div>
  )
}
