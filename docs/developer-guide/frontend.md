# Frontend

Responde: como o front está montado, como fala com a API e como aplicar a marca.

## Stack

React 19 + Vite + TypeScript 5.9 + Tailwind 4. Lint com **oxlint**, testes com **Vitest** + Testing Library (jsdom).
Mobile-first: escreva o estilo para celular e use os breakpoints do Tailwind (`sm:`, `md:`, `lg:`) para expandir.

> TypeScript está fixado na linha 5.x porque `openapi-typescript` ainda não declara suporte ao 6. Ao subir de versão,
> confira esse peer antes.

## Estrutura (`web/`)

```
src/
├── api/
│   ├── schema.d.ts   tipos gerados do openapi.yaml (não editar; versionado)
│   └── client.ts     cliente HTTP tipado (openapi-fetch)
├── auth/             sessão: contexto (AuthContext), hook useAuth, proteção de rotas, mensagens de erro
├── components/       peças da marca (Field, Button, FormError, AuthLayout)
├── pages/            telas (LoginPage, RegisterPage, HomePage)
├── lib/              utilitários puros (ex.: money.ts)
├── test/setup.ts     configuração dos testes
├── App.tsx           rotas (react-router)
└── index.css         Tailwind + tokens da marca
```

## Falando com a API

O cliente `api` é tipado pelo contrato: rotas, parâmetros e respostas são checados pelo TypeScript.

```ts
const { data, error, response } = await api.GET('/healthz')
```

Mudou o `openapi.yaml`? Rode `make generate` (regenera `schema.d.ts` e o código Go; `make web-types` regenera só o do front). Se o contrato mudar de um jeito que quebra o uso, o
`npm run typecheck` aponta o lugar. O cookie de sessão é httpOnly e vai junto sozinho porque o front e a API ficam na mesma
origem (`/api`): em desenvolvimento pelo proxy do Vite, em produção pelo nginx.

## Sessão e rotas

O `AuthProvider` pergunta `GET /auth/me` ao abrir o app: 200 = logado, 401 = anônimo (o cookie é httpOnly, o JavaScript
nunca o vê). `useAuth()` expõe `session`, `login`, `register` e `logout`. `RequireAuth` protege as rotas (sem sessão manda
para `/entrar`, lembrando o destino) e `RedirectIfAuthenticated` tira quem já entrou das telas de entrada.

Erros da API chegam como `problem+json` com um `code` estável; `auth/errors.ts` traduz os códigos para pt-BR. O front
**não** mostra mensagem crua do servidor em erros inesperados. Erros por campo (`fields`) aparecem no campo certo e somem
quando a pessoa volta a editá-lo.

O `tsconfig` usa `strict: true`: sem isso o TypeScript não estreita uniões como `ActionResult` (`ok: true | false`).

## Marca no código

Os tokens estão em `src/index.css` (`@theme`) e viram classes do Tailwind:

| Token | Classe | Uso |
|---|---|---|
| `#F3EBDD` ivory | `bg-ivory` | fundo (≈60%) |
| `#203D40` teal | `bg-teal` / `text-teal` | estrutura: topo, menus, painéis |
| `#313638` graphite | `text-graphite` | texto e bordas |
| `#416A91` cobalt | `text-cobalt` | acento: seleção, dados ativos |
| `#F06B4F` signal | `text-signal` | alertas (raro, nunca inundar) |

Regras (manual de identidade): sem gradientes nem `rounded-full`; raio de 4–6px (`rounded-sm`/`rounded-md`); bordas finas
`border-graphite/15`; números com `tabular-nums` (já global) e `font-mono` nos saldos; textos em pt-BR; marca sempre
minúscula. Status com os marcadores `[ ▪ ]`, `[ ▫ ]`, `[ ✖ ]`.

O `public/favicon.svg` é um **placeholder**; falta o símbolo oficial.

## Dinheiro e datas

Dinheiro chega e sai como **inteiro em centavos**, igual ao backend. Formate só na exibição (`lib/money.ts`). Datas de calendário
são strings `AAAA-MM-DD` (sem fuso); nunca converta para `Date` do JavaScript sem cuidado, porque o fuso pode mudar o dia.

## Comandos

| Comando | O que faz |
|---|---|
| `make web-install` | instala dependências (`npm ci`) |
| `make web-dev` | servidor de desenvolvimento, com proxy `/api` para `localhost:8080` (`API_URL` muda o destino) |
| `make web-test` | lint, typecheck e testes |
| `make web-build` | build de produção em `web/dist` |
| `make web-types` | regenera os tipos a partir do OpenAPI |
