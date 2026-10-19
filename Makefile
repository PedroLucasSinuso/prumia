.DEFAULT_GOAL := help
API := api

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
lint: ## gofmt (verificação) + go vet + valida o OpenAPI
	@cd $(API) && test -z "$$(gofmt -l .)" || (echo "arquivos sem gofmt:"; gofmt -l .; exit 1)
	cd $(API) && go vet ./...
	@! npx --yes @redocly/cli@1 lint openapi/openapi.yaml --format=stylish 2>&1 | grep -E "error\s"

.PHONY: tidy
tidy: ## Ajusta o go.mod
	cd $(API) && go mod tidy

.PHONY: run
run: ## Sobe a API local (precisa de DATABASE_URL)
	cd $(API) && go run ./cmd/api

.PHONY: migrate
migrate: ## Aplica as migrations (precisa de DATABASE_URL)
	cd $(API) && go run ./cmd/api migrate

WEB := web

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
