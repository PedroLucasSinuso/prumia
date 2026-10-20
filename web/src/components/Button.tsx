import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'ghost'

const styles: Record<Variant, string> = {
  primary: 'bg-teal text-ivory hover:bg-teal/90 disabled:bg-teal/50',
  ghost: 'border border-graphite/25 text-graphite hover:bg-graphite/5',
}

/** Botão da marca: raio de 6px (nunca pílula), altura mínima de 44px para toque no celular. */
export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`h-11 rounded-md px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...props}
    />
  )
}
