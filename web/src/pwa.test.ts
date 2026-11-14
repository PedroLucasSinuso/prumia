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

  // Selo do aviso: o Android só usa a transparência; PNG sem canal alfa vira quadrado branco na barra de status.
  it('o selo da notificação é 96x96, tem transparência e é o que o sw.js usa', () => {
    const badge = icons['../public/icons/badge-96.png']
    expect(pngSize(badge)).toEqual({ width: 96, height: 96 })
    const bytes = Uint8Array.from(atob(badge.split(',')[1]), (c) => c.charCodeAt(0))
    expect([4, 6]).toContain(bytes[25]) // tipo de cor do IHDR: 4 e 6 são os que têm canal alfa
    expect(swSource).toContain("badge: '/icons/badge-96.png'")
  })

  it('apple-touch-icon é 180x180', () => {
    expect(pngSize(icons['../public/icons/apple-touch-icon.png'])).toEqual({ width: 180, height: 180 })
  })
})

// --- service worker: roda o sw.js com um `self`, `caches` e `fetch` falsos -------------------------------------

type Reply = Response | 'offline' | 'hang'

function loadServiceWorker({ existingCaches = [] as string[] } = {}) {
  const listeners: Record<string, (event: unknown) => void> = {}
  const store = new Map<string, Map<string, Response>>(existingCaches.map((k) => [k, new Map()]))
  const caches = {
    open: async (name: string) => {
      if (!store.has(name)) store.set(name, new Map())
      const cache = store.get(name)!
      return {
        put: async (url: string, res: Response) => void cache.set(url, res),
        match: async (url: string) => cache.get(url)?.clone(),
      }
    },
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
  }
  const openWindows: { focus: () => Promise<void> }[] = []
  let reply: Reply = new Response('online')
  const fetch = vi.fn(async () => {
    if (reply === 'offline') throw new TypeError('Failed to fetch')
    if (reply === 'hang') return new Promise<Response>(() => {})
    return reply.clone()
  })
  const self = {
    location: { origin: 'https://prumia.test' },
    addEventListener: (type: string, fn: (event: unknown) => void) => (listeners[type] = fn),
    skipWaiting: vi.fn(async () => {}),
    clients: {
      claim: vi.fn(async () => {}),
      matchAll: vi.fn(async () => openWindows),
      openWindow: vi.fn(async (_url: string) => {}),
    },
    registration: { showNotification: vi.fn(async (_title: string, _options: object) => {}) },
  }
  new Function('self', 'caches', 'fetch', swSource)(self, caches, fetch)

  // Dispara um evento e devolve a promessa passada a waitUntil/respondWith (ou undefined se o SW ignorou).
  const dispatch = (type: string, extra: object = {}) => {
    let promise: Promise<unknown> | undefined
    const settle = (p: Promise<unknown>) => (promise = p)
    listeners[type]({ ...extra, waitUntil: settle, respondWith: settle })
    return promise
  }
  const request = (path: string, mode = 'cors', method = 'GET') => ({ url: `https://prumia.test${path}`, mode, method })
  const get = async (path: string, mode = 'cors') => (await dispatch('fetch', { request: request(path, mode) })) as Response
  return { dispatch, request, get, fetch, self, store, openWindows, setReply: (r: Reply) => (reply = r) }
}

