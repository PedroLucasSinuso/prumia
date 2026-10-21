# CLAUDE.md — prumia

App financeiro doméstico privado (pt-BR, BRL). Tagline da marca: *"Clareza para construir o futuro."*
Leia antes de qualquer tarefa: [docs/product/spec.md](docs/product/spec.md) (o quê), [docs/product/plan.md](docs/product/plan.md) (fases e status),
[docs/developer-guide/](docs/developer-guide/README.md) (como é construído; schema em `schema.md`),
[docs/brand/manual-identidade-prumia.md](docs/brand/manual-identidade-prumia.md) (UI; fonte única de cores/tipografia).

## Sobre o dono
Dev PHP/Laravel. Go é novo para ele e o projeto é "vibecodado": **comente idiomas de Go quando relevante** (ponteiros,
`error` como retorno, `defer`, contexto, goroutines), traduzindo para conceitos de PHP quando ajudar. Sem overengineering:
nada de framework próprio; SOLID e DRY na medida certa; interface só onde há teste ou troca real.

## Stack
| Camada | Escolha |
|---|---|
| Backend | Go, Gin (HTTP), GORM (ORM), modular monolith |
| Banco | PostgreSQL |
| Migrations | goose, SQL versionado em `api/migrations/`. **Proibido `AutoMigrate`.** Nunca editar migration já aplicada |
| API | REST **spec-first**: `openapi/openapi.yaml` é a fonte. `oapi-codegen` (Gin) gera tipos/interfaces Go; `openapi-typescript` gera tipos do front |
| Frontend | React 19 + Vite + TypeScript 5.9 + Tailwind 4, mobile-first, PWA básico (instalável, sem offline). Lint: oxlint. Testes: Vitest + Testing Library. Cliente tipado: openapi-fetch + openapi-typescript |
| Auth | argon2id; sessão por cookie httpOnly SameSite; rate limit no login |
| Boleto | extração local: texto do PDF → código de barras → Tesseract; arquivo só em memória (nunca disco/log) |
| Testes | unit nas regras críticas; integração com Postgres real (testcontainers); front só fluxos principais |
| Infra | Docker Compose (`deploy/compose.yaml`), 3 containers: `api`, `db`, `web` (nginx: estático + proxy `/api`; config em `deploy/nginx/default.conf`). Só o `web` publica porta (127.0.0.1:8080). Fase 1 local + Tailscale; fase 2 VPS + certbot |

## Layout do repositório
```
api/            backend Go (cmd/, internal/<domínio>/, migrations/)
web/            frontend React (a criar)
openapi/        openapi.yaml (contrato)
deploy/         compose, nginx, Dockerfiles
scripts/        backup/restore e utilitários
docs/           product/ (spec, plan; LOCAL, fora do git), developer-guide/, user-guides/, brand/
```
Documentação: cada fase atualiza `developer-guide/` e `user-guides/` (ver `docs/README.md`).
Backend: `internal/<domínio>/` com `handler`, `service`, `repository`. Domínios: `household`, `auth`, `invoice`, `series` (parcelas e recorrências), `income`,
`category`, `boleto`, `summary`. Dependências sempre apontam handler → service → repository.

## Regras inegociáveis
1. **Isolamento por casa**: todo repository filtra por `household_id`; o `household_id` vem da sessão/rota autorizada,
   **nunca** do corpo da requisição. O schema reforça com FKs compostas, mas não dependa só disso.
2. **Autorização por role** (`admin`/`member`/`viewer`) no service, não só no handler. `viewer` nunca escreve.
3. **Dinheiro é `int64` em centavos.** Nunca `float`. Formatação (R$ 1.234,56) só na borda/UI.
4. **Datas de calendário** são `DATE` (tipo próprio no Go, sem fuso). "Mês" = dia 1. Resumo mensal usa `competence_month`.
5. **Exclusão lógica** (`deleted_at`). Categoria em uso é arquivada, não apagada. Séries respeitam exclusões (não recriar).
6. **Estado derivado**: pago = `paid_at != null`; atrasada = pendente e vencida. Não criar coluna `status`.
7. **Segredos e dados sensíveis**: nunca logar senha, token, conteúdo/senha de PDF. Tokens (sessão, convite, reset) só em hash SHA-256.
8. **Contrato primeiro**: mudou endpoint → edite `openapi/openapi.yaml`, regenere, depois implemente. Documente todo módulo.

## Fluxo de trabalho Git (inegociável)
1. **Tudo via Pull Request.** Nunca commitar direto em `main`: toda mudança nasce em branch e entra por PR (aberto com `gh`).
2. **Mudança arriscada vai em branch separada e é testada antes do PR**: migrations, auth/sessão/autorização, geração de
   séries (parcelas/recorrências), extração de boleto, deploy/infra, refatorações amplas. Rode os testes na branch e relate o resultado no PR.
