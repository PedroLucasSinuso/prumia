import { Check } from 'lucide-react'

import { api } from '../../api/client'
import { THEMES, useTheme, type ThemeId, type ThemeInfo } from '../../lib/theme'
import { useToast } from '../toastContext'
import { Eyebrow } from '../ui/Eyebrow'
import { SectionHeader } from './ui'

/**
 * Miniatura de um tema: um pedaço do app desenhado com os tokens DAQUELE tema. Funciona porque o CSS dos temas usa
 * seletor de atributo (`[data-theme=...]`), então o contêiner redefine as cores só para o que está dentro dele.
 * Mostra os papéis da direção "Instrumento calmo": barra `nav`, título `heading`, o destaque em `raised` (rótulo `muted` e
 * valor em `alert-text`), a régua (`done` · `accent` · `alert`) e o filtro (`sunken` com a opção ativa em `raised`).
 * Só formas (sem texto): é decorativa (`aria-hidden`).
 */
function Mini({ theme }: { theme: Exclude<ThemeId, 'sistema'> }) {
  const bars = ['h-1.5 bg-done', 'h-2.5 bg-done', 'h-3 bg-alert', 'h-px bg-line-strong', 'h-2 bg-accent', 'h-1 bg-accent', 'h-px bg-line-strong', 'h-2.5 bg-accent']
  return (
    <div data-theme={theme} aria-hidden="true" className="flex h-full min-w-0 flex-1 bg-surface text-ink">
      <div className="flex w-5 shrink-0 flex-col items-center gap-1.5 bg-nav pt-2">
        <span className="size-2 rounded-sm bg-on-nav/80" />
        <span className="h-1 w-2.5 rounded-sm bg-on-nav/50" />
        <span className="h-1 w-2.5 rounded-sm bg-on-nav/50" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-2">
        <span className="h-2 w-3/5 rounded-sm bg-heading" />
        <div className="flex flex-col gap-1 rounded-sm bg-raised p-1.5">
          <span className="h-1 w-1/3 rounded-sm bg-muted" />
          <span className="h-2 w-1/2 rounded-sm bg-alert-text" />
        </div>
        <div className="flex h-3 items-end gap-0.5">
          {bars.map((b, i) => <span key={i} className={`flex-1 rounded-t-xs ${b}`} />)}
        </div>
        <div className="flex w-fit gap-0.5 rounded-sm bg-sunken p-0.5">
          <span className="h-1.5 w-4 rounded-xs bg-raised" />
          <span className="h-1.5 w-4 rounded-xs" />
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
        className={`flex flex-col overflow-hidden rounded-md border bg-raised text-left transition-colors duration-150 ${on ? 'border-accent ring-1 ring-accent' : 'border-line hover:border-ink/50'}`}
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
            <span className="block text-sm font-semibold text-ink">{t.label}</span>
            <span className="block text-meta text-muted">{t.description}</span>
          </span>
          <span aria-hidden="true" className={`flex size-5 shrink-0 items-center justify-center rounded-sm border ${on ? 'border-accent bg-accent text-surface' : 'border-line-strong'}`}>
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
            <Eyebrow as="h3" className="mb-2">{g.title}</Eyebrow>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{g.items.map(card)}</div>
          </section>
        ))}
      </div>
    </div>
  )
}
