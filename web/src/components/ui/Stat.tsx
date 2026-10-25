import type { ReactNode } from 'react'

import { Eyebrow } from './Eyebrow'

export type StatEmphasis = 'primary' | 'default' | 'alert' | 'muted'

const values: Record<StatEmphasis, string> = {
  // O número da tela: cor de título.
  primary: 'text-heading',
  default: 'text-ink',
  // Algo errado (atraso, sobra negativa): o texto em `alert-text` (4,5:1), nunca o coral puro.
  alert: 'text-alert-text',
  // Já resolvido / sem importância agora ("tudo pago"): recua para o tom secundário.
  muted: 'text-muted',
}
const sizes = { lg: 'text-figure-lg', md: 'text-figure', sm: 'text-title' } as const

type Props = {
  /** Rótulo (eyebrow) acima do valor: "a pagar no mês". */
  label: ReactNode
  /** O valor já formatado ("R$ 1.700,00"). */
  value: ReactNode
  /** Linha de apoio sob o valor ("2 pendentes", "16% pago"). */
  note?: ReactNode
  emphasis?: StatEmphasis
  /** `lg` 44 px · `md` 34 px (padrão) · `sm` 22 px. */
  size?: keyof typeof sizes
  /** Algo à direita do rótulo, na mesma linha (ex.: "16% pago"). */
  aside?: ReactNode
  /** O valor é o nome da região para leitores de tela? Use `as="section"` + `aria-label` no contêiner, não aqui. */
  className?: string
}

/**
 * Um número com rótulo: eyebrow + valor em `font-mono` tabular (escala `figure`) + nota. Unifica os antigos `Highlight`
 * (mês), `Tile` (resumo) e os cartões de Receitas. Não desenha caixa: quem usa põe numa `Surface` se precisar.
 * `emphasis` diz o PESO (primary = o destaque, alert = algo errado, muted = já resolvido); o tamanho vem de `size`.
 * Uso: `<Stat label="pago" value={formatCents(paid)} note="16% do mês" size="sm" />`.
 */
export function Stat({ label, value, note, emphasis = 'default', size = 'md', aside, className = '' }: Props) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <Eyebrow as="span">{label}</Eyebrow>
        {aside && <span className="font-mono text-caption text-muted">{aside}</span>}
      </div>
      <p data-emphasis={emphasis} className={`mt-1 font-mono font-semibold tracking-tight tabular-nums ${sizes[size]} ${values[emphasis]}`}>
        {value}
      </p>
      {note && <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-ui text-muted">{note}</div>}
    </div>
  )
}
