import { defineConfig, devices } from '@playwright/test'

// Testes de ponta a ponta: o app inteiro (nginx + API Go + Postgres) sobe pelo compose num projeto à parte
// (`make e2e-up`, porta 18080, banco próprio e descartável) e o Playwright dirige um navegador de verdade contra ele.
// O projeto "preparo" cria uma conta e uma casa pela tela de cadastro e guarda a sessão (.auth/); os testes a reaproveitam,
// cada um com contas de nome próprio. Assim uma rodada faz poucos cadastros e não esbarra no limite de tentativas da API.
export const SESSAO = '.auth/sessao.json'
export const CONTA = '.auth/conta.json'

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:18080',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'preparo', testMatch: /preparo\.ts/, use: { ...devices['Pixel 7'] } },
    // Celular é o uso principal do prumia.
    { name: 'celular', dependencies: ['preparo'], use: { ...devices['Pixel 7'], storageState: SESSAO } },
  ],
})
