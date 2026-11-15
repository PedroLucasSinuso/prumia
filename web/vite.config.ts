import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

/**
 * Gera `precache.json`: a lista do código de todas as telas (JS, CSS) e das fontes do build. O app a lê depois de abrir
 * (src/lib/warmup.ts) e baixa o que falta, para que telas nunca visitadas também abram sem conexão. Sem os .woff: são só
 * a alternativa para navegadores antigos, que nem têm service worker.
 */
function precacheManifest(): Plugin {
  return {
    name: 'prumia-precache',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((name) => /\.(js|css|woff2)$/.test(name))
        .sort()
        .map((name) => `/${name}`)
      this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify({ files }) })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // Demonstração (`npm run build:demo`): o mesmo app, servido em /demo/ do site, com a API falsa em memória (src/demo).
  ...(mode === 'demo' ? { base: '/demo/', build: { outDir: 'dist-demo' } } : {}),
  plugins: [react(), tailwindcss(), ...(mode === 'demo' ? [] : [precacheManifest()])],
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
