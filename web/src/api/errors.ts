import type { Problem } from './types'

/** Erro devolvido pela API (problem+json) ou falha de rede (network = true, sem problem). */
export class ApiError extends Error {
  readonly problem?: Problem
  readonly network: boolean
  constructor(problem?: Problem, network = false) {
    super(problem?.code ?? (network ? 'network' : 'unknown'))
    this.problem = problem
    this.network = network
  }
}

/**
 * Executa uma chamada do cliente tipado e devolve só os dados, lançando ApiError em caso de erro.
 * É o formato que o TanStack Query espera (promessa que rejeita em falha).
 */
export async function unwrap<T>(call: Promise<{ data?: T; error?: Problem }>): Promise<T> {
  let result: { data?: T; error?: Problem }
  try {
    result = await call
  } catch {
    throw new ApiError(undefined, true)
  }
  if (result.data === undefined) {
    // 204 (sem corpo) chega como data undefined e error undefined: sucesso sem dados.
    if (result.error === undefined) return undefined as T
    throw new ApiError(result.error)
  }
  return result.data
}
