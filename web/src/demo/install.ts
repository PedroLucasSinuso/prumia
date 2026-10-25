// Liga a demonstração: troca o `fetch` das chamadas a /api pela API falsa em memória (./routes) e mostra a faixa de aviso.
// Só entra no build de demonstração (VITE_DEMO=1, ver main.tsx); o app de verdade nem carrega este arquivo.
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'

import { DemoBanner } from './DemoBanner'
import { handle } from './http'
import './routes'

const realFetch = globalThis.fetch.bind(globalThis)

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(input, init)
  if (!new URL(req.url, location.href).pathname.includes('/api/')) return realFetch(input, init)
  // Um pequeno atraso para a tela se comportar como com servidor (carregando, desfazer...)
  await new Promise((r) => setTimeout(r, 120))
  return handle(req)
}

const host = document.createElement('div')
document.body.appendChild(host)
createRoot(host).render(createElement(DemoBanner))
