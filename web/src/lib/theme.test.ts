import { act, renderHook } from '@testing-library/react'

// ?raw: o Vite entrega o conteúdo do arquivo como texto.
import initScript from '../../public/theme-init.js?raw'
import { readStoredTheme, resetThemeForTests, startThemeSync, THEME_STORAGE_KEY, THEMES, useTheme } from './theme'

// matchMedia falso que deixa o teste ligar/desligar o "modo escuro do sistema".
function fakeMatchMedia(dark: boolean) {
  const listeners = new Set<() => void>()
  const mq = {
    get matches() {
      return state.dark
    },
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  }
  const state = { dark }
  window.matchMedia = (() => mq) as never
  return {
    setDark(v: boolean) {
      state.dark = v
      listeners.forEach((l) => l())
    },
  }
}

const meta = () => document.querySelector('meta[name="theme-color"]')!.getAttribute('content')

beforeEach(() => {
  localStorage.clear()
  resetThemeForTests()
  document.documentElement.removeAttribute('data-theme')
  document.head.innerHTML = '<meta name="theme-color" content="#203D40" />'
  fakeMatchMedia(false)
})

describe('useTheme', () => {
  it('começa no Marfim quando não há preferência', () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('marfim')
    expect(result.current.resolved).toBe('marfim')
  })

  it('troca o tema, aplica no <html>, atualiza a barra e grava a preferência', () => {
    const { result } = renderHook(() => useTheme())
    act(() => result.current.setTheme('grafite'))
    expect(result.current.theme).toBe('grafite')
    expect(document.documentElement.dataset.theme).toBe('grafite')
    expect(meta()).toBe('#313638')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('grafite')

    // Outra montagem (ex.: recarregar a página) lê o que foi salvo.
    resetThemeForTests()
    expect(renderHook(() => useTheme()).result.current.theme).toBe('grafite')
  })

  it('compartilha o tema entre componentes', () => {
    const a = renderHook(() => useTheme())
    const b = renderHook(() => useTheme())
    act(() => a.result.current.setTheme('contraste'))
    expect(b.result.current.theme).toBe('contraste')
  })

  it('Sistema segue o modo do aparelho e reage à mudança', () => {
    const sys = fakeMatchMedia(true)
    startThemeSync()
    const { result } = renderHook(() => useTheme())
    act(() => result.current.setTheme('sistema'))
    expect(document.documentElement.dataset.theme).toBe('sistema')
    expect(result.current.resolved).toBe('grafite')
    expect(meta()).toBe('#313638')

    act(() => sys.setDark(false))
    expect(result.current.resolved).toBe('marfim')
    expect(meta()).toBe('#203D40')
  })

  it('ignora valor salvo inválido e sobrevive a localStorage bloqueado', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'neon')
    expect(readStoredTheme()).toBe('marfim')

    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    expect(readStoredTheme()).toBe('marfim')
    const { result } = renderHook(() => useTheme())
    act(() => result.current.setTheme('grafite'))
    expect(document.documentElement.dataset.theme).toBe('grafite')
    spy.mockRestore()
    set.mockRestore()
  })

  it('exporta os 4 temas com rótulo e descrição em pt-BR', () => {
    expect(THEMES.map((t) => t.label)).toEqual(['Marfim', 'Grafite', 'Contraste', 'Sistema'])
    THEMES.forEach((t) => expect(t.description.length).toBeGreaterThan(5))
  })
})

describe('public/theme-init.js', () => {
  // O script roda antes do React; aqui ele é executado como o navegador faria.
  const run = () => new Function(initScript)()

  it('aplica o tema salvo antes do app', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'grafite')
    run()
    expect(document.documentElement.dataset.theme).toBe('grafite')
    expect(meta()).toBe('#313638')
  })

  it('usa Marfim sem preferência e resolve Sistema pelo modo do aparelho', () => {
    run()
    expect(document.documentElement.dataset.theme).toBe('marfim')
    fakeMatchMedia(true)
    localStorage.setItem(THEME_STORAGE_KEY, 'sistema')
    run()
    expect(document.documentElement.dataset.theme).toBe('sistema')
    expect(meta()).toBe('#313638')
  })

  it('usa a mesma lista de temas que src/lib/theme.ts', () => {
    THEMES.forEach((t) => expect(initScript).toContain(`'${t.id}'`))
    expect(initScript).toContain(`'${THEME_STORAGE_KEY}'`)
  })
})
