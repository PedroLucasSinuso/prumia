import type { Me } from '../api/types'
import { useAuth } from './context'

export type House = Me['households'][number]

/**
 * Casa ativa do usuário logado. É a escolhida no seletor (guardada por usuário); se ela não existe mais
 * (saiu, foi removido, a casa foi excluída) ou nada foi escolhido, cai na 1ª casa da lista.
 * `house` é undefined sem sessão ou sem casa nenhuma.
 */
export function useActiveHouse(): { house?: House; houses: House[]; selectHouse: (houseId: string) => void } {
  const { session, activeHouseId, selectHouse } = useAuth()
  const houses = session.status === 'authenticated' ? session.me.households : []
  const house = houses.find((h) => h.id === activeHouseId) ?? houses[0]
  return { house, houses, selectHouse }
}
