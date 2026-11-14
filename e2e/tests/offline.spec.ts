import { expect, test } from '@playwright/test'

import { abrirMes, lancarConta, unico } from './helpers'

// Leitura offline (public/sw.js): com o servidor fora do alcance, o app abre com o que já foi visto e avisa de quando são
// os dados; escrever continua exigindo servidor.
test('sem rede, o app abre com os dados guardados e avisa', async ({ page, context }) => {
  const aluguel = unico('Aluguel fictício')
  await abrirMes(page)
  await lancarConta(page, aluguel, '120000')

  // O service worker assume a página e, na recarga, guarda a moldura e as respostas da API.
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await expect(page.getByRole('button', { name: `Detalhes de ${aluguel}` })).toBeVisible()
  await expect(page.getByText('Sem conexão com o servidor')).toBeHidden()

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByText('Sem conexão com o servidor')).toBeVisible()
  await expect(page.getByRole('button', { name: `Detalhes de ${aluguel}` })).toContainText('R$ 1.200,00')

  // Voltou a rede: o aviso some sozinho.
  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.getByText('Sem conexão com o servidor')).toBeHidden()
})
