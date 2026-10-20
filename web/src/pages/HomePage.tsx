import { useAuth } from '../auth/context'
import { Button } from '../components/Button'
import { useHealth, type HealthStatus } from '../useHealth'

const marker: Record<HealthStatus, { glyph: string; label: string; tone: string }> = {
  checking: { glyph: '[ ▫ ]', label: 'verificando', tone: 'text-graphite/60' },
  online: { glyph: '[ ▪ ]', label: 'api online', tone: 'text-cobalt' },
  offline: { glyph: '[ ✖ ]', label: 'api indisponível', tone: 'text-signal' },
}

/** Tela inicial do app logado. Por enquanto um esqueleto: a visão do mês chega com as invoices. */
export default function HomePage() {
  const { session, logout } = useAuth()
  const status = useHealth()
  if (session.status !== 'authenticated') return null
  const { me } = session
  const house = me.households[0]
  const m = marker[status]

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-teal text-ivory">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <span className="text-xl font-semibold tracking-tight">prumia</span>
          <div className="flex items-center gap-3">
            <span className="text-sm text-ivory/80">{me.name}</span>
            <Button variant="ghost" className="border-ivory/40 text-ivory hover:bg-ivory/10" onClick={() => void logout()}>
              Sair
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-graphite/70">casa</p>
          <h1 className="text-3xl font-bold tracking-tight">{house ? house.name : 'Sem casa'}</h1>
        </div>

        <section aria-label="Visão do mês" className="rounded-md border border-graphite/15 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-graphite/70">mês</p>
          <p className="mt-1 text-sm text-graphite/80">
            Suas contas e receitas aparecerão aqui. Estamos construindo o cadastro de contas.
          </p>
        </section>

        <p role="status" className={`font-mono text-xs ${m.tone}`}>
          {m.glyph} {m.label}
        </p>
      </main>
    </div>
  )
}
