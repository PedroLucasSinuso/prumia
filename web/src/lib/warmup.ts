// Preparo do modo offline: com conexão, o app baixa SOZINHO o que as telas vão precisar, para que dê para navegar por
// todas sem rede (e não só pelas que já foram abertas). São duas partes, ambas em segundo plano e sem mexer na tela:
//
// 1. warmShell: o código de todas as telas e as fontes. O build gera /precache.json (vite.config.ts); cada arquivo é
//    pedido uma vez e o service worker guarda (public/sw.js, staticFile). Arquivos de builds antigos são apagados.
// 2. warmData: as leituras da API de uma JANELA de meses (WINDOW_BACK para trás, WINDOW_AHEAD para a frente) e os
//    cadastros da casa. O service worker guarda cada resposta 200 (apiRead). Mês fora da janela continua dependendo de
//    ter sido visitado. Histórico inteiro não: cresce para sempre e quase nunca é consultado sem conexão.
//
// As chamadas daqui precisam gerar a MESMA URL das telas (a cópia é guardada por URL): ao mudar os parâmetros de uma
// consulta em api/queries.ts, mude aqui também. O teste e2e/tests/offline.spec.ts navega por tudo sem rede e acusa.
import { api } from '../api/client'
import { unwrap } from '../api/errors'
import { fetchInvoices } from '../api/queries'
import { addMonths, currentMonth } from './dates'

export const WINDOW_BACK = 3
export const WINDOW_AHEAD = 2
/** Não refaz o preparo dos dados se o último tem menos que isto. */
const FRESH_MS = 6 * 60 * 60 * 1000
const CONCURRENCY = 3
/** Mesmos nomes do sw.js (lá: SHELL_CACHE e SHELL_URL). */
const SHELL_CACHE = 'prumia-shell-v2'
const SHELL_URL = '/__shell'
const STAMP_PREFIX = 'prumia.offline.warm.'

/** Meses da janela, do mais antigo ao mais novo. */
export function warmMonths(month: string): string[] {
  const months: string[] = []
  for (let i = -WINDOW_BACK; i <= WINDOW_AHEAD; i++) months.push(addMonths(month, i))
  return months
}

type Nav = { onLine?: boolean; connection?: { saveData?: boolean } }

/** Vale preparar agora? Não sem rede, não com a economia de dados do aparelho ligada, não se o último preparo é recente. */
export function shouldWarmData(lastAt: number | null, now: number, nav: Nav): boolean {
  if (nav.onLine === false) return false
  if (nav.connection?.saveData) return false
  return lastAt === null || now - lastAt > FRESH_MS
}

/** Roda as tarefas com poucas ao mesmo tempo (o servidor é o PC da casa, atrás de um túnel). Devolve quantas falharam. */
async function runAll(tasks: Array<() => Promise<unknown>>): Promise<number> {
  let failed = 0
  let next = 0
  const worker = async () => {
    while (next < tasks.length) {
      const task = tasks[next++]
      try {
        await task()
      } catch {
        failed++
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  return failed
}

/** Espera o service worker assumir a página (na primeira visita ele ainda está instalando). false = não há ou demorou. */
async function controlled(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false
  if (navigator.serviceWorker.controller) return true
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 15_000)
    navigator.serviceWorker.addEventListener('controllerchange', () => (clearTimeout(timer), resolve(true)), { once: true })
  })
}

/** Parte 1: código de todas as telas e fontes. */
export async function warmShell(): Promise<void> {
  const res = await fetch('/precache.json', { cache: 'no-store' })
  if (!res.ok) return
  const { files } = (await res.json()) as { files: string[] }
  if (!Array.isArray(files)) return
  const cache = await caches.open(SHELL_CACHE)
  // A moldura (index.html): o service worker só a guarda numa navegação que passou por ele, e a primeira visita acontece
  // antes de ele assumir. Sem isto, recarregar sem rede logo depois de instalar cairia na página "sem conexão".
  const shell = await fetch('/', { cache: 'no-store' })
  if (shell.ok && (shell.headers.get('content-type') ?? '').includes('text/html')) await cache.put(SHELL_URL, shell)
  const wanted = new Set(files.map((f) => new URL(f, location.origin).href))
  const have = new Set((await cache.keys()).map((req) => req.url))
  // Passa pelo service worker, que guarda (o que já está guardado nem vai à rede).
  await runAll([...wanted].filter((url) => !have.has(url)).map((url) => () => fetch(url)))
  // Limpeza: /assets/ de builds antigos (nome com hash: nunca mais serão pedidos).
  const assets = new URL('/assets/', location.origin).href
  await Promise.all([...have].filter((url) => url.startsWith(assets) && !wanted.has(url)).map((url) => cache.delete(url)))
}

