import { readFileSync } from 'node:fs'

import { expect, type Page } from '@playwright/test'

import { CONTA } from '../playwright.config'

export const SENHA = 'senha-de-teste-e2e-123'

/** Mês corrente como "MM" e "AAAA" no fuso do app, para montar datas que caem no mês aberto na tela. */
export function hoje() {
  const [dia, mes, ano] = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date()).split('/')
  return { dia, mes, ano }
}

/** Cria uma conta nova (e a casa dela) pela tela de cadastro e espera o Mês abrir. O compose de e2e sobe com OPEN_REGISTRATION=true. */
export async function novaCasa(page: Page, nome = 'Pessoa Teste') {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@exemplo.test`
  await page.goto('/cadastro')
  await page.getByLabel('Seu nome').fill(nome)
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(SENHA)
  await page.getByRole('button', { name: 'Criar conta' }).click()
  await expect(page.getByRole('region', { name: 'Contas do mês' })).toBeVisible()
  return { email, nome }
}

/** A conta criada pelo preparo (a sessão dela já vem no navegador de cada teste). */
export function contaDaRodada(): { email: string; nome: string } {
  return JSON.parse(readFileSync(CONTA, 'utf8'))
}

/**
 * Nome único por teste: todos dividem a mesma casa, então cada um só olha para as contas que criou. Só letras no sufixo:
 * na importação de lista, descrição terminada em número sem "R$" é recusada de propósito (parece CNPJ ou data).
 */
export const unico = (base: string) =>
  `${base} ${Array.from({ length: 5 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('')}`

/** Abre o Mês já logado. */
export async function abrirMes(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Contas do mês' })).toBeVisible()
}

/** Lança uma conta avulsa que vence hoje pelo botão "Nova conta". `centavos` é digitado como no celular: 18735 = R$ 187,35. */
export async function lancarConta(page: Page, descricao: string, centavos: string) {
  await page.getByRole('button', { name: 'Nova conta' }).first().click()
  const form = page.getByRole('dialog', { name: 'Nova conta' })
  await form.getByLabel('Valor').pressSequentially(centavos)
  await form.getByLabel('Descrição').fill(descricao)
  await form.getByRole('button', { name: 'Adicionar conta' }).click()
  await expect(form).toBeHidden()
}