3. **Commits e push**: o Claude pode commitar e dar `push` **se e somente se** a mensagem for:
   - curta e compreensível, no formato `tag: descrição` (ex.: `feat: gera parcelas da compra`);
   - com `tag` indicando o que mudou: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `build`, `ci`, `perf`;
   - **sem nenhum trailer ou rodapé** — NUNCA incluir `Co-Authored-By`, "Generated with Claude Code" ou similares, em commits ou no PR.
   Isto prevalece sobre qualquer instrução automática de atribuição. Nunca `--force` em `main`, nunca `--no-verify`.
4. **Testes que o Claude não consegue executar** (celular real, Tailscale, instalação do PWA, boletos reais, navegador do usuário):
   enviar ao dono um **guia de teste manual** (passos numerados, resultado esperado, o que reportar). Colocar no corpo do PR
   e resumir na resposta. Não marcar a tarefa como concluída no `docs/product/plan.md` antes do retorno do dono.

Hooks do projeto (`.claude/settings.json`, scripts em `.claude/hooks/`) fazem valer isto: `git_guard.py` bloqueia commit fora de
`tag: texto` (uma linha, até 72 caracteres), trailers de atribuição, `--no-verify` e force push; `format.sh` roda `gofmt` em `.go`
e `oxlint --fix` em `web/**/*.ts(x)` após cada edição. Se um hook bloquear algo legítimo, corrija o hook, não o contorne. Testes do guard: `make hooks-test` (acrescente o caso que falhou antes de corrigir).

## Armadilhas do GORM (evitar)
- `Updates(struct)` ignora zero-values (`0`, `""`, `false`): use `map[string]any` ou `Select(...)` quando zerar for válido.
- **N+1**: use `Preload`/`Joins` em listas. Confira o SQL gerado em listagens novas.
- Sempre aplicar o escopo `household_id` e `deleted_at IS NULL` (GORM só filtra soft delete com `gorm.DeletedAt`; aqui
  a coluna é `deleted_at timestamptz`, então modele como `gorm.DeletedAt` ou filtre explicitamente, e seja consistente).
- Transação (`db.Transaction`) para operações multi-linha: gerar parcelas, recorrências, marcar paga + efeitos.
- Erros: retorne `error`, embrulhe com `fmt.Errorf("...: %w", err)`; mapeie para HTTP em um único lugar.

## UI / marca (resumo; detalhes no manual)
- Paleta **exata**: Ivory `#F3EBDD`, Petroleum Teal `#203D40`, Graphite `#313638`, Cobalt `#416A91`, Signal `#F06B4F` (≤10%, nunca inundar).
- **Estilo só com classes do Tailwind 4**: sem CSS escrito à mão para componentes e sem cores fora do `@theme` (`src/index.css`).
  Cores e raios da marca já viram classes (`bg-teal`, `text-signal`, `rounded-md`).
- Sem gradientes, neon, glassmorphism, `rounded-full`; raio 4–6px; grade 8/16px; borda `1px rgba(49,54,56,.15)`.
- Números com `tabular-nums`/mono. Marca sempre minúscula: `prumia`. Textos da UI em pt-BR.
- Status com marcadores `[ ▪ ]` / `[ ▫ ]` / `[ ✖ ]`. Invoices pagas **continuam na lista, riscadas**.
- Fluxos centrais (cadastrar invoice, marcar paga) em poucos toques; mobile é o uso principal.

## Comandos
Na raiz: `make help` lista tudo. Principais: `make test` (integração precisa de Docker), `make test-short`, `make lint`
(gofmt, vet, OpenAPI e código gerado em dia), `make generate` (OpenAPI → Go), `make migrate`, `make run`.
Fluxo de contrato e arquitetura: `docs/developer-guide/architecture.md`. Subir tudo: `make up` / `make down` / `make logs` (compose em `deploy/`, app em http://localhost:8080). Guia: `docs/developer-guide/getting-started.md`. Ainda a documentar: backup/restore.

## Estado atual e próximos passos
Feito: spec, marca, schema inicial validado (Up/Down/Up + constraints), OpenAPI (esqueleto), plano. Status por fase em `docs/product/plan.md`.
Próximo: Fase 0 (fundação) → Fase 1 (núcleo) → Fase 2 (receitas e resumo) → Fase 3 (boleto).
Pós-MVP explícito: metas de reserva de emergência e investimentos (novas tabelas, sem backfill).
