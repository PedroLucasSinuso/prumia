import { describe, expect, it } from 'vitest'

import { linkToken } from './useLinkToken'

describe('linkToken', () => {
  it('lê do fragmento (formato atual) e, sem ele, da query (links antigos)', () => {
    expect(linkToken('#token=abc', '')).toBe('abc')
    expect(linkToken('', '?token=velho')).toBe('velho')
    expect(linkToken('#token=novo', '?token=velho')).toBe('novo')
    expect(linkToken('#token=a%2Bb', '')).toBe('a+b')
    expect(linkToken('', '')).toBe('')
  })
})
