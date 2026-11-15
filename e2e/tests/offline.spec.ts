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

// Preparo do modo offline (src/lib/warmup.ts): abrindo SÓ o Mês, o app baixa em segundo plano o código das outras telas e
// os dados dos meses próximos. Sem rede, dá para navegar por telas e meses que nunca foram abertos.
test('sem rede, navega por telas e meses que nunca foram abertos', async ({ page, context }) => {
  const mercado = unico('Mercado fictício')
  await abrirMes(page)
  await lancarConta(page, mercado, '35000')

  // O preparo termina quando grava a marca da casa (só grava se todas as leituras responderam).
  await page.waitForFunction(() => Object.keys(localStorage).some((k) => k.startsWith('prumia.offline.warm.')), null, { timeout: 45_000 })

  await context.setOffline(true)
  const semErro = () => expect(page.getByText(/Não foi possível carregar/)).toHaveCount(0)

  await page.getByRole('link', { name: 'Receitas', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Receitas do mês' })).toBeVisible()
  await semErro()

  await page.getByRole('link', { name: 'Resumo', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Destaques do mês' })).toBeVisible()
  await page.getByRole('button', { name: 'Mês anterior' }).click()
  await expect(page.getByRole('region', { name: 'Destaques do mês' })).toBeVisible()
  await semErro()

  await page.getByRole('link', { name: 'Ajustes', exact: true }).click()
  await expect(page).toHaveURL(/\/ajustes/)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  // Volta ao Mês e anda dois meses para a frente (o fim da janela).
  await page.getByRole('link', { name: 'Mês', exact: true }).click()
  await page.getByRole('button', { name: 'Próximo mês' }).click()
  await page.getByRole('button', { name: 'Próximo mês' }).click()
  await expect(page.getByRole('region', { name: 'Contas do mês' })).toBeVisible()
  await semErro()

  // Recarregar sem rede numa tela nunca aberta com conexão: a moldura e o código dela vêm do aparelho.
  await page.goto('/resumo')
  await expect(page.getByRole('region', { name: 'Destaques do mês' })).toBeVisible()
  await semErro()
})
