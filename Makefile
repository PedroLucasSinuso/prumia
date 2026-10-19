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

.PHONY: ps
ps: ## Estado dos containers
	$(COMPOSE) ps
