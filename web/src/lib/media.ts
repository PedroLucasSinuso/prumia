import { useEffect, useState } from 'react'

/**
 * Acompanha uma media query do CSS (ex.: '(min-width: 1280px)'). Sem `matchMedia` (testes em jsdom), devolve `fallback`.
 * É o mesmo mecanismo do `useIsDesktop`, para qualquer consulta.
 */
export function useMediaQuery(query: string, fallback = false): boolean {
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : fallback)
  const [matches, setMatches] = useState(get)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/** true quando o ponteiro principal é o dedo (celular, tablet): só aí os textos dizem "toque". */
export const useIsTouch = () => useMediaQuery('(pointer: coarse)')

/** true a partir de 1280 px: o detalhe da conta fica num painel fixo ao lado da lista (abaixo disso, painel lateral por cima). */
export const useHasSidePanel = () => useMediaQuery('(min-width: 1280px)')
