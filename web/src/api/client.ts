import createClient from 'openapi-fetch'

import { noteResponse } from '../lib/offline'
import type { paths } from './schema'

// Cliente HTTP tipado a partir do openapi.yaml (src/api/schema.d.ts, gerado por `npm run generate:api`).
// Rotas, parâmetros e respostas são checados pelo TypeScript: contrato mudou, o build quebra.
// O cookie de sessão é httpOnly e vai junto automaticamente (same-origin via /api).
// Cada resposta passa por noteResponse: é como a tela descobre que está vendo dados guardados (lib/offline.ts).
// `fetch` resolvido a cada chamada (e não guardado na criação): a demonstração troca o fetch global antes de o app rodar.
export const api = createClient<paths>({ baseUrl: '/api', fetch: async (req) => {
    const res = await globalThis.fetch(req)
    noteResponse(res, req.method)
    return res
  },
})
