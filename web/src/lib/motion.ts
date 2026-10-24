/**
 * Movimento só quando a pessoa não pediu menos (prefers-reduced-motion). Os estilos usam `motion-safe:` do Tailwind;
 * este helper serve para o JavaScript que precisa ESPERAR uma animação (ex.: o painel que sai antes de desmontar).
 * Sem `matchMedia` (testes/jsdom) = sem animação: tudo acontece na hora.
 */
export function canAnimate(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: no-preference)').matches
}

/** Duração da saída dos painéis e avisos (ms); mantenha igual a `--animate-*-out` em index.css. */
export const EXIT_MS = 150
