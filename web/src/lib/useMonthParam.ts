import { useSearchParams } from 'react-router-dom'

import { currentMonth, monthFromParam, monthToParam } from './dates'
import { transition } from './motion'

/** O mês exibido mora na URL (?mes=2026-10): voltar, compartilhar e trocar de tela mantendo o mês funcionam. */
export function useMonthParam(): [string, (month: string) => void] {
  const [params, setParams] = useSearchParams()
  const month = monthFromParam(params.get('mes')) ?? currentMonth()
  // A troca desliza no sentido do tempo (lib/motion.ts): mês seguinte entra pela direita, anterior pela esquerda.
  const setMonth = (m: string) => {
    if (m === month) return
    transition(() => setParams(m === currentMonth() ? {} : { mes: monthToParam(m) }, { replace: true }), m > month ? 'next' : 'prev')
  }
  return [month, setMonth]
}
