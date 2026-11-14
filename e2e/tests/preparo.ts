import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { test as preparo } from '@playwright/test'

import { CONTA, SESSAO } from '../playwright.config'
import { novaCasa } from './helpers'

preparo('cria a conta e a casa da rodada', async ({ page }) => {
  const conta = await novaCasa(page)
  mkdirSync(dirname(SESSAO), { recursive: true })
  writeFileSync(CONTA, JSON.stringify(conta))
  await page.context().storageState({ path: SESSAO })
})
