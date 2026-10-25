// Roteador mínimo da API falsa da demonstração: casa método + caminho ("/households/{householdId}/invoices") e devolve
// Response como o servidor de verdade (JSON, problem+json nos erros). Nada sai do navegador.

export type Ctx = {
  params: Record<string, string>
  query: URLSearchParams
  body: unknown
}
type Handler = (ctx: Ctx) => Response | Promise<Response>
type Route = { method: string; re: RegExp; keys: string[]; handler: Handler }

const routes: Route[] = []

export function on(method: string, path: string, handler: Handler) {
  const keys: string[] = []
  const re = new RegExp('^' + path.replace(/\{(\w+)\}/g, (_, k: string) => { keys.push(k); return '([^/]+)' }) + '$')
  routes.push({ method, re, keys, handler })
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

export const empty = (status = 204) => new Response(null, { status })

export function problem(status: number, code: string, fields?: Record<string, string>) {
  return new Response(JSON.stringify({ title: code, status, code, ...(fields ? { fields } : {}) }), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  })
}

export const invalid = (fields: Record<string, string>) => problem(400, 'validation_error', fields)
export const notFound = () => problem(404, 'not_found')
/** O que só funciona no app de verdade (convites, senha, leitura de documentos). */
export const unavailable = () => problem(422, 'demo_unavailable')

/** Atende uma requisição para /api/...; rota que a demonstração não tem responde `demo_unavailable`. */
export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname.replace(/^.*?\/api(?=\/)/, '')
  let body: unknown
  const type = req.headers.get('Content-Type') ?? ''
  if (req.method !== 'GET' && req.method !== 'HEAD' && type.includes('application/json')) {
    const text = await req.text()
    body = text ? JSON.parse(text) : undefined
  }
  for (const r of routes) {
    if (r.method !== req.method) continue
    const m = path.match(r.re)
    if (!m) continue
    const params: Record<string, string> = {}
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])))
    return r.handler({ params, query: url.searchParams, body })
  }
  return unavailable()
}
