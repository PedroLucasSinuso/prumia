# Primeiros passos

Responde: como subir o prumia e rodar os testes numa máquina nova.

## Requisitos

Go 1.27, Node 22, Docker com Compose v2 e `make`. (Para o OpenAPI: `npx` baixa o Redocly sob demanda.)

## Subir o app completo

```bash
make up
```

Na primeira vez cria o `.env` (com senha aleatória do banco), constrói as imagens e sobe três containers:

| Container | Papel | Exposição |
|---|---|---|
| `db` | PostgreSQL 16, dados no volume `pgdata` | só rede interna do compose |
| `api` | API Go; aplica as migrations ao subir (`AUTO_MIGRATE=true`) | só rede interna |
| `web` | nginx: serve o front e faz proxy de `/api` para a `api` | `127.0.0.1:8080` |

Abra <http://localhost:8080>. Outros comandos: `make ps`, `make logs`, `make down` (mantém os dados; para apagar o banco,
`docker volume rm prumia_pgdata`).

Mudar porta ou liberar acesso pela rede (ex.: testar no celular): ajuste `WEB_PORT` e `WEB_BIND=0.0.0.0` no `.env` e rode
`make up` de novo. Fora de teste, prefira o acesso por Tailscale (ver [deployment.md](deployment.md), fase 4).

## Desenvolver (sem recompilar imagens)

Use o compose só para o banco? Neste projeto o banco do compose não é publicado no host (evita conflito com um Postgres local).
O caminho simples é subir o app todo com `make up` e, para iterar no front, rodar o Vite com proxy para a API do compose:

```bash
make up                 # db + api + web
make web-install        # uma vez
API_URL=http://localhost:8080 make web-dev   # front com hot reload; /api passa pelo nginx do compose
```

Para iterar no backend, rode os testes (`make test`) e reconstrua a API com `docker compose --env-file .env -f deploy/compose.yaml up -d --build api`.

## Testes e qualidade

| Comando | O que faz |
|---|---|
| `make test` | testes do backend; os de integração sobem Postgres via Docker (testcontainers) |
| `make test-short` | só unitários (sem Docker) |
| `make web-test` | lint, typecheck e testes do front |
| `make lint` | gofmt, vet, OpenAPI e código gerado em dia |
| `make hooks-test` | testes do guard de Git do Claude Code |

## Integração contínua

O GitHub Actions (`.github/workflows/ci.yml`) roda em todo PR e em push para `main`, com quatro jobs independentes.
Um push novo no mesmo PR cancela a execução anterior. Para reproduzir localmente:

| Job | O que roda | Local |
|---|---|---|
| `api` | `make lint` + `make test` (integração com Postgres via testcontainers; instala poppler, Ghostscript e Tesseract para os testes de boleto) | `make web-install && make lint && make test` |
| `web` | `tsc -b`, `oxlint`, `vitest run`, `npm run build` e confere se `src/api/schema.d.ts` está em dia | `make web-install && make web-test && make web-build && make check-generated` |
| `hooks` | testes do guard de Git | `make hooks-test` |
| `docker` | valida o compose e constrói as imagens `api` e `web` (sem push) | `POSTGRES_PASSWORD=x docker compose -p prumia-ci -f deploy/compose.yaml build api web` |

No CI, o job `api` falha se o Docker não estiver disponível (localmente, sem Docker, os testes de integração são só pulados).
No build local, `-p prumia-ci` evita sobrescrever as imagens do `make up`.

## Variáveis de ambiente

Ver `.env.example`. Principais: `POSTGRES_*` (banco), `APP_ENV` (`development`/`production`), `APP_TIMEZONE`,
`WEB_PORT`/`WEB_BIND`. Use só letras e números na senha do banco (ela entra numa URL de conexão).
`AUTO_MIGRATE=true` é definido pelo compose; fora dele, rode `make migrate`.

## Problemas comuns

- **Porta 8080 ocupada**: mude `WEB_PORT` no `.env`.
- **`defina POSTGRES_PASSWORD`**: o `.env` não existe; rode `make env`.
- **Build da API sem rede**: o Go baixa dependências na primeira construção.
