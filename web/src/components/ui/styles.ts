/**
 * Classes compartilhadas pelas primitivas de formulário (só tokens semânticos).
 * Celular: alvos de 44 px. Computador (`md:`): 36 px, mais denso. Hover/foco/disabled iguais em todos os controles.
 */

/** Rótulo pequeno em caixa alta acima do campo. */
export const labelCls = 'text-xs font-medium uppercase tracking-wider text-ink/75'

/** Caixa de um controle de uma linha (input, gatilho de calendário, combobox). */
export const controlCls = (error?: boolean) =>
  `h-11 w-full rounded-md border bg-raised/40 px-3 text-base text-ink placeholder:text-ink/40 transition-colors md:h-9 md:text-sm ` +
  `hover:border-ink/45 focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-ink/25 ` +
  (error ? 'border-alert' : 'border-ink/25')

/** Chip/botão de escolha (usado por Segmented e pelos atalhos "recentes"). */
export const chipCls = (on: boolean) =>
  `flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border px-3 text-[13px] transition-colors md:min-h-9 motion-safe:active:scale-[0.98] ` +
  (on
    ? 'border-structure bg-structure font-semibold text-on-structure'
    : 'border-ink/30 font-medium text-ink hover:border-ink/50 hover:bg-ink/5 active:bg-ink/10')