/** As leituras que as telas fazem, para a casa e a janela de meses. Uma função por pedido. */
export function dataRequests(houseId: string, month: string): Array<() => Promise<unknown>> {
  const path = { householdId: houseId }
  const house = { params: { path } }
  const archived = { params: { path, query: { includeArchived: true } } }
  const history = (from: string, to: string) => () =>
    unwrap(api.GET('/households/{householdId}/summary/categories', { params: { path, query: { from, to } } }))

  const tasks: Array<() => Promise<unknown>> = [
    // Quem está logado e as casas: é o que o app pede ao abrir. Na primeira visita esse pedido acontece antes de o
    // service worker assumir, então não ficou guardado; sem ele, reabrir sem rede cairia na tela de login.
    () => unwrap(api.GET('/auth/me')),
    () => unwrap(api.GET('/households/{householdId}/categories', archived)),
    () => unwrap(api.GET('/households/{householdId}/payees', archived)),
    () => unwrap(api.GET('/households/{householdId}/wallets', archived)),
    () => unwrap(api.GET('/households/{householdId}/members', house)),
    () => unwrap(api.GET('/households/{householdId}/income-sources', house)),
    () => unwrap(api.GET('/households/{householdId}/recurrences', house)),
    () => unwrap(api.GET('/households/{householdId}/purchases', { params: { path, query: { limit: 100 } } })),
    () => unwrap(api.GET('/rates')),
  ]
  for (const m of warmMonths(month)) {
    const byMonth = { params: { path, query: { month: m } } }
    tasks.push(
      () => fetchInvoices(houseId, m),
      () => unwrap(api.GET('/households/{householdId}/incomes', byMonth)),
      () => unwrap(api.GET('/households/{householdId}/summary', byMonth)),
      () => unwrap(api.GET('/households/{householdId}/transfers', byMonth)),
      () => unwrap(api.GET('/households/{householdId}/wallet-adjustments', byMonth)),
      () => unwrap(api.GET('/households/{householdId}/reserve', byMonth)),
      // Resumo: gráfico de 6 meses, bloco "o que mudou" (6 meses de base) e os 3 meses seguintes.
      history(addMonths(m, -5), m),
      history(addMonths(m, -6), m),
      history(addMonths(m, 1), addMonths(m, 3)),
    )
  }
  return tasks
}

function readStamp(houseId: string): number | null {
  try {
    const n = Number(localStorage.getItem(STAMP_PREFIX + houseId))
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

/** Parte 2: dados da casa na janela de meses. Só marca como feito se tudo respondeu (senão tenta de novo na próxima). */
export async function warmData(houseId: string, month = currentMonth()): Promise<void> {
  if (!shouldWarmData(readStamp(houseId), Date.now(), navigator as Nav)) return
  const failed = await runAll(dataRequests(houseId, month))
  if (failed > 0) return
  try {
    localStorage.setItem(STAMP_PREFIX + houseId, String(Date.now()))
  } catch {
    // sem localStorage (modo privado): só refaz na próxima abertura
  }
}

/** Ao sair da conta os dados guardados são apagados (lib/pwa.ts); o próximo login prepara tudo de novo. */
export function forgetWarmup(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key?.startsWith(STAMP_PREFIX)) localStorage.removeItem(key)
    }
  } catch {
    // nada a esquecer
  }
}

/**
 * Ponto de entrada (AppShell): depois que o app abriu, prepara o modo offline em segundo plano. Só no app de produção com
 * service worker (em dev e na demonstração não há o que guardar). Nunca lança: é só adiantamento.
 */
export async function prepareOffline(houseId: string, enabled = import.meta.env.PROD && import.meta.env.VITE_DEMO !== '1'): Promise<void> {
  if (!enabled || !houseId || typeof caches === 'undefined') return
  try {
    if (!(await controlled())) return
    await warmShell()
    await warmData(houseId)
  } catch {
    // sem rede ou sem espaço: o app segue funcionando como antes
  }
}
