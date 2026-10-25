/**
 * Classes compartilhadas pelas primitivas (só tokens semânticos).
 * Celular: alvos de 44 px. Computador (`md:`): 36 px, mais denso. Hover/foco/disabled iguais em todos os controles.
 * Fica num arquivo .ts (sem componentes) porque o "recarregamento rápido" do Vite só funciona em arquivos que exportam
 * apenas componentes; funções de classe moram aqui.
 */

/** Rótulo pequeno em caixa alta acima do campo (12 px, texto secundário sólido). */
export const labelCls = 'text-meta font-medium uppercase tracking-wider text-muted'

/** Dica sob um campo. */
export const hintCls = 'text-meta text-muted'

/** Erro sob um campo: `alert-text` (o coral puro como texto dava 2,56:1 no Marfim). */
export const errorCls = 'text-meta font-medium text-alert-text'

/** Caixa de um controle de uma linha (input, gatilho de calendário, combobox). Borda `line-strong`; erro em `alert-text`. */
export const controlCls = (error?: boolean) =>
  `h-11 w-full rounded-md border bg-raised px-3 text-base text-ink placeholder:text-muted transition-colors md:h-9 md:text-sm ` +
  `hover:border-ink/50 focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-line-strong ` +
  (error ? 'border-alert-text' : 'border-line-strong')

/** Chip/botão de escolha (atalhos "recentes" do formulário): ativo sobe para `raised` com contorno `structure`. */
export const chipCls = (on: boolean) =>
  `flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border px-3 text-ui transition-colors md:min-h-9 motion-safe:active:scale-[0.98] ` +
  (on
    ? 'border-structure bg-raised font-semibold text-heading'
    : 'border-line-strong font-medium text-ink hover:border-ink/50 hover:bg-ink/5 active:bg-ink/10')

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'icon'
export type ButtonSize = 'md' | 'sm'

const variants: Record<ButtonVariant, string> = {
  // A ação principal da tela: o único bloco sólido em `structure`.
  primary: 'bg-structure text-on-structure hover:bg-structure/90 active:bg-structure/80 disabled:bg-structure/50',
  // Ação de apoio: contorno `line-strong`, fundo transparente (o tom da superfície por baixo continua).
  secondary: 'border border-line-strong text-ink hover:border-ink/50 hover:bg-ink/5 active:bg-ink/10 disabled:opacity-50 disabled:hover:border-line-strong disabled:hover:bg-transparent',
  // Só texto: aparece o fundo ao passar o mouse.
  quiet: 'text-ink hover:bg-ink/6 active:bg-ink/10 disabled:opacity-50 disabled:hover:bg-transparent',
  // Destrutiva: contorno e texto em `alert-text` (o coral puro não passa 4,5:1 como texto).
  danger: 'border border-alert-text/70 text-alert-text hover:bg-alert/10 active:bg-alert/15 disabled:opacity-50 disabled:hover:bg-transparent',
  // Quadrado só com ícone (setas, fechar). Exige `aria-label` (ver o tipo em Button.tsx).
  icon: 'text-ink hover:bg-ink/8 active:bg-ink/12 disabled:opacity-40 disabled:hover:bg-transparent',
}

// Celular: 44 px (alvo de toque) nos dois tamanhos; computador: 36 px (md) ou 32 px (sm).
const sizes: Record<ButtonSize, string> = {
  md: 'h-11 gap-2 px-4 text-sm md:h-9',
  sm: 'h-11 gap-1.5 px-3 text-ui md:h-8',
}
const iconSizes: Record<ButtonSize, string> = { md: 'size-11 md:size-9', sm: 'size-11 md:size-8' }

/**
 * Classes do botão da marca, para quando o elemento não é um <button> (um <Link>, um <label> de arquivo).
 * Uso: `className={buttonCls({ variant: 'secondary', size: 'sm' })}`.
 */
export function buttonCls({ variant = 'primary', size = 'md', className = '' }: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  const box = variant === 'icon' ? `${iconSizes[size]} shrink-0` : sizes[size]
  return `inline-flex items-center justify-center whitespace-nowrap rounded-md font-semibold transition-colors motion-safe:active:scale-[0.99] disabled:cursor-not-allowed ${box} ${variants[variant]} ${className}`
}
