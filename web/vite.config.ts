import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // Demonstração (`npm run build:demo`): o mesmo app, servido em /demo/ do site, com a API falsa em memória (src/demo).
  ...(mode === 'demo' ? { base: '/demo/', build: { outDir: 'dist-demo' } } : {}),
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    // Em desenvolvimento, /api vai para a API Go local (em produção quem faz isso é o nginx).
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:8080', changeOrigin: false } },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    testTimeout: 15000,
    setupFiles: ['./src/test/setup.ts'],
  },
}))
