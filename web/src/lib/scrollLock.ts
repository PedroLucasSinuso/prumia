import { useEffect } from 'react'

// Contador: painéis podem se empilhar (ex.: calendário não, mas Sheet sobre SlideOver); só o último a fechar destrava.
let locks = 0
let saved: { overflow: string; paddingRight: string } | null = null

/**
 * Trava a rolagem da página (`<body>`) enquanto `active`. Restaura o valor anterior ao destravar e também quando o
 * componente é desmontado (cleanup do efeito), então um pai que desmonta o painel sozinho não deixa a página presa.
 * Compensa a largura da barra de rolagem para o layout não "pular" no computador.
 */
export function useBodyScrollLock(active = true) {
  useEffect(() => {
    if (!active) return
    const body = document.body
    if (locks === 0) {
      saved = { overflow: body.style.overflow, paddingRight: body.style.paddingRight }
      const bar = window.innerWidth - document.documentElement.clientWidth
      if (bar > 0) body.style.paddingRight = `${bar}px`
      body.style.overflow = 'hidden'
    }
    locks++
    return () => {
      locks--
      if (locks === 0 && saved) {
        body.style.overflow = saved.overflow
        body.style.paddingRight = saved.paddingRight
        saved = null
      }
    }
  }, [active])
}
