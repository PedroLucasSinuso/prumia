import createClient from 'openapi-fetch'

import type { paths } from './schema'

// Cliente HTTP tipado a partir do openapi.yaml (src/api/schema.d.ts, gerado por `npm run generate:api`).
// Rotas, parâmetros e respostas são checados pelo TypeScript: contrato mudou, o build quebra.
// O cookie de sessão é httpOnly e vai junto automaticamente (same-origin via /api).
// `fetch` resolvido a cada chamada (e não guardado na criação): a demonstração troca o fetch global antes de o app rodar.
export const api = createClient<paths>({ baseUrl: '/api', fetch: (req) => globalThis.fetch(req) })
