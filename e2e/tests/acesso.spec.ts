import { expect, test } from '@playwright/test'

import { contaDaRodada, novaCasa, SENHA } from './helpers'

// Estes testes começam sem sessão (os demais herdam a do preparo).
test.use({ storageState: { cookies: [], origins: [] } })

test('sem sessão, o app manda para o login', async ({ page }) => {
  await page.goto('/resumo')
  await expect(page).toHaveURL(/\/entrar$/)
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible()
})

test('cadastro cria a casa, e dá para sair e entrar de novo', async ({ page }) => {
  const { email, nome } = await novaCasa(page)
  await expect(page.getByRole('region', { name: 'Primeiros passos' })).toBeVisible()

  await page.getByRole('button', { name: `Conta de ${nome}` }).click()
  await page.getByRole('menuitem', { name: 'Sair' }).click()
  await expect(page).toHaveURL(/\/entrar$/)

  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(SENHA)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('region', { name: 'Contas do mês' })).toBeVisible()
})

test('senha errada não entra', async ({ page }) => {
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(contaDaRodada().email)
  await page.getByLabel('Senha').fill('senha-errada-de-teste')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page).toHaveURL(/\/entrar$/)
})
