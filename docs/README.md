# Documentação do prumia

| Pasta | Para quem | Conteúdo |
|---|---|---|
| `product/` (**local, não versionado**) | quem decide o produto | `spec.md` (o que o app faz) e `plan.md` (fases e status) |
| [developer-guide/](developer-guide/README.md) | quem constrói e mantém | arquitetura, modelo de dados, convenções, como rodar, deploy, backup |
| [user-guides/](user-guides/README.md) | quem usa o app (você e a noiva, futuros membros) | passo a passo em pt-BR, por tarefa |
| [roadmap.md](roadmap.md) | quem decide o que vem a seguir | o que falta, próximos passos e planos futuros |
| [brand/](brand/) | design e front-end | [manual de identidade](brand/manual-identidade-prumia.md) e assets |

## Site de documentação

`site/` (Astro + Starlight) publica os guias de uso e os guias técnicos como um site com busca, modo escuro e a marca do app.
A fonte continua aqui: `site/scripts/sync-docs.mjs` gera as páginas a partir destes Markdown a cada build (título do `# ...`,
links `.md` viram rotas; links para fora de `user-guides/` e `developer-guide/` viram texto, porque o site é público). O CI
(job `site`) falha com link interno quebrado. Local: `make site-dev` (http://localhost:4321) e `make site-build`. Publicação:
Cloudflare Pages (ver [plano-docs-onboarding.md](plano-docs-onboarding.md)). **Nada de dado pessoal nos guias**: eles são públicos.

Fora desta pasta: [CLAUDE.md](../CLAUDE.md) (contexto para o Claude Code) e [openapi/openapi.yaml](../openapi/openapi.yaml) (contrato da API, fonte de verdade).

## O que é versionado

Versionados: código (`api/`, `web/`), `openapi/`, `deploy/`, `scripts/`, `docs/user-guides`, `docs/developer-guide`, `docs/brand`,
`CLAUDE.md` e `.claude/settings.json` com os hooks. **Não versionado**: `docs/product/` (spec e plano, trabalho interno), `.env*`,
`.claude/settings.local.json` e dados/backups locais (ver `.gitignore`). Como `docs/product/` não vai para o GitHub, ele não tem
backup remoto: mantenha cópia fora da máquina.

## Regras

- **Uma fonte de verdade por assunto.** A migration vence o `schema.md`; o `openapi.yaml` vence qualquer descrição de endpoint em texto.
  Não duplique: linke.
- **Documentação anda com o código.** Toda tarefa do `plan.md` só termina com guides atualizados (ver "Definição de pronto").
- Nomes de arquivo em `kebab-case`, um assunto por arquivo, começando com um título e uma frase do que o arquivo responde.
- Idioma: pt-BR. Termos técnicos e identificadores de código ficam no original.
