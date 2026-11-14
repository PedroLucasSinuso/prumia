import { expect, test } from '@playwright/test'

import { abrirMes, hoje, lancarConta, unico } from './helpers'

test('lançar uma conta, pagar e desfazer', async ({ page }) => {
  const luz = unico('Luz fictícia')
  await abrirMes(page)
  await lancarConta(page, luz, '18735')

  const linha = page.getByRole('button', { name: `Detalhes de ${luz}` })
  await expect(linha).toContainText('R$ 187,35')

  await page.getByRole('button', { name: `Pagar ${luz}`, exact: true }).click()
  // Paga continua na lista (riscada), agora com a carteira.
  await expect(linha).toContainText('paga na carteira Geral')

  await page.getByRole('button', { name: `Desfazer pagamento de ${luz}` }).click()
  await expect(page.getByRole('button', { name: `Pagar ${luz}`, exact: true })).toBeVisible()
  await expect(linha).not.toContainText('paga na carteira')
})

test('o que foi salvo continua lá depois de recarregar', async ({ page }) => {
  const internet = unico('Internet fictícia')
  await abrirMes(page)
  await lancarConta(page, internet, '9990')
  await page.reload()
  await expect(page.getByRole('button', { name: `Detalhes de ${internet}` })).toContainText('R$ 99,90')
})

test('compra parcelada aparece nos meses seguintes', async ({ page }) => {
  const compra = unico('Geladeira fictícia')
  await abrirMes(page)
  await page.getByRole('button', { name: 'Nova conta' }).first().click()
  const form = page.getByRole('dialog', { name: 'Nova conta' })
  await form.getByRole('radio', { name: 'parcelada' }).click()
  await form.getByLabel(/^Valor/).first().pressSequentially('30000')
  await form.getByLabel('Parcelas').fill('3')
  await form.getByLabel('Descrição').fill(compra)
  await form.getByRole('button', { name: /^Adicionar/ }).first().click()
  await expect(form).toBeHidden()

  const contas = page.getByRole('region', { name: 'Contas do mês' })
  await expect(contas.getByText(compra).first()).toBeVisible()
  await page.getByRole('button', { name: 'Próximo mês' }).click()
  await expect(contas.getByText(compra).first()).toBeVisible()
})

test('importar uma lista colada cria as contas com o vencimento da linha', async ({ page }) => {
  const { mes, ano } = hoje()
  const internet = unico('Internet fictícia')
  const gas = unico('Gás fictício')
  await page.goto('/importar')
  await page.getByRole('button', { name: 'Colar texto' }).click()
  await page.getByLabel('Texto das contas').fill(`${internet}: R$ 99,90 vence 20/${mes}\n${gas}: 150,00 dia 25/${mes}`)
  await page.getByRole('button', { name: 'Ler texto' }).click()

  const achadas = page.getByRole('region', { name: 'Contas encontradas' })
  await expect(achadas.getByRole('listitem', { name: `Conta 1: ${internet}` }).getByLabel('Vencimento')).toHaveValue(`20/${mes}/${ano}`)
  await expect(achadas.getByRole('listitem', { name: `Conta 2: ${gas}` }).getByLabel('Vencimento')).toHaveValue(`25/${mes}/${ano}`)
  await expect(achadas.getByText('2 contas · R$ 249,90')).toBeVisible()

  await page.getByRole('button', { name: /^Criar 2 contas/ }).click()
  await abrirMes(page)
  await expect(page.getByRole('button', { name: `Detalhes de ${internet}` })).toContainText('R$ 99,90')
  await expect(page.getByRole('button', { name: `Detalhes de ${gas}` })).toContainText('R$ 150,00')
})

test('uma linha só colada também mantém o vencimento escrito', async ({ page }) => {
  const { mes, ano } = hoje()
  const internet = unico('Internet fictícia')
  await page.goto('/importar')
  await page.getByRole('button', { name: 'Colar texto' }).click()
  await page.getByLabel('Texto das contas').fill(`${internet}: R$ 99,90 vence 20/${mes}`)
  await page.getByRole('button', { name: 'Ler texto' }).click()
  await expect(page.getByRole('region', { name: 'Contas encontradas' }).getByLabel('Vencimento')).toHaveValue(`20/${mes}/${ano}`)
})
