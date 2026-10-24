import { Loader2 } from 'lucide-react'

/**
 * Indicador de carregamento. Gira só se a pessoa não pediu menos movimento (`motion-safe:`); sem animação continua
 * visível como um ícone parado. Decorativo: quem usa deve dizer o estado em texto ("Salvando…") ou `aria-busy`.
 * Uso: `<Spinner />` (16 px) ou `<Spinner size={20} />`; herda a cor do texto (`currentColor`).
 */
export function Spinner({ size = 16, className = '' }: { size?: number; className?: string }) {
  return <Loader2 aria-hidden="true" size={size} strokeWidth={2} className={`shrink-0 motion-safe:animate-spin ${className}`} />
}
