# Developer guide

Guia de quem constrói e mantém o prumia. Leia na ordem se for novo no projeto.

| Documento | Status | Responde |
|---|---|---|
| [schema.md](schema.md) | pronto | Por que o banco é assim; convenções de dados |
| [architecture.md](architecture.md) | pronto | Camadas, pacotes por domínio, geração de código a partir do OpenAPI |
| [frontend.md](frontend.md) | pronto | Stack do front, cliente tipado da API, marca no código |
| [getting-started.md](getting-started.md) | pronto | Como subir o projeto e rodar os testes |
| conventions.md | Fase 0 | Go para quem vem de PHP, erros, testes, nomenclatura, regras do GORM |
| [invoices.md](invoices.md) | pronto | Categorias e invoices: regras, estados, pagamento, listagem, erros |
| [authentication.md](authentication.md) | pronto (convites: em breve) | Sessão, cadastro, autorização por casa e papel, testes e Postman |
| [series-generation.md](series-generation.md) | pronto | Como parcelas e recorrências são geradas, estendidas, editadas e excluídas |
| [invoices.md](invoices.md) | pronto (séries: Fase 1c) | Categorias e invoices: regras, estados, pagamento, listagem, erros |
| [authentication.md](authentication.md) | pronto | Sessão, cadastro, convites, papéis, redefinição de senha, autorização por casa, testes e Postman |
| series-generation.md | Fase 1 | Como parcelas e recorrências são geradas e estendidas |
| [incomes-and-wallets.md](incomes-and-wallets.md) | pronto | Receitas, descontos, previsão, carteiras, saldos, resumo mensal e aviso de benefício |
| [boleto-extraction.md](boleto-extraction.md) | pronto | Cascata de extração, validação e limites |
| deployment.md | Fase 4 | Compose, nginx, Tailscale, VPS |
| [backup-restore.md](backup-restore.md) | pronto | Backup, rotação, restore (real e em outro banco), teste de restore e agendamento |
| [security.md](security.md) | pronto | Modelo de ameaças, o que é protegido e como, checklist de produção, desempenho medido |

Docs marcados com uma fase ainda não existem: são criados junto com a funcionalidade.

Referências: spec e plano (locais, em `docs/product/`, fora do git) · [OpenAPI](../../openapi/openapi.yaml) · [CLAUDE.md](../../CLAUDE.md)
