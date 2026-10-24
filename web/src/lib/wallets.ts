import type { Wallet } from '../api/types'

/** Carteiras que ainda podem receber lançamentos novos (a padrão sempre está entre elas). */
export const activeWallets = (wallets: Wallet[]) => wallets.filter((w) => !w.archived)

export const defaultWallet = (wallets: Wallet[]) => wallets.find((w) => w.isDefault)

/** Nome para exibir; carteira desconhecida (ainda carregando) vira vazio em vez de "undefined". */
export const walletName = (wallets: Wallet[] | undefined, id: string | undefined) => wallets?.find((w) => w.id === id)?.name ?? ''

/**
 * Carteira sugerida para uma receita nova: Vale sugere a carteira "Benefício" ativa (se existir); qualquer outro tipo, a padrão.
 */
export function suggestWalletId(wallets: Wallet[], kind: 'salary' | 'benefit' | 'other'): string {
  const active = activeWallets(wallets)
  if (kind === 'benefit') {
    const vr = active.find((w) => w.name.toLocaleLowerCase('pt-BR') === 'benefício')
    if (vr) return vr.id
  }
  return (defaultWallet(active) ?? active[0])?.id ?? ''
}
