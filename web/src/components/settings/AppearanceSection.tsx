import { Check } from 'lucide-react'

import { api } from '../../api/client'
import { THEMES, useTheme, type ThemeId, type ThemeInfo } from '../../lib/theme'
import { useToast } from '../toastContext'
import { SectionHeader } from './ui'

/**
 * Miniatura de um tema: um pedaço do app desenhado com os tokens DAQUELE tema. Funciona porque o CSS dos temas usa
 * seletor de atributo (`[data-theme=...]`), então o contêiner redefine as cores só para o que está dentro dele.
 */
function Mini({ theme }: { theme: Exclude<ThemeId, 'sistema'> }) {
  return (
    <div data-theme={theme} aria-hidden="true" className="flex h-full min-w-0 flex-1 bg-surface text-ink">
      <div className="flex w-5 shrink-0 flex-col items-center gap-1.5 bg-structure pt-2">
        <span className="size-2 rounded-sm bg-on-structure/80" />
        <span className="h-1 w-2.5 rounded-sm bg-on-structure/50" />
        <span className="h-1 w-2.5 rounded-sm bg-on-structure/50" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-2">
        <span className="h-2 w-3/5 rounded-sm bg-heading" />
        <span className="h-1.5 w-full rounded-sm bg-accent/80" />
        <div className="flex items-center gap-1 border-t border-line pt-1.5">
          <span className="font-mono text-[8px] leading-none text-accent">[ ▪ ]</span>
          <span className="h-1 flex-1 rounded-sm bg-ink/40" />
        </div>
        <div className="flex items-center gap-1">
          <span className="font-mono text-[8px] leading-none text-muted">[ ▫ ]</span>
          <span className="h-1 flex-1 rounded-sm bg-ink/25" />
          <span className="size-1.5 rounded-sm bg-alert" />
        </div>
      </div>
    </div>
  )
}

/**
 * Ajustes > Aparência: tema de cor com prévia. Aplica na hora (neste aparelho) e grava na conta (PATCH /auth/me),
 * para valer nos outros aparelhos ao entrar. Se a gravação falhar, o tema fica só neste aparelho e a pessoa é avisada.
 */
export function AppearanceSection() {
  const { theme, setTheme } = useTheme()
  const toast = useToast()

  async function choose(id: ThemeId) {
    if (id === theme) return
    setTheme(id)
    try {
      const { error } = await api.PATCH('/auth/me', { body: { theme: id } })
      if (error) throw new Error(error.code)
    } catch {
      toast({ message: 'Tema aplicado neste aparelho, mas não deu para salvar na sua conta. Tente de novo mais tarde.' })
    }
  }

  const groups: { title: string; items: ThemeInfo[] }[] = [
    { title: 'Claros', items: THEMES.filter((t) => t.tone === 'claro') },
    { title: 'Escuros', items: THEMES.filter((t) => t.tone === 'escuro') },
    { title: 'Automático', items: THEMES.filter((t) => t.tone === 'auto') },
  ]

  const card = (t: ThemeInfo) => {
    const on = t.id === theme
    return (
      <button
        key={t.id}
        type="button"
        role="radio"
        aria-checked={on}
        onClick={() => void choose(t.id)}
        className={`flex flex-col overflow-hidden rounded-md border text-left transition-colors duration-150 ${on ? 'border-structure ring-1 ring-structure' : 'border-line hover:border-ink/50'}`}
      >
        <div className="flex h-24 border-b border-line">
          {t.id === 'sistema' ? (
            <>
              <Mini theme="marfim" />
              <Mini theme="dracula" />
            </>
          ) : (
            <Mini theme={t.id} />
          )}
        </div>
        <div className="flex items-start gap-3 p-3">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{t.label}</span>
            <span className="block text-meta text-muted">{t.description}</span>
          </span>
          <span aria-hidden="true" className={`flex size-5 shrink-0 items-center justify-center rounded-sm border ${on ? 'border-structure bg-structure text-on-structure' : 'border-line-strong'}`}>
            {on && <Check size={14} strokeWidth={2.5} />}
          </span>
        </div>
      </button>
    )
  }

  return (
    <div>
      <SectionHeader title="Aparência" description="O tema vale para a sua conta: muda neste aparelho na hora e nos outros quando você entrar." />
      <div role="radiogroup" aria-label="Tema" className="flex max-w-6xl flex-col gap-6">
        {groups.map((g) => (
          <section key={g.title} aria-label={g.title}>
            <h3 className="mb-2 text-meta font-medium uppercase tracking-wider text-muted">{g.title}</h3>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{g.items.map(card)}</div>
          </section>
        ))}
      </div>
    </div>
  )
}
