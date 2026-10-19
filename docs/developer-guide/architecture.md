# Arquitetura do backend

Responde: como o código Go está organizado e como o contrato OpenAPI vira código.

## Visão geral

Um único binário Go (**modular monolith**), organizado em pacotes por domínio. Sem microsserviços e sem framework próprio.

```
api/
├── cmd/api/                 ponto de entrada: lê config, abre o banco, monta rotas, sobe o servidor
├── migrations/              SQL versionado (goose), embutido no binário
├── oapi-codegen.yaml        configuração do gerador de código
└── internal/
    ├── api/                 liga o contrato às implementações
    │   ├── gen/             CÓDIGO GERADO do openapi.yaml (não editar)
    │   ├── server.go        Server: implementa as operações já prontas
    │   └── unimplemented.go stubs 501 das operações ainda sem módulo
    ├── platform/            infraestrutura compartilhada, sem regra de negócio
    │   ├── config/          variáveis de ambiente
    │   ├── db/              conexão GORM e migrations
    │   ├── dbtest/          Postgres descartável (Docker) para testes
    │   ├── httpx/           roteador base, erro problem+json
    │   ├── caldate/         data de calendário sem fuso
    │   ├── money/           dinheiro em centavos
    │   └── id/              UUIDv7
    └── <domínio>/           (a criar) household, auth, invoice, income, category, boleto, summary
```

Cada domínio terá `handler` (HTTP), `service` (regras) e `repository` (banco). Dependência sempre no sentido
handler → service → repository. Interface só onde há teste ou troca real.

## Do contrato ao código

O `openapi/openapi.yaml` é a fonte de verdade da API. Fluxo para mudar ou criar um endpoint:

1. Edite `openapi/openapi.yaml`.
2. `make generate` regenera `internal/api/gen/api.gen.go` (tipos de request/response e a interface `ServerInterface`)
   **e** `web/src/api/schema.d.ts` (tipos do front).
3. O build quebra em `internal/api` até a nova operação ser tratada: implemente-a no `Server` (ou em um módulo de domínio).
4. `make lint` valida o OpenAPI e **falha se o código gerado estiver desatualizado** (`make check-generated`).

Os arquivos gerados são versionados, para quem clona não precisar gerar nada.

### Tipos do domínio no contrato
O gerador mapeia (em `oapi-codegen.yaml`) `format: date` para `caldate.Date` e `format: int64` para `money.Cents`.
Os handlers recebem os tipos do domínio direto, sem conversão manual. Por isso `int64` no contrato é reservado para
dinheiro em centavos; para outros inteiros grandes, use outro `format`.

### Operações ainda sem implementação
`Server` embute `Unimplemented`, que responde **501** (`problem+json`, `code: not_implemented`) em tudo. Para implementar uma
operação, defina o método no `Server` (ou no módulo): o método do tipo externo sobrescreve o embutido. Ao terminar um
módulo, apague os stubs correspondentes de `unimplemented.go`.

## Convenções de runtime

- **Erros**: sempre `application/problem+json` (`httpx.Problem`), com `code` estável para o front. Erros internos nunca
  expõem detalhes ao cliente; vão para o log. Parâmetros inválidos na URL (ex.: UUID malformado) viram `400 bad_request`
  pelo código gerado.
- **Log**: `slog` em JSON. O log de acesso não grava query string nem corpo (podem ter tokens e dados sensíveis).
- **Configuração**: só variáveis de ambiente (`.env.example`); falha na partida com todos os problemas listados.
- **Desligamento**: `SIGTERM`/Ctrl+C encerra as requisições em andamento (até 10 s) antes de sair.
- **Migrations**: `api migrate` aplica as pendentes; **não existe AutoMigrate**. Ver [schema.md](schema.md).

## Testes

- Unitários nos pacotes `platform/*` e nas regras de negócio.
- Integração com **Postgres real** via `dbtest.New(t)` (testcontainers): sobe um container por teste e o descarta.
  Sem Docker o teste é **pulado**, não falha.
- `make test` roda tudo; `make test-short` pula o que precisa de Docker (use `-short` nos testes pesados).

## Comandos

| Comando | O que faz |
|---|---|
| `make test` | testes do backend |
| `make lint` | gofmt, go vet, lint do OpenAPI e código gerado em dia |
| `make generate` | regenera o código Go e os tipos TypeScript a partir do OpenAPI |
| `make migrate` | aplica migrations (exige `DATABASE_URL`) |
| `make run` | sobe a API local (exige `DATABASE_URL`) |
