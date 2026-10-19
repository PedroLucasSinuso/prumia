# Developer guide

Guia de quem constrói e mantém o prumia. Leia na ordem se for novo no projeto.

| Documento | Status | Responde |
|---|---|---|
| [schema.md](schema.md) | pronto | Por que o banco é assim; convenções de dados |
| [architecture.md](architecture.md) | pronto | Camadas, pacotes por domínio, geração de código a partir do OpenAPI |
| [frontend.md](frontend.md) | pronto | Stack do front, cliente tipado da API, marca no código |
| getting-started.md | Fase 0 | Como subir o projeto e rodar os testes |
| conventions.md | Fase 0 | Go para quem vem de PHP, erros, testes, nomenclatura, regras do GORM |
| authentication.md | Fase 1 | Sessão, convites, roles, autorização por casa |
| series-generation.md | Fase 1 | Como parcelas e recorrências são geradas e estendidas |
| incomes-and-wallets.md | Fase 2 | Previsão, descontos, carteiras e saldos |
| boleto-extraction.md | Fase 3 | Cascata de extração, validação e limites |
| deployment.md | Fase 4 | Compose, nginx, Tailscale, VPS |
| backup-restore.md | Fase 4 | Backup diário e restore testado |
| security.md | Fase 4 | Modelo de ameaças e checklist |

Docs marcados com uma fase ainda não existem: são criados junto com a funcionalidade.

Referências: spec e plano (locais, em `docs/product/`, fora do git) · [OpenAPI](../../openapi/openapi.yaml) · [CLAUDE.md](../../CLAUDE.md)
