import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { api } from '../../api/client'
import { ApiError, unwrap } from '../../api/errors'
import { networkErrorMessage } from '../../auth/errors'
import { disablePush, enablePush, pushState, type PushState } from '../../lib/push'
import { useToast } from '../toastContext'
import { Button } from '../ui/Button'
import { Notice } from '../ui/Notice'
import { Card, SectionHeader } from './ui'

/**
 * Ajustes > Avisos: liga e desliga o lembrete de vencimento NESTE aparelho (Web Push). O servidor manda, uma vez por dia,
 * um aviso por casa com o que está atrasado ou vence até amanhã. Cada aparelho se liga separadamente, e sair da conta desliga.
 */
export function NotificationsSection() {
  const toast = useToast()
  const config = useQuery({ queryKey: ['push-config'], queryFn: () => unwrap(api.GET('/push/config')) })
  const [state, setState] = useState<PushState>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let cancelled = false
    void pushState().then((s) => !cancelled && setState(s))
    return () => {
      cancelled = true
    }
  }, [])

  async function run(action: () => Promise<PushState>) {
    setBusy(true)
    setError(undefined)
    try {
      setState(await action())
    } catch (err) {
      setError(err instanceof ApiError && !err.network ? 'Não foi possível ligar os avisos agora. Tente de novo mais tarde.' : networkErrorMessage)
      setState(await pushState())
    } finally {
      setBusy(false)
    }
  }

  async function test() {
    setBusy(true)
    setError(undefined)
    try {
      const { sent } = await unwrap(api.POST('/push/test'))
      toast({ message: sent > 0 ? 'Aviso de teste enviado. Ele deve aparecer em instantes.' : 'Nenhum aparelho com avisos ligados.' })
    } catch (err) {
      setError(err instanceof ApiError && err.problem?.code === 'too_many_requests' ? 'Muitos testes seguidos. Aguarde um pouco.' : networkErrorMessage)
    } finally {
      setBusy(false)
    }
  }

  const publicKey = config.data?.publicKey
  return (
    <div>
      <SectionHeader title="Avisos" description="Um lembrete por dia, neste aparelho, quando houver conta atrasada ou vencendo até amanhã." />
      <Card label="Avisos de vencimento" title="Avisos de vencimento" className="max-w-xl">
        {config.isPending || state === undefined ? (
          <p className="mt-2 text-sm text-muted">Carregando…</p>
        ) : config.isError ? (
          <Notice className="mt-3" onRetry={() => void config.refetch()}>Não foi possível carregar os avisos.</Notice>
        ) : !config.data.enabled || !publicKey ? (
          <p className="mt-2 text-sm text-muted">Os avisos não estão ligados neste servidor. Quem cuida dele pode ligar (guia técnico, "Avisos por push").</p>
        ) : state === 'unsupported' ? (
          <p className="mt-2 text-sm text-muted">
            Este navegador não recebe avisos do prumia aqui. No iPhone, instale o prumia na tela inicial e abra por lá; no computador e no Android, use o endereço com https.
          </p>
        ) : state === 'denied' ? (
          <p className="mt-2 text-sm text-muted">
            As notificações do prumia estão bloqueadas neste navegador. Libere nas configurações do site (o cadeado ao lado do endereço) e volte aqui.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-ink">
              <span aria-hidden="true" className="font-mono text-muted">{state === 'on' ? '[ ▪ ]' : '[ ▫ ]'}</span>{' '}
              {state === 'on' ? 'Ligados neste aparelho.' : 'Desligados neste aparelho.'}
            </p>
            <p className="mt-1 text-sm text-muted">
              O aviso mostra só quantas contas e o total, sem nomes. Vale para todas as casas de que você participa. Sair da conta desliga.
            </p>
            {error && <Notice className="mt-3">{error}</Notice>}
            <div className="mt-4 flex flex-wrap gap-2">
              {state === 'on' ? (
                <>
                  <Button variant="secondary" disabled={busy} onClick={() => void test()}>Enviar aviso de teste</Button>
                  <Button variant="secondary" disabled={busy} onClick={() => void run(disablePush)}>Desligar avisos</Button>
                </>
              ) : (
                <Button loading={busy} loadingLabel="Ligando…" onClick={() => void run(() => enablePush(publicKey))}>Ligar avisos neste aparelho</Button>
              )}
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
