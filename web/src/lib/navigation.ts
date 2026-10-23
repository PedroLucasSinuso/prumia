import { CalendarDays, ChartColumn, HandCoins, ScanLine, Settings2, type LucideIcon } from 'lucide-react'

/**
 * Destinos principais do app (barra inferior no celular, barra lateral no computador). Ordem = ordem na tela.
 *
 * Para acrescentar um destino (ex.: "Importar"), inclua um item aqui: AppShell desenha os dois menus a partir desta
 * lista. No celular cabem bem até 5 itens; `mobile: false` deixa um item só na barra lateral do computador.
 * Telas secundárias (ex.: /parcelas) ficam FORA desta lista e são abertas a partir de outras telas.
 */
export type NavItem = {
  to: string
  label: string
  icon: LucideIcon
  /** Outros caminhos que contam como "estar aqui" (ex.: /ajustes/casa marca Ajustes). Padrão: só `to` exato. */
  matchPrefix?: string
  /** false = não aparece na barra inferior do celular. Padrão: true. */
  mobile?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Mês', icon: CalendarDays },
  { to: '/receitas', label: 'Receitas', icon: HandCoins },
  { to: '/resumo', label: 'Resumo', icon: ChartColumn },
  // No celular o acesso é o botão "Importar" do mês; na barra lateral do computador é um atalho.
  { to: '/importar', label: 'Importar', icon: ScanLine, mobile: false },
  { to: '/ajustes', label: 'Ajustes', icon: Settings2, matchPrefix: '/ajustes' },
]

/** O item está ativo para este caminho? */
export function isActive(item: NavItem, pathname: string): boolean {
  if (item.matchPrefix) return pathname === item.matchPrefix || pathname.startsWith(item.matchPrefix + '/')
  return pathname === item.to
}

/** Tamanho e traço padrão dos ícones (briefing de marca: traço 1.5, 18-20 px, cor herdada). */
export const ICON = { size: 20, strokeWidth: 1.5 } as const
