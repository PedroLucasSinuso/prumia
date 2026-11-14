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

/** Sentido do movimento na troca de mês: o próximo entra pela direita, o anterior pela esquerda. */
export type Direction = 'next' | 'prev'

/**
 * Faz `update` (trocar de mês, trocar de tela) dentro de uma transição de visão (View Transitions API): o navegador
 * fotografa a tela antes e depois e anima de uma para a outra. As animações em si estão no fim de `index.css`
 * (`::view-transition-*`); `direction` vira `data-vt` no <html> (sem direção, `fade`) e escolhe o lado do deslize.
 *
 * O React Router aplica a navegação como atualização de baixa prioridade, então não dá para forçá-la a acontecer dentro do
 * callback: esperamos a primeira mudança no DOM (ou 250 ms, o que vier antes) para o navegador tirar a "foto depois".
 * Sem suporte (Firefox antigo, testes) ou com "reduzir movimento" ligado, `update` roda na hora, sem animação.
 */
export function transition(update: () => void, direction?: Direction): void {
  if (!canAnimate() || typeof document.startViewTransition !== 'function') {
    update()
    return
  }
  const root = document.documentElement
  root.dataset.vt = direction ?? 'fade'
  const vt = document.startViewTransition(
    () =>
      new Promise<void>((resolve) => {
        const done = () => {
          observer.disconnect()
          clearTimeout(timer)
          requestAnimationFrame(() => resolve())
        }
        const observer = new MutationObserver(done)
        observer.observe(document.body, { childList: true, subtree: true, characterData: true })
        const timer = setTimeout(done, 250)
        update()
      }),
  )
  void vt.finished.finally(() => delete root.dataset.vt)
}
