// Testes dos arquivos estáticos do PWA (public/): manifesto, ícones e service worker.
import manifestRaw from '../public/manifest.webmanifest?raw'
import swSource from '../public/sw.js?raw'

// Os PNGs chegam como data URL (base64); a largura e a altura ficam no cabeçalho IHDR (bytes 16 a 23).
const icons = import.meta.glob('../public/icons/*.png', { query: '?inline', import: 'default', eager: true }) as Record<
  string,
  string
>

function pngSize(dataUrl: string) {
  const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), (c) => c.charCodeAt(0))
  const view = new DataView(bytes.buffer)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

describe('manifest.webmanifest', () => {
  const manifest = JSON.parse(manifestRaw)

  it('tem os campos de instalação com as cores da marca', () => {
    expect(manifest).toMatchObject({
      name: 'prumia',
      short_name: 'prumia',
      lang: 'pt-BR',
      display: 'standalone',
      start_url: '/',
      scope: '/',
      theme_color: '#203D40',
      background_color: '#F3EBDD',
    })
  })

  it('cada ícone existe em public/ e tem o tamanho declarado', () => {
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3)
    for (const icon of manifest.icons) {
      const file = icons[`../public${icon.src}`]
      expect(file, icon.src).toBeDefined()
      const [w, h] = icon.sizes.split('x').map(Number)
      expect(pngSize(file)).toEqual({ width: w, height: h })
    }
  })

  it('tem 192, 512 e um maskable', () => {
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true)
  })

  it('apple-touch-icon é 180x180', () => {
    expect(pngSize(icons['../public/icons/apple-touch-icon.png'])).toEqual({ width: 180, height: 180 })
  })
})

// --- service worker: roda o sw.js com um `self`, `caches` e `fetch` falsos -------------------------------------

class FakeResponse {
  body: string
  constructor(body: string) {
    this.body = body
  }
}

function loadServiceWorker({ online = true, existingCaches = [] as string[] } = {}) {
  const listeners: Record<string, (event: unknown) => void> = {}
  const store = new Map<string, Map<string, FakeResponse>>(existingCaches.map((k) => [k, new Map()]))
  const caches = {
    open: async (name: string) => {
      if (!store.has(name)) store.set(name, new Map())
      const cache = store.get(name)!
      return {
        put: async (url: string, res: FakeResponse) => void cache.set(url, res),
        match: async (url: string) => cache.get(url),
      }
    },
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
  }
  const fetch = vi.fn(async () => {
    if (!online) throw new TypeError('Failed to fetch')
    return new FakeResponse('online')
  })
  const self = {
    location: { origin: 'https://prumia.test' },
    addEventListener: (type: string, fn: (event: unknown) => void) => (listeners[type] = fn),
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
  }
  new Function('self', 'caches', 'fetch', 'Response', swSource)(self, caches, fetch, FakeResponse)

  // Dispara um evento e devolve a promessa passada a waitUntil/respondWith (ou undefined se o SW ignorou).
  const dispatch = (type: string, extra: object = {}) => {
    let promise: Promise<unknown> | undefined
    const settle = (p: Promise<unknown>) => (promise = p)
    listeners[type]({ ...extra, waitUntil: settle, respondWith: settle })
    return promise
  }
  const request = (path: string, mode = 'navigate', method = 'GET') => ({
    url: `https://prumia.test${path}`,
    mode,
    method,
  })
  return { dispatch, request, fetch, self, store }
}

describe('sw.js', () => {
  it('install guarda só a página offline e assume sem esperar', async () => {
    const sw = loadServiceWorker()
    await sw.dispatch('install')
    const [name] = [...sw.store.keys()]
    expect(name).toMatch(/^prumia-v\d+$/)
    expect([...sw.store.get(name)!.keys()]).toEqual(['/__offline'])
    expect(sw.self.skipWaiting).toHaveBeenCalled()
  })

  it('activate apaga caches de versões antigas', async () => {
    const sw = loadServiceWorker({ existingCaches: ['prumia-v0', 'outro'] })
    await sw.dispatch('install')
    await sw.dispatch('activate')
    expect([...sw.store.keys()]).toEqual([expect.stringMatching(/^prumia-v\d+$/)])
    expect(sw.self.clients.claim).toHaveBeenCalled()
  })

  it('nunca intercepta /api/ nem pedidos que não são navegação', () => {
    const sw = loadServiceWorker()
    expect(sw.dispatch('fetch', { request: sw.request('/api/auth/me') })).toBeUndefined()
    expect(sw.dispatch('fetch', { request: sw.request('/api/invoices', 'cors') })).toBeUndefined()
    expect(sw.dispatch('fetch', { request: sw.request('/assets/index.js', 'no-cors') })).toBeUndefined()
    expect(sw.dispatch('fetch', { request: sw.request('/', 'navigate', 'POST') })).toBeUndefined()
  })

  it('navegação vai à rede (network-first)', async () => {
    const sw = loadServiceWorker()
    const res = (await sw.dispatch('fetch', { request: sw.request('/mes') })) as FakeResponse
    expect(res.body).toBe('online')
  })

  it('sem rede mostra a página "sem conexão"', async () => {
    const sw = loadServiceWorker({ online: false })
    await sw.dispatch('install')
    const res = (await sw.dispatch('fetch', { request: sw.request('/mes') })) as FakeResponse
    expect(res.body).toContain('Sem conexão')
    expect(res.body).toContain('precisa de internet')
  })
})
