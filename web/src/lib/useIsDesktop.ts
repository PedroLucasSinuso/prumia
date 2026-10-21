import { useEffect, useState } from 'react'

const query = '(min-width: 768px)'

/** true em tela de computador (>= 768 px, o breakpoint `md` do Tailwind). Sem matchMedia (testes), assume celular. */
export function useIsDesktop(): boolean {
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false)
  const [desktop, setDesktop] = useState(get)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(query)
    const onChange = () => setDesktop(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return desktop
}
