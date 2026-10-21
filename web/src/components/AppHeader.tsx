import { useAuth } from '../auth/context'
import { Button } from './Button'

/** Faixa teal do app logado: marca, nome da pessoa e Sair. */
export function AppHeader() {
  const { session, logout } = useAuth()
  if (session.status !== 'authenticated') return null
  return (
    <header className="bg-teal text-ivory">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
        <span className="text-xl font-semibold tracking-tight">prumia</span>
        <div className="flex items-center gap-3">
          <span className="text-sm text-ivory/80">{session.me.name}</span>
          <Button variant="ghost" className="border-ivory/40 text-ivory hover:bg-ivory/10" onClick={() => void logout()}>
            Sair
          </Button>
        </div>
      </div>
    </header>
  )
}
