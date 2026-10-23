import { useCallback, useSyncExternalStore } from 'react'

/**
 * Temas de cor da prumia. Nenhum tema cria cor: todos usam só as 5 cores da marca e trocam qual cor faz qual papel
 * (tokens `surface`, `ink`, `structure`, `on-structure`, `accent`, `alert` em src/index.css).
 *
 * O tema vale por aparelho (localStorage) e vai no atributo `data-theme` do <html>. Quem aplica no carregamento,
 * antes do React, é `public/theme-init.js` (evita piscar o tema errado); mantenha os dois em sincronia.
 */
export type ThemeId = 'marfim' | 'grafite' | 'contraste' | 'sistema'
/** Tema efetivamente na tela (`sistema` vira `marfim` ou `grafite`). */
export type ResolvedTheme = Exclude<ThemeId, 'sistema'>

export const THEMES: ReadonlyArray<{ id: ThemeId; label: string; description: string }> = [
  { id: 'marfim', label: 'Marfim', description: 'Claro, o visual padrão da prumia.' },
  { id: 'grafite', label: 'Grafite', description: 'Escuro, para usar à noite.' },
  { id: 'contraste', label: 'Contraste', description: 'Claro, com bordas e foco mais fortes.' },
  { id: 'sistema', label: 'Sistema', description: 'Segue o modo claro ou escuro do aparelho.' },
]

export const DEFAULT_THEME: ThemeId = 'marfim'
export const THEME_STORAGE_KEY = 'prumia.theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

/** Cor da barra do sistema (<meta name="theme-color">) por tema. Só cores da paleta. */
export const THEME_COLOR: Record<ResolvedTheme, string> = {
  marfim: '#203D40',
  grafite: '#313638',
  contraste: '#203D40',
}

function isThemeId(v: unknown): v is ThemeId {
  return THEMES.some((t) => t.id === v)
}

/** Lê a preferência salva. localStorage pode lançar exceção (aba anônima, bloqueio), daí o try/catch. */
export function readStoredTheme(): ThemeId {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isThemeId(v) ? v : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

function systemIsDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches
}

export function resolveTheme(theme: ThemeId): ResolvedTheme {
  if (theme !== 'sistema') return theme
  return systemIsDark() ? 'grafite' : 'marfim'
}

/** Põe o tema no <html> e atualiza a cor da barra do sistema. As cores mudam pelo CSS (seletor data-theme). */
export function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEME_COLOR[resolveTheme(theme)])
}

// Estado compartilhado: vários componentes podem usar useTheme() e todos veem a mesma escolha.
// useSyncExternalStore é o jeito do React de "assinar" um valor que vive fora dele (aqui, uma variável do módulo).
let current: ThemeId | null = null
const listeners = new Set<() => void>()

function getTheme(): ThemeId {
  if (current === null) current = readStoredTheme()
  return current
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setTheme(theme: ThemeId): void {
  current = theme
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // sem armazenamento: o tema vale só até fechar a aba
  }
  applyTheme(theme)
  listeners.forEach((l) => l())
}

/**
 * Chamado uma vez em main.tsx: reaplica o tema salvo (o theme-init.js já fez isso antes do app) e, no tema `sistema`,
 * atualiza a cor da barra quando o aparelho troca de modo claro/escuro. Devolve a função que desliga o ouvinte.
 */
export function startThemeSync(): () => void {
  applyTheme(getTheme())
  if (typeof window.matchMedia !== 'function') return () => {}
  const mq = window.matchMedia(DARK_QUERY)
  const onChange = () => applyTheme(getTheme())
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

/** Só para testes: esquece o estado do módulo. */
export function resetThemeForTests(): void {
  current = null
}

/**
 * Tema atual, o tema efetivo (`resolved`, útil para `sistema`) e a função para trocar.
 * Ex.: `const { theme, setTheme } = useTheme(); setTheme('grafite')`.
 */
export function useTheme(): { theme: ThemeId; resolved: ResolvedTheme; setTheme: (t: ThemeId) => void } {
  const theme = useSyncExternalStore(subscribe, getTheme, getTheme)
  const resolved = useSyncExternalStore(
    useCallback((cb: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => {}
      const mq = window.matchMedia(DARK_QUERY)
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    }, []),
    () => resolveTheme(theme),
    () => resolveTheme(theme),
  )
  return { theme, resolved, setTheme }
}
