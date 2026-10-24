import { useSyncExternalStore } from 'react'

/**
 * Realces passageiros de linha, sem passar props por três telas: quem salva ou paga chama `flashRow(id)` /
 * `pulsePaid(id)`; a linha daquela conta (Timeline, InvoiceRow) lê com `useFlash(id)` / `usePaidPulse(id)` e liga a
 * animação CSS (`motion-safe:animate-flash`, `animate-fill`). O estado vive fora do React (um Set no módulo) e o
 * `useSyncExternalStore` é o jeito do React de assinar isso. Some sozinho depois de `TTL` ms (cobre o tempo da lista
 * recarregar e a linha nova aparecer).
 */
const TTL = 3000

function makeStore() {
  const ids = new Set<string>()
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((l) => l())
  return {
    add(id: string) {
      ids.add(id)
      notify()
      setTimeout(() => {
        ids.delete(id)
        notify()
      }, TTL)
    },
    use(id: string): boolean {
      return useSyncExternalStore(
        (l) => {
          listeners.add(l)
          return () => listeners.delete(l)
        },
        () => ids.has(id),
        () => false,
      )
    },
  }
}

const flash = makeStore()
const paid = makeStore()

/** A conta acabou de ser criada ou alterada: a linha pisca com `bg-accent/15`. */
export const flashRow = (id: string) => flash.add(id)
/** A conta acabou de ser paga: o nó "preenche" com uma pequena animação. */
export const pulsePaid = (id: string) => paid.add(id)
export const useFlash = (id: string) => flash.use(id)
export const usePaidPulse = (id: string) => paid.use(id)
