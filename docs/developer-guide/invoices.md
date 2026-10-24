# Categorias e invoices

Responde: como funcionam as despesas no backend (regras, estados, erros) e como estender.

## Regras de negócio

**Estado derivado.** A invoice não tem coluna `status`. O serviço calcula com o "hoje" do fuso da aplicação:
`paid` se há `paid_at`; senão `overdue` se o vencimento é anterior a hoje; senão `pending`.

**Datas.** `dueDate` (vencimento) e `competenceMonth` (mês a que o gasto pertence; dia 1). Sem informar a competência, vale o
mês do vencimento. O resumo mensal e a tela do mês usam a **competência**: uma conta de outubro paga em novembro continua em outubro.

**Dinheiro** em centavos (`int64`). Valor entre 1 centavo e R$ 10 bilhões.

**Pagamento.** `POST .../pay` exige só o `walletId` (carteira **ativa da casa**; ausente, inexistente, de outra casa ou arquivada = 400 no
campo `walletId`); `paidAt` padrão = hoje e `amountCents` padrão = valor da
invoice (informe se houve juros ou desconto: o valor pago pode diferir). O `UPDATE` é **condicional** (`paid_at IS NULL`):
dois toques seguidos, ou duas pessoas ao mesmo tempo, pagam uma vez só e o segundo recebe 409 `already_paid`.
`DELETE .../pay` desfaz (os quatro campos de pagamento voltam a `NULL`). Pagando com uma carteira que tem o aviso de saldo ligado, a resposta pode
trazer `warnings: ["wallet_balance_insufficient"]` e `warningDetails: [{code, walletId}]` (saldo realizado da carteira negativo; não bloqueia):
regra em [incomes-and-wallets.md](incomes-and-wallets.md#7-aviso-de-saldo-insuficiente-ao-pagar). A exportação CSV traz o **nome** da carteira de pagamento.

## PATCH: "ausente" x "null"

Num `PATCH`, campo ausente = não mexer; `null` = limpar (responsável, observação, carteira padrão da categoria). O tipo gerado
(ponteiro) não distingue os dois, então os handlers usam `readPatch`, que lê o corpo uma vez e devolve o conjunto de chaves
presentes. O serviço recebe flags `...Set` junto do valor.

## Erros (`code` em `problem+json`)

| code | HTTP | quando |
|---|---|---|
| `validation_error` | 400 | campo inválido (veja `fields`) |
| `category_exists` | 409 | nome de categoria repetido |
| `category_in_use` | 409 | excluir categoria com invoices, compras ou recorrências |
| `already_paid` / `not_paid` | 409 | pagar o que já está pago / desfazer o que não está |
| `not_deleted` | 409 | restaurar o que não está excluído |
| `category_deleted` | 409 | restaurar invoice cuja categoria foi excluída |
| `series_changed` | 409 | desfazer lote de recorrência que mudou depois (ex.: outro lote mais cedo ainda não desfeito) |

O mapeamento de erro de serviço para HTTP fica **num lugar só**: `internal/api/errors.go`.

## Onde está

- `internal/category`, `internal/invoice`: modelo e serviço (regras e consultas, todas filtradas por `household_id`).
- `internal/series`: compras parceladas e recorrências (geração, horizonte, edição). Ver [series-generation.md](series-generation.md).
- `internal/api/categories.go`, `invoices.go`, `series.go`: handlers (tradução HTTP ↔ serviço).
- Testes: `internal/api/invoices_test.go` e `series_test.go` (fluxo ponta a ponta com Postgres real) e a coleção Postman (pastas 4 a 7).

## Para estender

Nova regra de invoice: validação em `invoice/service.go` (use `validation.Collector` para acumular erros por campo); erro novo de
negócio: declare `Err...` no serviço e mapeie em `api/errors.go`. Toda consulta **deve** filtrar por `household_id`.
