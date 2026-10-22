// Registro do service worker (PWA). O sw.js fica em public/ e só existe para o app ser instalável; ver a seção
// PWA em docs/developer-guide/frontend.md.

type Env = {
  /** Build de produção (`import.meta.env.PROD`). Em dev o service worker atrapalharia o recarregamento do Vite. */
  prod: boolean
  win: Window
}

/**
 * Registra /sw.js quando faz sentido: só em produção, só em contexto seguro (HTTPS ou localhost: o navegador recusa
 * service worker em HTTP puro) e só se o navegador suporta. Devolve se vai registrar.
 *
 * `updateViaCache: 'none'` faz o navegador buscar o sw.js sempre na rede; a versão nova vale no próximo carregamento
 * (nada recarrega a tela sozinho).
 */
export function registerServiceWorker({ prod, win }: Env = { prod: import.meta.env.PROD, win: window }): boolean {
  if (!prod || !win.isSecureContext || !('serviceWorker' in win.navigator)) return false

  const register = () => {
    win.navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
      // Sem service worker o app funciona igual; só não fica instalável. Não há o que mostrar ao usuário.
    })
  }
  // Depois do load, para não disputar banda com o primeiro carregamento do app.
  if (win.document.readyState === 'complete') register()
  else win.addEventListener('load', register, { once: true })
  return true
}
