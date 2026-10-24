# Developer guide

Guia de quem constrói e mantém o prumia. Leia na ordem se for novo no projeto.

| Documento | Status | Responde |
|---|---|---|
| [schema.md](schema.md) | pronto | Por que o banco é assim; convenções de dados |
| [architecture.md](architecture.md) | pronto | Camadas, pacotes por domínio, geração de código a partir do OpenAPI |
| [frontend.md](frontend.md) | pronto | Stack do front, cliente tipado da API, marca no código |
| [getting-started.md](getting-started.md) | pronto | Como subir o projeto e rodar os testes |
| conventions.md | a criar | Go para quem vem de PHP, erros, testes, nomenclatura, regras do GORM |
| [invoices.md](invoices.md) | pronto | Categorias e invoices: regras, estados, pagamento, listagem, erros |
| [series-generation.md](series-generation.md) | pronto | Como parcelas e recorrências são geradas, estendidas, editadas e excluídas |
| [authentication.md](authentication.md) | pronto | Sessão, cadastro, convites, papéis, redefinição de senha, autorização por casa, testes e Postman |
| [incomes-and-wallets.md](incomes-and-wallets.md) | pronto | Receitas, descontos, previsão, carteiras configuráveis, saldos (com saldo anterior), transferências entre carteiras, resumo mensal e aviso de saldo |
| [boleto-extraction.md](boleto-extraction.md) | pronto | Cascata de extração, validação e limites |
| [deployment.md](deployment.md) | pronto (VPS: fase 2) | Compose, nginx, Tailscale com HTTPS, HSTS, produção x desenvolvimento |
| [backup-restore.md](backup-restore.md) | pronto | Backup, rotação, restore (real e em outro banco), teste de restore e agendamento |
| [security.md](security.md) | pronto | Modelo de ameaças, o que é protegido e como, checklist de produção, desempenho medido |

Docs marcados com uma fase ainda não existem: são criados junto com a funcionalidade.

Referências: spec e plano (locais, em `docs/product/`, fora do git) · [OpenAPI](../../openapi/openapi.yaml) · [CLAUDE.md](../../CLAUDE.md)
