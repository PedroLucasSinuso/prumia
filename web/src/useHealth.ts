import { useEffect, useState } from 'react'

import { api } from './api/client'

export type HealthStatus = 'checking' | 'online' | 'offline'

/** Consulta GET /api/healthz uma vez e informa se a API e o banco estão respondendo. */
export function useHealth(): HealthStatus {
  const [status, setStatus] = useState<HealthStatus>('checking')

  useEffect(() => {
    let cancelled = false
    api
      .GET('/healthz')
      .then(({ response }) => !cancelled && setStatus(response.ok ? 'online' : 'offline'))
      .catch(() => !cancelled && setStatus('offline'))
    return () => {
      cancelled = true // evita atualizar estado de um componente já desmontado
    }
  }, [])

  return status
}
