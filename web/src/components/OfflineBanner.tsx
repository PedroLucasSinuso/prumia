import { useStaleSince } from '../lib/offline'

const when = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

/** Aviso fixo no topo quando a tela mostra dados guardados no aparelho (servidor desligado ou sem sinal). */
export function OfflineBanner() {
  const since = useStaleSince()
  if (since === null) return null
  return (
    <div role="status" className="border-b border-line bg-raised px-4 py-2 text-center text-sm text-ink">
      <span aria-hidden="true" className="font-mono text-alert">
        [ ✖ ]
      </span>{' '}
      Sem conexão com o servidor. Mostrando dados de{' '}
      <span className="font-mono tabular-nums">{when.format(since)}</span>; para alterar algo, aguarde a conexão voltar.
    </div>
  )
}
