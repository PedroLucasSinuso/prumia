// Service worker do prumia: instalável (PWA) e com LEITURA OFFLINE. Escrever (lançar, pagar...) continua exigindo servidor.
//
// Por que existe: o prumia roda no PC da casa; com o PC desligado (ou sem sinal) o app ainda abre e mostra o que já
// foi visto, com um aviso na tela (src/lib/offline.ts + OfflineBanner) dizendo de quando são os dados.
//
// - Navegação (abrir/recarregar): rede primeiro; a cada sucesso guarda o index.html (o app é uma SPA: uma "moldura"
//   serve todas as rotas). Sem rede, serve a moldura guardada; se nunca houve visita, a página "sem conexão".
// - /assets/* (arquivos com hash no nome, imutáveis), ícones e fontes: cache primeiro.
// - GET /api/*: rede primeiro; só respostas 200 são guardadas. Se a rede falhar, o servidor responder 5xx (o túnel da
//   Cloudflare devolve 502/530 com o PC desligado) ou demorar demais, responde com a cópia guardada e o cabeçalho
//   `x-prumia-cached-at` (instante em ms da cópia). 4xx (inclui 401) nunca é trocado por cópia.
//   Fora do cache: /api/auth/* (exceto /api/auth/me) e /api/documents/* (boleto nunca vai a disco).
// - Escritas (POST/PATCH/DELETE) não passam por aqui: falham normalmente.
// - Avisos de vencimento por Web Push: eventos `push` e `notificationclick`, no fim do arquivo.
// - Os dados guardados são limpos ao sair da conta (lib/pwa.ts: clearOfflineData).
//
// Ao mudar este arquivo, suba a versão dos caches: o activate apaga os de versões antigas.

const SHELL_CACHE = 'prumia-shell-v2'
const DATA_CACHE = 'prumia-data-v2'
const SHELL_URL = '/__shell'
const OFFLINE_URL = '/__offline'
const CACHED_AT = 'x-prumia-cached-at'
const NETWORK_TIMEOUT_MS = 6000

const OFFLINE_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#203D40">
<title>prumia · sem conexão</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #F3EBDD; color: #313638; font-family: "IBM Plex Sans", system-ui, sans-serif; }
  main { max-width: 22rem; padding: 16px; }
  h1 { color: #203D40; font-size: 1.5rem; margin: 0 0 8px; }
  p { line-height: 1.5; margin: 0 0 16px; }
  a { display: inline-block; background: #203D40; color: #F3EBDD; text-decoration: none;
      padding: 8px 16px; border-radius: 4px; }
</style>
</head>
<body>
<main>
  <h1>Sem conexão</h1>
  <p>O prumia precisa de internet para mostrar suas contas. Confira a conexão e tente de novo.</p>
  <a href="/">Tentar de novo</a>
</main>
</body>
</html>`

const isStatic = (url) =>
  url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname === '/favicon.svg'

const isCacheableApi = (url) =>
  url.pathname.startsWith('/api/') &&
  !url.pathname.startsWith('/api/documents/') &&
  (!url.pathname.startsWith('/api/auth/') || url.pathname === '/api/auth/me')

/** fetch com prazo: o túnel/servidor fora do ar pode demorar a falhar; passado o prazo conta como falha. */
function fetchWithTimeout(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS)
    fetch(request).then(
      (res) => (clearTimeout(timer), resolve(res)),
      (err) => (clearTimeout(timer), reject(err)),
    )
  })
}

const offlinePage = () =>
  new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } })

/** Guarda a resposta com o instante da cópia (é o "dados de ..." mostrado na tela). */
async function store(cacheName, key, res) {
  const headers = new Headers(res.headers)
  headers.set(CACHED_AT, String(Date.now()))
  const copy = new Response(await res.clone().arrayBuffer(), { status: res.status, headers })
  const cache = await caches.open(cacheName)
  await cache.put(key, copy)
}

const lookup = (cacheName, key) => caches.open(cacheName).then((cache) => cache.match(key))

async function navigation(request) {
  try {
    const res = await fetchWithTimeout(request)
    if (res.ok) {
      await store(SHELL_CACHE, SHELL_URL, res)
      return res
    }
    if (res.status < 500) return res
  } catch {
    // cai para a moldura guardada
  }
  return (await lookup(SHELL_CACHE, SHELL_URL)) ?? (await lookup(SHELL_CACHE, OFFLINE_URL)) ?? offlinePage()
}

async function staticFile(request) {
  const cached = await lookup(SHELL_CACHE, request.url)
  if (cached) return cached
  const res = await fetch(request)
  if (res.ok) await store(SHELL_CACHE, request.url, res)
  return res
}

async function apiRead(request) {
  let failed
  try {
    const res = await fetchWithTimeout(request)
    if (res.status === 200) {
      await store(DATA_CACHE, request.url, res)
      return res
    }
    if (res.status < 500) return res
    failed = res
  } catch {
    // sem rede: tenta a cópia
  }
  const cached = await lookup(DATA_CACHE, request.url)
  if (cached) return cached
  if (failed) return failed
  throw new TypeError('Failed to fetch')
}

/** Decide se o service worker responde a este pedido (só GET do próprio site). */
function route(request) {
  if (request.method !== 'GET') return null
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return null
  if (request.mode === 'navigate') return url.pathname.startsWith('/api/') ? null : navigation
  if (isCacheableApi(url)) return apiRead
  if (isStatic(url)) return staticFile
  return null
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.put(OFFLINE_URL, offlinePage()))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE && key !== DATA_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const handler = route(event.request)
  if (handler) event.respondWith(handler(event.request))
})

// --- Avisos de vencimento (Web Push) ---------------------------------------------------------------------------
// O servidor manda {title, body, url, tag} cifrado (api/internal/push). Aqui só mostramos: nada é guardado.
// `tag`: o aviso de hoje substitui o de ontem da mesma casa, em vez de empilhar.
self.addEventListener('push', (event) => {
  let msg = {}
  try {
    msg = event.data ? event.data.json() : {}
  } catch {
    // corpo que não é JSON: mostra o aviso genérico abaixo
  }
  event.waitUntil(
    self.registration.showNotification(msg.title || 'prumia', {
      body: msg.body || 'Há contas para conferir.',
      tag: msg.tag || 'prumia',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: msg.url || '/' },
    }),
  )
})

// Tocar no aviso: traz o app já aberto para a frente, ou abre no endereço do aviso (sempre dentro do próprio site).
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin)
  const href = target.origin === self.location.origin ? target.href : self.location.origin + '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((client) => 'focus' in client)
      return open ? open.focus() : self.clients.openWindow(href)
    }),
  )
})
