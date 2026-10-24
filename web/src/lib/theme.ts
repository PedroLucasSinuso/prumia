import { useCallback, useSyncExternalStore } from 'react'

/**
 * Temas de cor da prumia. Cada tema é uma paleta completa que preenche os mesmos papéis (tokens `surface`, `raised`, `ink`,
 * `structure`, `on-structure`, `heading`, `accent`, `alert`, `line` em src/index.css); o componente nunca usa cor solta.
 *
 * O tema vale por aparelho (localStorage) e vai no atributo `data-theme` do <html>. Quem aplica no carregamento,
 * antes do React, é `public/theme-init.js` (evita piscar o tema errado); mantenha os dois em sincronia.
 */
export type ThemeId = 'marfim' | 'solarized' | 'latte' | 'dracula' | 'nord' | 'gruvbox' | 'rosepine' | 'contraste' | 'sistema'
/** Tema efetivamente na tela (`sistema` vira `marfim` ou `dracula`). */
export type ResolvedTheme = Exclude<ThemeId, 'sistema'>

export type ThemeInfo = { id: ThemeId; label: string; description: string; tone: 'claro' | 'escuro' | 'auto' }

export const THEMES: ReadonlyArray<ThemeInfo> = [
  { id: 'marfim', label: 'Marfim', description: 'A identidade da prumia: marfim, petróleo e cobalto.', tone: 'claro' },
  { id: 'solarized', label: 'Solarized', description: 'Claro e suave, de Ethan Schoonover. Bom para ler muito texto.', tone: 'claro' },
  { id: 'latte', label: 'Latte', description: 'Claro e frio, da paleta Catppuccin, com azul vivo.', tone: 'claro' },
  { id: 'contraste', label: 'Alto contraste', description: 'Preto e branco, com bordas e foco mais fortes.', tone: 'claro' },
  { id: 'dracula', label: 'Dracula', description: 'Escuro clássico, com roxo e fundo azul-noite.', tone: 'escuro' },
  { id: 'nord', label: 'Nord', description: 'Escuro e frio, em tons de gelo e azul.', tone: 'escuro' },
  { id: 'gruvbox', label: 'Gruvbox', description: 'Escuro e quente, em tons de terra e âmbar.', tone: 'escuro' },
  { id: 'rosepine', label: 'Rosé Pine', description: 'Escuro e discreto, em tons de malva.', tone: 'escuro' },
  { id: 'sistema', label: 'Sistema', description: 'Marfim de dia e Dracula quando o aparelho está no modo escuro.', tone: 'auto' },
]

export const DEFAULT_THEME: ThemeId = 'marfim'
export const THEME_STORAGE_KEY = 'prumia.theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

/** Cor da barra do sistema (<meta name="theme-color">) por tema: a do fundo (no Marfim, o petróleo da marca). */
export const THEME_COLOR: Record<ResolvedTheme, string> = {
  marfim: '#203D40',
  solarized: '#FDF6E3',
  latte: '#EFF1F5',
  dracula: '#282A36',
  nord: '#2E3440',
  gruvbox: '#282828',
  rosepine: '#191724',
  contraste: '#FFFFFF',
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
  return systemIsDark() ? 'dracula' : 'marfim'
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
 * Ex.: `const { theme, setTheme } = useTheme(); setTheme('dracula')`.
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
