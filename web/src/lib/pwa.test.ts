import { registerServiceWorker } from './pwa'

// Janela falsa: só o que registerServiceWorker usa.
function fakeWindow({ secure = true, supported = true, readyState = 'complete' } = {}) {
  const register = vi.fn().mockResolvedValue({})
  const addEventListener = vi.fn()
  const navigator = supported ? { serviceWorker: { register } } : {}
  const win = { isSecureContext: secure, navigator, document: { readyState }, addEventListener } as unknown as Window
  return { win, register, addEventListener }
}

describe('registerServiceWorker', () => {
  it('não registra em desenvolvimento', () => {
    const { win, register } = fakeWindow()
    expect(registerServiceWorker({ prod: false, win })).toBe(false)
    expect(register).not.toHaveBeenCalled()
  })

  it('não registra fora de contexto seguro (HTTP puro)', () => {
    const { win, register } = fakeWindow({ secure: false })
    expect(registerServiceWorker({ prod: true, win })).toBe(false)
    expect(register).not.toHaveBeenCalled()
  })

  it('não registra se o navegador não tem service worker', () => {
    const { win } = fakeWindow({ supported: false })
    expect(registerServiceWorker({ prod: true, win })).toBe(false)
  })

  it('em produção e HTTPS registra /sw.js sem cache HTTP do script', () => {
    const { win, register } = fakeWindow()
    expect(registerServiceWorker({ prod: true, win })).toBe(true)
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' })
  })

  it('espera o load quando a página ainda está carregando', () => {
    const { win, register, addEventListener } = fakeWindow({ readyState: 'loading' })
    registerServiceWorker({ prod: true, win })
    expect(register).not.toHaveBeenCalled()
    expect(addEventListener).toHaveBeenCalledWith('load', expect.any(Function), { once: true })
    addEventListener.mock.calls[0][1]()
    expect(register).toHaveBeenCalledOnce()
  })
})
