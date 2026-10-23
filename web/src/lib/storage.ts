import { useState } from 'react'

/**
 * Preferências pequenas de interface guardadas no aparelho (localStorage), como seções recolhidas.
 * localStorage pode lançar exceção (aba anônima, armazenamento bloqueado): aí a preferência só vale até fechar a aba.
 * Nunca guarde aqui dado financeiro ou da sessão.
 */
export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function writePref<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // sem armazenamento: segue só na memória
  }
}

/** useState que lembra o valor no aparelho. */
export function usePref<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => readPref(key, fallback))
  const set = (v: T) => {
    setValue(v)
    writePref(key, v)
  }
  return [value, set]
}
