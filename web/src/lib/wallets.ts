import type { Wallet } from '../api/types'

/** Carteiras que ainda podem receber lançamentos novos (a padrão sempre está entre elas). */
export const activeWallets = (wallets: Wallet[]) => wallets.filter((w) => !w.archived)

/**
 * Carteiras que pagam conta e recebem receita: ativas e que não são investimento (investimento só se move por
 * transferência e pelo Conferir saldo).
 */
export const spendableWallets = (wallets: Wallet[]) => activeWallets(wallets).filter((w) => w.kind !== 'investment')

export const isInvestment = (w: { kind: Wallet['kind'] }) => w.kind === 'investment'

export const defaultWallet = (wallets: Wallet[]) => wallets.find((w) => w.isDefault)

/** Nome para exibir; carteira desconhecida (ainda carregando) vira vazio em vez de "undefined". */
export const walletName = (wallets: Wallet[] | undefined, id: string | undefined) => wallets?.find((w) => w.id === id)?.name ?? ''

/**
 * Carteira sugerida para uma receita nova: Vale sugere a carteira "Benefício" ativa (se existir); qualquer outro tipo, a padrão.
 */
export function suggestWalletId(wallets: Wallet[], kind: 'salary' | 'benefit' | 'other'): string {
  const active = spendableWallets(wallets)
  if (kind === 'benefit') {
    const vr = active.find((w) => w.name.toLocaleLowerCase('pt-BR') === 'benefício')
    if (vr) return vr.id
  }
  return (defaultWallet(active) ?? active[0])?.id ?? ''
}
