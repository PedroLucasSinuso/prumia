import { useWallets } from '../api/queries'
import { useActiveHouse } from '../auth/useActiveHouse'
import { walletName } from './wallets'

/** Devolve `(id) => nome` da carteira, com a lista da casa ativa (em cache; vazio enquanto carrega). */
export function useWalletName(): (id: string | undefined) => string {
  const { house } = useActiveHouse()
  const wallets = useWallets(house?.id ?? '')
  return (id) => walletName(wallets.data, id)
}

/** Etiqueta curta para "sugere esta carteira": o nome da carteira, ou nada quando é a padrão (não precisa avisar). */
export function useWalletTag(): (id: string | null | undefined) => string | undefined {
  const { house } = useActiveHouse()
  const wallets = useWallets(house?.id ?? '')
  return (id) => {
    const w = id ? wallets.data?.find((x) => x.id === id) : undefined
    return w && !w.isDefault ? w.name : undefined
  }
}
