import { THEMES, useTheme, type ThemeId } from '../lib/theme'

// Cada prévia aplica `data-theme` num contêiner próprio: os tokens trocam só ali dentro (nada de cor nova).
const previewTheme: Record<ThemeId, string> = { marfim: 'marfim', grafite: 'grafite', contraste: 'contraste', sistema: 'sistema' }

/** Ajustes > Aparência: escolha do tema, com prévia. Vale por aparelho (fica salvo no navegador). */
export function AppearanceSection() {
  const { theme, setTheme } = useTheme()
  return (
    <section aria-label="Aparência" className="rounded-md border border-line p-4">
      <h2 className="font-display text-[24px] font-bold text-structure font-stretch-condensed">Aparência</h2>
      <p className="mt-1 text-sm text-ink/80">Escolha como o prumia aparece neste aparelho. Todos os temas usam só as cores da marca.</p>
      <div role="radiogroup" aria-label="Tema" className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        {THEMES.map((t) => {
          const on = theme === t.id
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setTheme(t.id)}
              className={`flex flex-col gap-2 rounded-md border p-2 text-left ${on ? 'border-structure ring-2 ring-structure' : 'border-line hover:bg-ink/5'}`}
            >
              <span data-theme={previewTheme[t.id]} aria-hidden="true" className="flex h-16 overflow-hidden rounded-sm border border-line bg-surface text-ink">
                <span className="flex w-1/4 flex-col gap-1 bg-structure p-1.5">
                  <span className="h-1.5 rounded-xs bg-on-structure/70" />
                  <span className="h-1.5 rounded-xs bg-on-structure/40" />
                </span>
                <span className="flex flex-1 flex-col justify-center gap-1.5 p-2">
                  <span className="h-2 w-2/3 rounded-xs bg-ink/70" />
                  <span className="h-2 w-1/3 rounded-xs bg-accent" />
                </span>
              </span>
              <span className="text-sm font-semibold">
                {on && <span aria-hidden="true" className="mr-1 font-mono text-xs">[ ▪ ]</span>}
                {t.label}
              </span>
              <span className="text-xs text-ink/75">{t.description}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
