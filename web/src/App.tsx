import { useHealth, type HealthStatus } from './useHealth'

// Marcadores analógicos da marca (manual, seção 5.2).
const marker: Record<HealthStatus, { glyph: string; label: string; tone: string }> = {
  checking: { glyph: '[ ▫ ]', label: 'verificando', tone: 'text-graphite/60' },
  online: { glyph: '[ ▪ ]', label: 'api online', tone: 'text-cobalt' },
  offline: { glyph: '[ ✖ ]', label: 'api indisponível', tone: 'text-signal' },
}

export default function App() {
  const status = useHealth()
  const m = marker[status]

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Faixa teal de ponta a ponta; o conteúdo interno respeita a largura máxima. */}
      <header className="bg-teal text-ivory">
        <div className="mx-auto max-w-3xl px-4 py-4">
          <span className="text-xl font-semibold tracking-tight">prumia</span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-4 py-12">
        <h1 className="text-4xl font-bold tracking-tight">Clareza para construir o futuro.</h1>

        <section aria-label="Estado do sistema" className="rounded-md border border-graphite/15 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-graphite/70">sistema</p>
          <p role="status" className={`mt-1 font-mono text-sm ${m.tone}`}>
            {m.glyph} {m.label}
          </p>
        </section>
      </main>
    </div>
  )
}
