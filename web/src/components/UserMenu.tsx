import { useAuth } from '../auth/context'

/** Avatar quadrado com a inicial; abre um pequeno menu com "Sair". Usa <details>: acessível e sem JavaScript extra. */
export function UserMenu() {
  const { session, logout } = useAuth()
  if (session.status !== 'authenticated') return null
  const name = session.me.name
  return (
    <details className="relative">
      <summary
        aria-label={`Conta de ${name}`}
        className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-md border border-ink/25 text-base font-semibold text-structure [&::-webkit-details-marker]:hidden"
      >
        {name.slice(0, 1).toUpperCase()}
      </summary>
      <div className="absolute right-0 top-12 z-20 w-44 rounded-md border border-line bg-surface p-2 shadow-lg">
        <p className="truncate px-2 pb-2 text-sm font-semibold">{name}</p>
        <button onClick={() => void logout()} className="h-11 w-full rounded-sm px-2 text-left text-sm font-semibold text-structure hover:bg-ink/5">
          Sair
        </button>
      </div>
    </details>
  )
}
