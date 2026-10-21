# Categorias e invoices

Responde: como funcionam as despesas no backend (regras, estados, erros) e como estender.

## Regras de negócio

**Estado derivado.** A invoice não tem coluna `status`. O serviço calcula com o "hoje" do fuso da aplicação:
`paid` se há `paid_at`; senão `overdue` se o vencimento é anterior a hoje; senão `pending`.

**Datas.** `dueDate` (vencimento) e `competenceMonth` (mês a que o gasto pertence; dia 1). Sem informar a competência, vale o
mês do vencimento. O resumo mensal e a tela do mês usam a **competência**: uma conta de outubro paga em novembro continua em outubro.

**Dinheiro** em centavos (`int64`). Valor entre 1 centavo e R$ 10 bilhões.

**Pagamento.** `POST .../pay` exige só a `wallet` (`free` ou `benefit`); `paidAt` padrão = hoje e `amountCents` padrão = valor da
invoice (informe se houve juros ou desconto: o valor pago pode diferir). O `UPDATE` é **condicional** (`paid_at IS NULL`):
dois toques seguidos, ou duas pessoas ao mesmo tempo, pagam uma vez só e o segundo recebe 409 `already_paid`.
`DELETE .../pay` desfaz (os quatro campos de pagamento voltam a `NULL`). Pagando com `benefit`, a resposta pode trazer
`warnings: ["benefit_balance_insufficient"]` (saldo estimado do benefício negativo; não bloqueia): regra em
[incomes-and-wallets.md](incomes-and-wallets.md#7-aviso-de-saldo-de-benefício-ao-pagar).

**Exclusão lógica.** `DELETE` marca `deleted_at`; `POST .../restore` desfaz. Restaurar uma invoice cuja categoria foi excluída
nesse meio tempo dá 409 `category_deleted`.

**Referências.** A categoria precisa ser da casa e não estar arquivada; o responsável precisa ser membro ativo. Erro de validação
(400 `validation_error`) traz `fields` por campo. O banco ainda reforça isso com FKs compostas.

**Categorias.** Nome único por casa, ignorando maiúsculas (409 `category_exists`). **Em uso não se exclui, arquiva-se**
(409 `category_in_use`). Arquivada some da lista padrão (`?includeArchived=true` mostra) e não aceita invoices novas.
Membros (não só admins) gerenciam categorias.

**Séries.** Parcelas e contas fixas são invoices comuns ligadas a uma compra (`purchases`) ou recorrência (`recurrences`); a resposta traz
`series` (`installmentNumber` + `installmentsCount`, ou `recurrenceId`). `scope=this` (padrão) mexe só na própria; `scope=following` edita/exclui
esta e as seguintes **ainda não pagas** da mesma série, sem aceitar `dueDate`/`competenceMonth` em lote. Geração, horizonte e regras
completas: [series-generation.md](series-generation.md).

## Listagem

`GET .../invoices` aceita `month` (competência, dia 1), `status` (`pending|overdue|paid`), `categoryId`, `responsibleUserId`,
`purchaseId`, `q` (busca na descrição, sem diferenciar maiúsculas; `%` e `_` valem como texto) e paginação. Ordem: vencimento, depois id.
Ao listar, o horizonte das contas fixas é estendido antes (inclusive até o mês pedido em `month`, se futuro). A paginação é por **cursor** (keyset sobre `(due_date, id)`): estável mesmo se itens mudam entre páginas, sem pular nem repetir.
Passe o `nextCursor` recebido em `cursor`; `limit` padrão 50, máximo 200.

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

O mapeamento de erro de serviço para HTTP fica **num lugar só**: `internal/api/errors.go`.

## Onde está

- `internal/category`, `internal/invoice`: modelo e serviço (regras e consultas, todas filtradas por `household_id`).
- `internal/series`: compras parceladas e recorrências (geração, horizonte, edição). Ver [series-generation.md](series-generation.md).
- `internal/api/categories.go`, `invoices.go`, `series.go`: handlers (tradução HTTP ↔ serviço).
- Testes: `internal/api/invoices_test.go` e `series_test.go` (fluxo ponta a ponta com Postgres real) e a coleção Postman (pastas 4 a 7).

## Para estender

Nova regra de invoice: validação em `invoice/service.go` (use `validation.Collector` para acumular erros por campo); erro novo de
negócio: declare `Err...` no serviço e mapeie em `api/errors.go`. Toda consulta **deve** filtrar por `household_id`.
