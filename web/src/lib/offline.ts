// Estado "mostrando dados guardados". O service worker (public/sw.js) responde GET /api/* com a cópia guardada quando o
// servidor não responde e marca a resposta com `x-prumia-cached-at`; aqui isso vira um estado que a tela lê
// (OfflineBanner). Uma resposta fresca da API desliga o aviso.
import { useSyncExternalStore } from 'react'

const HEADER = 'x-prumia-cached-at'

let since: number | null = null // instante (ms) da cópia mais antiga em uso; null = tudo fresco
const listeners = new Set<() => void>()

function set(next: number | null) {
  if (next === since) return
  since = next
  listeners.forEach((fn) => fn())
}

/** Olha uma resposta de GET /api/*: com o cabeçalho é cópia guardada; sem ele, o servidor respondeu agora. */
export function noteResponse(res: Response, method = 'GET') {
  if (method !== 'GET') return
  const cachedAt = Number(res.headers.get(HEADER))
  if (Number.isFinite(cachedAt) && cachedAt > 0) set(since === null ? cachedAt : Math.min(since, cachedAt))
  else if (res.status < 500) set(null)
}

export function resetOffline() {
  set(null)
}

export function useStaleSince(): number | null {
  return useSyncExternalStore(
    (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    () => since,
  )
}