describe('sw.js', () => {
  it('install guarda só a página offline e assume sem esperar', async () => {
    const sw = loadServiceWorker()
    await sw.dispatch('install')
    expect([...sw.store.keys()]).toEqual(['prumia-shell-v2'])
    expect([...sw.store.get('prumia-shell-v2')!.keys()]).toEqual(['/__offline'])
    expect(sw.self.skipWaiting).toHaveBeenCalled()
  })

  it('activate apaga caches de versões antigas e mantém os atuais', async () => {
    const sw = loadServiceWorker({ existingCaches: ['prumia-v1', 'prumia-data-v1', 'outro'] })
    await sw.dispatch('install')
    await sw.get('/api/invoices')
    await sw.dispatch('activate')
    expect([...sw.store.keys()].sort()).toEqual(['prumia-data-v2', 'prumia-shell-v2'])
    expect(sw.self.clients.claim).toHaveBeenCalled()
  })

  it('não intercepta escritas, outros sites, documentos e rotas de autenticação (exceto /auth/me)', () => {
    const sw = loadServiceWorker()
    const ignored = [
      sw.request('/api/invoices', 'cors', 'POST'),
      sw.request('/api/invoices/1', 'cors', 'DELETE'),
      sw.request('/api/documents/extract'),
      sw.request('/api/auth/invite'),
      sw.request('/api/auth/login', 'cors', 'POST'),
      { url: 'https://outro.site/api/x', mode: 'cors', method: 'GET' },
      sw.request('/outro.js', 'no-cors'),
      sw.request('/api/qualquer', 'navigate'),
    ]
    for (const req of ignored) expect(sw.dispatch('fetch', { request: req })).toBeUndefined()
  })

  it('navegação: rede primeiro e guarda a moldura; sem rede serve a moldura guardada', async () => {
    const sw = loadServiceWorker()
    sw.setReply(new Response('<html>app</html>'))
    expect(await (await sw.get('/mes', 'navigate')).text()).toBe('<html>app</html>')
    sw.setReply('offline')
    expect(await (await sw.get('/resumo', 'navigate')).text()).toBe('<html>app</html>')
  })

  it('navegação com o túnel respondendo 530 (PC desligado) serve a moldura guardada', async () => {
    const sw = loadServiceWorker()
    sw.setReply(new Response('<html>app</html>'))
    await sw.get('/', 'navigate')
    sw.setReply(new Response('erro do túnel', { status: 530 }))
    expect(await (await sw.get('/', 'navigate')).text()).toBe('<html>app</html>')
  })

  it('sem rede e sem visita anterior mostra a página "sem conexão"', async () => {
    const sw = loadServiceWorker()
    await sw.dispatch('install')
    sw.setReply('offline')
    const text = await (await sw.get('/mes', 'navigate')).text()
    expect(text).toContain('Sem conexão')
    expect(text).toContain('precisa de internet')
  })

  it('arquivos de /assets/ vão para o cache e dali saem sem rede', async () => {
    const sw = loadServiceWorker()
    sw.setReply(new Response('js'))
    await sw.get('/assets/index-abc.js', 'no-cors')
    sw.setReply('offline')
    expect(await (await sw.get('/assets/index-abc.js', 'no-cors')).text()).toBe('js')
  })

  describe('GET /api/', () => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

    it('online: devolve o dado novo, sem marca de cópia, e guarda uma cópia', async () => {
      const sw = loadServiceWorker()
      sw.setReply(json({ total: 1 }))
      const res = await sw.get('/api/households/h1/invoices?month=2026-11-01')
      expect(res.headers.get('x-prumia-cached-at')).toBeNull()
      expect(await res.json()).toEqual({ total: 1 })
      expect(sw.store.get('prumia-data-v2')!.size).toBe(1)
    })

    it.each([
      ['sem rede', 'offline' as Reply],
      ['servidor 502', json({}, 502)],
      ['túnel 530', json({}, 530)],
      ['demora demais', 'hang' as Reply],
    ])('%s: responde com a cópia e marca o instante', async (_n, failure) => {
      vi.useFakeTimers()
      try {
        const sw = loadServiceWorker()
        sw.setReply(json({ total: 1 }))
        await sw.get('/api/households/h1/invoices')
        sw.setReply(failure)
        const pending = sw.get('/api/households/h1/invoices')
        await vi.advanceTimersByTimeAsync(7000)
        const res = await pending
        expect(Number(res.headers.get('x-prumia-cached-at'))).toBeGreaterThan(0)
        expect(await res.json()).toEqual({ total: 1 })
      } finally {
        vi.useRealTimers()
      }
    })

    it('4xx (ex.: 401) passa como veio e nunca é trocado pela cópia', async () => {
      const sw = loadServiceWorker()
      sw.setReply(json({ total: 1 }))
      await sw.get('/api/auth/me')
      sw.setReply(json({ code: 'unauthorized' }, 401))
      const res = await sw.get('/api/auth/me')
      expect(res.status).toBe(401)
      expect(res.headers.get('x-prumia-cached-at')).toBeNull()
    })

    it('4xx e 5xx não são guardados', async () => {
      const sw = loadServiceWorker()
      sw.setReply(json({}, 404))
      await sw.get('/api/a')
      sw.setReply(json({}, 500))
      await sw.get('/api/b')
      expect(sw.store.get('prumia-data-v2')?.size ?? 0).toBe(0)
    })

    it('sem cópia e sem rede o erro segue para o app', async () => {
      const sw = loadServiceWorker()
      sw.setReply('offline')
      await expect(sw.get('/api/nunca-visto')).rejects.toThrow()
    })
  })

  describe('avisos (push)', () => {
    it('mostra o aviso recebido, com a tag e o endereço', async () => {
      const sw = loadServiceWorker()
      const msg = { title: 'prumia', body: '1 vence hoje (R$ 99,90)', url: '/', tag: 'prumia-vencimentos-x' }
      await sw.dispatch('push', { data: { json: () => msg } })
      expect(sw.self.registration.showNotification).toHaveBeenCalledWith(
        'prumia',
        expect.objectContaining({ body: '1 vence hoje (R$ 99,90)', tag: 'prumia-vencimentos-x', data: { url: '/' } }),
      )
    })

    it('corpo ausente ou inválido vira um aviso genérico (nunca um aviso em branco)', async () => {
      const sw = loadServiceWorker()
      await sw.dispatch('push', { data: null })
      await sw.dispatch('push', {
        data: {
          json: () => {
            throw new Error('não é JSON')
          },
        },
      })
      expect(sw.self.registration.showNotification).toHaveBeenCalledTimes(2)
      expect(sw.self.registration.showNotification).toHaveBeenLastCalledWith('prumia', expect.objectContaining({ body: 'Há contas para conferir.' }))
    })

    it('tocar no aviso foca o app aberto; sem janela, abre o endereço do aviso', async () => {
      const sw = loadServiceWorker()
      const close = vi.fn()
      await sw.dispatch('notificationclick', { notification: { close, data: { url: '/resumo' } } })
      expect(close).toHaveBeenCalled()
      expect(sw.self.clients.openWindow).toHaveBeenCalledWith('https://prumia.test/resumo')

      const focus = vi.fn(async () => {})
      sw.openWindows.push({ focus })
      await sw.dispatch('notificationclick', { notification: { close, data: { url: '/' } } })
      expect(focus).toHaveBeenCalled()
      expect(sw.self.clients.openWindow).toHaveBeenCalledTimes(1)
    })

    it('endereço de outro site no aviso é trocado pela página inicial', async () => {
      const sw = loadServiceWorker()
      await sw.dispatch('notificationclick', { notification: { close: vi.fn(), data: { url: 'https://outro.site/x' } } })
      expect(sw.self.clients.openWindow).toHaveBeenCalledWith('https://prumia.test/')
    })
  })
})
