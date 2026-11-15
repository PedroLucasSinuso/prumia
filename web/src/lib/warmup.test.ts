import { describe, expect, it } from 'vitest'

import { dataRequests, shouldWarmData, warmMonths, WINDOW_AHEAD, WINDOW_BACK } from './warmup'

describe('preparo do modo offline', () => {
  it('a janela vai de 3 meses atrás a 2 à frente, atravessando o ano', () => {
    expect(warmMonths('2026-02-01')).toEqual(['2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01'])
    expect(warmMonths('2026-02-01')).toHaveLength(WINDOW_BACK + 1 + WINDOW_AHEAD)
  })

  it('só prepara com rede, sem economia de dados e se o último preparo é antigo', () => {
    const now = 1_000_000_000_000
    const hour = 60 * 60 * 1000
    expect(shouldWarmData(null, now, { onLine: true })).toBe(true)
    expect(shouldWarmData(now - hour, now, { onLine: true })).toBe(false)
    expect(shouldWarmData(now - 7 * hour, now, { onLine: true })).toBe(true)
    expect(shouldWarmData(null, now, { onLine: false })).toBe(false)
    expect(shouldWarmData(null, now, { onLine: true, connection: { saveData: true } })).toBe(false)
  })

  it('pede a sessão e os cadastros da casa uma vez e nove leituras por mês da janela', () => {
    expect(dataRequests('casa', '2026-02-01')).toHaveLength(9 + 9 * 6)
  })
})
