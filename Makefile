.DEFAULT_GOAL := help
API := api
WEB := web

.PHONY: help
help: ## Lista os comandos
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  %-14s %s\n", $$1, $$2}'

.PHONY: test
test: ## Roda os testes do backend (integração precisa de Docker; sem Docker, são pulados)
	cd $(API) && go test ./...

.PHONY: test-short
test-short: ## Só testes unitários (sem Docker)
	cd $(API) && go test -short ./...

.PHONY: fmt
fmt: ## Formata o código Go
	cd $(API) && gofmt -w .

.PHONY: lint
lint: ## gofmt (verificação) + go vet + valida o OpenAPI + código gerado em dia
	@cd $(API) && test -z "$$(gofmt -l .)" || (echo "arquivos sem gofmt:"; gofmt -l .; exit 1)
	cd $(API) && go vet ./...
	@! npx --yes @redocly/cli@1 lint openapi/openapi.yaml --format=stylish 2>&1 | grep -E "error\s"
	$(MAKE) check-generated

.PHONY: generate
generate: ## Regenera o código Go e os tipos TypeScript a partir do openapi.yaml
	cd $(API) && go tool oapi-codegen -config oapi-codegen.yaml ../openapi/openapi.yaml
	cd $(WEB) && npm run --silent generate:api >/dev/null

.PHONY: check-generated
check-generated: ## Falha se o código gerado estiver desatualizado em relação ao openapi.yaml
	@a=$$(mktemp); b=$$(mktemp); cp $(API)/internal/api/gen/api.gen.go $$a; cp $(WEB)/src/api/schema.d.ts $$b; \
	$(MAKE) --no-print-directory generate >/dev/null; \
	if diff -q $$a $(API)/internal/api/gen/api.gen.go >/dev/null && diff -q $$b $(WEB)/src/api/schema.d.ts >/dev/null; \
	then rm -f $$a $$b; echo "código gerado em dia"; \
	else rm -f $$a $$b; echo "código gerado estava desatualizado (já regenerado): commite o resultado"; exit 1; fi

.PHONY: tidy
tidy: ## Ajusta o go.mod
	cd $(API) && go mod tidy

.PHONY: run
run: ## Sobe a API local (precisa de DATABASE_URL)
	cd $(API) && go run ./cmd/api

.PHONY: migrate
migrate: ## Aplica as migrations (precisa de DATABASE_URL)
	cd $(API) && go run ./cmd/api migrate

.PHONY: web-install
web-install: ## Instala as dependências do front
	cd $(WEB) && npm ci

.PHONY: web-test
web-test: ## Lint, typecheck e testes do front
	cd $(WEB) && npm run lint && npm run typecheck && npm test

.PHONY: web-build
web-build: ## Build de produção do front
	cd $(WEB) && npm run build

.PHONY: web-dev
web-dev: ## Sobe o front em desenvolvimento (proxy /api -> localhost:8080)
	cd $(WEB) && npm run dev

.PHONY: site-dev
site-dev: ## Sobe o site de documentação em desenvolvimento (http://localhost:4321; gera as páginas a partir de docs/)
	cd site && npm ci --silent && npm run dev

.PHONY: site-build
site-build: ## Build do site de documentação (falha com link interno quebrado)
	cd site && npm ci --silent && npm run build

.PHONY: web-types
web-types: ## Regenera os tipos TypeScript a partir do openapi.yaml
	cd $(WEB) && npm run generate:api

.PHONY: hooks-test
hooks-test: ## Testa os hooks do Claude Code (guard de Git)
	python3 -I .claude/hooks/test_git_guard.py

COMPOSE := docker compose --env-file .env -f deploy/compose.yaml

.env:
	@cp .env.example .env
	@pw=$$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24); \
	 sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$$pw/" .env
	@echo ".env criado com senha aleatória do banco"

.PHONY: env
env: .env ## Cria o .env (com senha aleatória) se ainda não existir

.PHONY: up
up: .env ## Sobe o app completo (db, api, web) e mostra o endereço
	$(COMPOSE) up -d --build
	@echo "prumia no ar: http://localhost:$$(grep -E '^WEB_PORT=' .env | cut -d= -f2)"

.PHONY: down
down: ## Para o app (os dados do banco são mantidos)
	$(COMPOSE) down

.PHONY: logs
logs: ## Acompanha os logs
	$(COMPOSE) logs -f --tail=100

.PHONY: db-expose
db-expose: .env ## Publica o Postgres em 127.0.0.1:DB_PORT (padrão 5433) para o DBeaver
	$(COMPOSE) -f deploy/compose.dbeaver.yaml up -d db
	@echo "Postgres em 127.0.0.1:$$(grep -E '^DB_PORT=' .env | cut -d= -f2 | grep . || echo 5433) (senha: POSTGRES_PASSWORD do .env). Feche com make db-hide"

.PHONY: db-hide
db-hide: .env ## Volta o Postgres a ficar só na rede interna do compose
	$(COMPOSE) up -d db

.PHONY: tunnel-setup
tunnel-setup: .env ## Cria o Cloudflare Tunnel (uma vez; exige TUNNEL_HOSTNAME no .env e o domínio ativo na Cloudflare)
	@scripts/tunnel-setup.sh

.PHONY: tunnel-up
tunnel-up: .env ## Liga o Cloudflare Tunnel (depois do make tunnel-setup; app público via domínio)
	@test -f .cloudflared/config.yml || { echo "Rode make tunnel-setup antes"; exit 1; }
	TUNNEL_UID=$$(id -u) TUNNEL_GID=$$(id -g) $(COMPOSE) -f deploy/compose.tunnel.yaml up -d

.PHONY: tunnel-down
tunnel-down: .env ## Desliga o Cloudflare Tunnel (o app volta a ficar só em localhost)
	$(COMPOSE) -f deploy/compose.tunnel.yaml stop cloudflared
	$(COMPOSE) -f deploy/compose.tunnel.yaml rm -f cloudflared

.PHONY: tailscale-up
tailscale-up: ## Publica o app no tailnet com HTTPS (tailscale serve -> 127.0.0.1:WEB_PORT)
	@scripts/tailscale-serve.sh up

.PHONY: tailscale-status
tailscale-status: ## Mostra o que o tailscale serve está publicando e o endereço
	@scripts/tailscale-serve.sh status

.PHONY: ps
ps: ## Estado dos containers
	$(COMPOSE) ps

# Backup e restore: ver docs/developer-guide/backup-restore.md. Os scripts leem o .env e falam com o container db.
.PHONY: backup
backup: ## Gera um backup do banco em backups/ (rotação: mantém os 14 mais recentes)
	@scripts/backup.sh

.PHONY: restore
restore: ## Restaura um backup: make restore FILE=backups/prumia-....dump [TARGET=outro_banco]
	@test -n "$(FILE)" || { echo "uso: make restore FILE=backups/prumia-AAAAMMDD-HHMMSS.dump [TARGET=outro_banco]"; exit 2; }
	@scripts/restore.sh $(if $(TARGET),--target "$(TARGET)") "$(FILE)"

.PHONY: test-restore
test-restore: ## Testa o restore num banco temporário e compara com o banco real [FILE=... para um backup específico]
	@scripts/test-restore.sh $(FILE)
