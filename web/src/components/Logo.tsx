type Props = {
  size?: number
  /** `color` sobre fundo claro; `inverse` sobre teal/grafite. */
  tone?: 'color' | 'inverse'
  className?: string
}

/**
 * Símbolo da prumia. A aresta vertical central é o "prumo" (a linha de prumo que dá nome à marca) e é o mesmo
 * eixo que vira a linha do tempo do mês. Aproximação vetorial do símbolo oficial; trocar aqui quando houver o SVG final.
 * Só usa cores da paleta (as variações de tom vêm de opacidade).
 */
export function Logo({ size = 32, tone = 'color', className }: Props) {
  const inverse = tone === 'inverse'
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="prumia" className={className}>
      <path d="M8 14 L34 4 L34 34 L8 46 Z" className={inverse ? 'fill-on-structure' : 'fill-structure'} />
      <path d="M8 46 L34 34 L34 60 L8 52 Z" className={inverse ? 'fill-on-structure/60' : 'fill-ink'} />
      <path d="M34 4 L58 32 L34 34 Z" className="fill-accent" />
      <path d="M34 34 L58 32 L34 60 Z" className={inverse ? 'fill-on-structure/70' : 'fill-structure'} />
    </svg>
  )
}
