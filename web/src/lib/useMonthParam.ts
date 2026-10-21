import { useSearchParams } from 'react-router-dom'

import { currentMonth, monthFromParam, monthToParam } from './dates'

/** O mês exibido mora na URL (?mes=2026-10): voltar, compartilhar e trocar de tela mantendo o mês funcionam. */
export function useMonthParam(): [string, (month: string) => void] {
  const [params, setParams] = useSearchParams()
  const month = monthFromParam(params.get('mes')) ?? currentMonth()
  const setMonth = (m: string) => setParams(m === currentMonth() ? {} : { mes: monthToParam(m) }, { replace: true })
  return [month, setMonth]
}
