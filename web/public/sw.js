// Service worker do prumia: o mínimo para o app ser instalável (PWA). NÃO é modo offline.
//
// - Navegação (abrir/recarregar uma página): vai sempre à rede. Sem rede, mostra uma página simples
//   "sem conexão". O index.html NÃO é guardado: o app depende da API e não deve abrir com dados velhos.
// - /api/ e qualquer outro pedido (JS, CSS, imagens): o service worker não toca; o navegador faz como sempre.
// - Atualização: o nginx serve este arquivo com "no-cache" e o registro usa updateViaCache "none", então o
//   navegador percebe versão nova a cada abertura. Como aqui não há cache do app, a versão nova assume na hora
//   (skipWaiting) sem recarregar a tela; o código novo do app vale no próximo carregamento.
//
// Ao mudar este arquivo, suba CACHE_VERSION: o activate apaga os caches de versões antigas.

const CACHE_VERSION = 'prumia-v1'
const OFFLINE_URL = '/__offline'

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

/** Decide se o service worker responde a este pedido: só navegação GET fora de /api/. */
function isAppNavigation(request) {
  if (request.method !== 'GET' || request.mode !== 'navigate') return false
  const url = new URL(request.url)
  return url.origin === self.location.origin && !url.pathname.startsWith('/api/')
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) =>
        cache.put(OFFLINE_URL, new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })),
      )
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  if (!isAppNavigation(event.request)) return // sem respondWith: o navegador segue normal (inclui /api/)
  event.respondWith(
    fetch(event.request).catch(() =>
      caches
        .open(CACHE_VERSION)
        .then((cache) => cache.match(OFFLINE_URL))
        .then((cached) => cached ?? new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })),
    ),
  )
})
