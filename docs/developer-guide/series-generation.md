# Séries: parcelas e contas fixas

Responde: como compras parceladas e recorrências viram invoices, como são estendidas, como se editam/excluem e por que
uma exclusão nunca "ressuscita". Código em `api/internal/series` (geração e serviços) e `api/internal/invoice` (escopo em lote).

Toda parcela e toda ocorrência é uma **linha comum de `invoices`**: paga, edita e exclui como qualquer outra. O que torna
uma invoice "de série" são as colunas `purchase_id + installment_number` (parcela) ou `recurrence_id + occurrence_month`
(ocorrência). Ver [schema.md](schema.md).

## 1. Compra parcelada (`POST /purchases`)

Numa **única transação** grava o cabeçalho (`purchases`) e as N invoices, **todas** (passadas e futuras): se algo falha,
nada nasce. Quem calcula é a função pura `series.GenerateInstallments` (testada em tabela, sem banco).

| Item | Regra |
|---|---|
| Valor | `money.Split(total, N)`: as N-1 primeiras iguais (arredondadas para baixo) e a **última leva o resto de centavos**. R$ 100,00 em 3x = 33,33 + 33,33 + 33,34. A soma é sempre o total. |
| `installmentAmountCents` | Opcional. Se informado, **todas** as parcelas valem exatamente isso (sem resto) e o `totalAmountCents` fica como o usuário informou. Serve para parcelado com juros: a soma das parcelas pode ser maior que o total. O total é informativo; o gasto real é a soma das parcelas. |
| Vencimento | Mensal a partir de `firstDueDate`. A parcela *i* vence em `firstDueDate.AddMonths(i)` (sempre calculada a partir da primeira, não da anterior), com **trava no último dia do mês**: 31/jan, 28/fev, 31/mar, 30/abr. Em ano bissexto, 29/fev. |
| Competência | O mês do vencimento de cada parcela (`dueDate` dia 1). |
| Descrição | `"<descrição> (n/N)"`, por exemplo `Notebook (1/6)`. Por isso a descrição da compra tem no máximo 100 caracteres. |
| Limites | 2 a 120 parcelas (CHECK do banco e validação). Responsável, categoria e observação são copiados para as parcelas. |
| Datas passadas | Parcelas já vencidas nascem **atrasadas** (estado derivado) e podem ser pagas normalmente. |

Consultas: `GET /purchases?q=` busca por descrição (sem diferenciar maiúsculas; `%` e `_` valem como texto), mais recentes
primeiro, paginação por cursor sobre `(purchase_date, id)`. A lista é leve (sem parcelas); `GET /purchases/{id}` traz as parcelas
em ordem. Isso responde "quando comprei o notebook e quanto custou?". Compra excluída ou de outra casa = 404.

## 2. Recorrência (`POST /recurrences`)

`series.GenerateOccurrences` devolve uma ocorrência por mês, de `start_month` até o **horizonte**:

- **Horizonte** = 12 meses depois do **maior** entre o mês de hoje e `start_month` (inclusive: hoje em out/2026 gera até out/2027),
  limitado por `end_month`, se houver. `generated_through` guarda o último mês materializado.
- **Vencimento** = `day_of_month` do mês, travado no último dia do mês curto (`WithDayClamped`: dia 31 em abril = 30).
- **Competência e `occurrence_month`** = o mês.
- O início deve estar a no máximo 120 meses de hoje (evita gerar milhares de linhas por engano).

### Estendendo o horizonte (`EnsureHorizon`)

`RecurrenceService.EnsureHorizon(ctx, householdID, requestedMonth)` gera os meses que faltam entre `generated_through` e o horizonte
(ou o mês pedido, se for mais à frente, com teto de 60 meses a partir de hoje). É **sob demanda** e idempotente:

1. `GET /invoices` chama antes de listar (o mês pedido em `month` entra como `requested`: olhar abril de 2028 gera até lá).
   Falha ao estender só gera um aviso no log; a listagem segue.
2. `GET /recurrences` chama antes de responder.
3. **Job diário (opcional)**: `api horizon` estende **todas as casas** e sai. Exemplo de cron no servidor:
   `5 3 * * * docker compose -f deploy/compose.yaml exec -T api api horizon`. Não é obrigatório: sem o job, o horizonte avança
   na primeira vez que alguém abre o app.

Como é seguro com acessos simultâneos: cada recorrência estende numa transação, os inserts usam `ON CONFLICT DO NOTHING` e
`generated_through` só avança (`GREATEST`).

### Nunca recria o que foi excluído

O índice único `(recurrence_id, occurrence_month)` **inclui linhas com `deleted_at`** (de propósito, ver schema.md). Excluir uma
ocorrência é só marcar `deleted_at`; a linha continua ocupando aquele mês, e o gerador insere com `ON CONFLICT DO NOTHING`, então
ignora o mês. Vale igual para parcelas (índice `(purchase_id, installment_number)`). Testado em `series_test.go`
(`TestRecorrenciaNaoRecriaExcluidas`: o marcador `generated_through` é "rebobinado" à força e a ocorrência excluída continua fora).
Para trazer de volta, use `POST /invoices/{id}/restore` (uma, ou o lote inteiro com `scope=following`; ver seção 3).

### Editando (`PATCH /recurrences/{id}`)

Muda o molde (valor, dia, descrição, categoria, responsável, observação) e **propaga às ocorrências futuras pendentes**:
`paid_at IS NULL` e `due_date >= hoje`. Pagas e passadas **nunca** mudam. Mudar `dayOfMonth` recalcula o vencimento de cada ocorrência
afetada (com a trava de mês curto); a competência não muda. Edições individuais feitas antes nas ocorrências futuras pendentes são
sobrescritas pelos campos enviados.

Encerrar (`endMonth`): só se pode **antecipar** o fim (ou definir se estava sem fim). Adiar ou limpar (`null`) dá 400
"não é possível reabrir": as ocorrências excluídas ao encerrar não podem voltar e deixariam buracos; crie uma nova recorrência.
As pendentes futuras com `occurrence_month > endMonth` são excluídas (logicamente). O horizonte passa a respeitar o fim.

## 3. Escopo em invoices de série (`scope` em `PATCH`/`DELETE /invoices/{id}`)

| `scope` | Alcance |
|---|---|
| `this` (padrão) | só a própria invoice |
| `following` | esta **e as seguintes da mesma série**: parcelas com `installment_number >=`; recorrência com `occurrence_month >=` |

Regras do `following` (`invoice.followingScope`):

- **Só pendentes**: invoices pagas ficam intactas, **inclusive a escolhida**, se estiver paga. Editar valor nunca reescreve uma paga; excluir nunca apaga uma paga.
- **Nunca paga em lote**: pagar é sempre uma invoice por vez (spec 4.2).
- Invoices já excluídas ficam de fora; sempre dentro da casa (`household_id`) da rota.
- **Num lote** não se aceita `dueDate` nem `competenceMonth` (400 em `fields`): cada parcela/ocorrência tem o seu. Edite uma a uma ou, na recorrência, mude o dia por `PATCH /recurrences`.
- **Descrição** em parcelas é tratada como base: cada parcela recebe o sufixo ` (n/N)` (um sufixo já digitado, como `(3/6)`, é removido antes). Em recorrência o texto é aplicado igual.
- **Recorrência**: o molde também muda (valor, descrição, categoria, responsável, observação), para as ocorrências geradas depois seguirem.
- **Compra**: o cabeçalho (`purchases`) não muda ao editar parcelas (o total é o informado na compra).
- Numa invoice **avulsa** (sem série), `following` equivale a `this`.
- Tudo numa transação.

### Excluir a compra ou a conta fixa inteira

Não há `DELETE /purchases` nem `DELETE /recurrences`: usa-se `DELETE /invoices/{id}?scope=following` **na primeira** parcela/ocorrência.

- **Compra**: as pendentes são excluídas. Quando não sobra nenhuma parcela viva (nem paga), o cabeçalho também é excluído
  (`GET /purchases/{id}` passa a dar 404 e some da lista). Restaurar uma parcela traz o cabeçalho de volta.
  Parcelas **pagas** permanecem (histórico do que foi pago); para removê-las, exclua cada uma com `scope=this`.
- **Recorrência**: as pendentes seguintes são excluídas e a série é **encerrada no mês anterior** ao da escolhida (`end_month`, que só diminui),
  para o horizonte não recriar os meses. Se a escolhida é a primeira ocorrência, a recorrência inteira é excluída e sai de `GET /recurrences`.
- Exclusões **não ressuscitam** sozinhas (ver acima). Para voltar atrás, há o Desfazer em lote (abaixo).

### Desfazer o lote (`POST /invoices/{id}/restore?scope=following`)

`scope=this` (padrão) restaura só a invoice. `scope=following` desfaz o **lote** "esta e as seguintes" a que ela pertence, numa transação:

- **Como o lote é identificado: pelo `deleted_at`.** O `DELETE ?scope=following` grava o **mesmo instante** (gerado uma vez no Go,
  truncado em microssegundos, a precisão do `timestamptz`) em todas as invoices do lote, no cabeçalho da compra (se fechou) e na
  recorrência (se foi excluída). O restore volta as da mesma série com número/mês `>=` o da escolhida **e** `deleted_at` igual ao dela.
  Exclusões avulsas anteriores (ex.: "só esta" na parcela 2 antes de excluir da 4 em diante) têm outro instante e **continuam excluídas**.
  Não precisou de coluna de lote nas invoices.
- **Compra**: restaurar qualquer parcela reabre o cabeçalho (`purchases.deleted_at = NULL`), como no restore simples.
- **Recorrência**: o fim anterior se perde ao encerrar (podia ser `NULL` ou um mês posterior), então o corte é registrado em
  `recurrence_cuts` (migration `00002`): `batch_deleted_at`, `previous_end_month` e `cut_end_month` (`NULL` = o lote excluiu a
  recorrência inteira). O Desfazer devolve `end_month = previous_end_month` (ou reativa a recorrência) **só se ela ainda está como o
  lote a deixou**; senão responde 409 `series_changed` e nada muda. Ex.: lote a partir de maio (fim abr) e depois a partir de março
  (fim fev): desfazer o de maio primeiro dá 409; desfazer março e depois maio volta tudo. Depois de reativada, o horizonte volta a
  gerar normalmente (as excluídas avulsas continuam ocupando o mês).
- Valida que as categorias das invoices restauradas ainda existem (409 `category_deleted`). Restaurar de novo dá 409 `not_deleted`.
- Lotes excluídos antes desta versão: as invoices voltam (o GORM já gravava um `deleted_at` único por lote), mas o fim da recorrência
  não é devolvido (não havia registro em `recurrence_cuts`).

Testes de ponta a ponta: `api/internal/api/series_lote_test.go` (parcelas com exclusão avulsa anterior e paga no meio, compra que
fecha e reabre, recorrência sem fim, com fim próprio, excluída inteira, lotes empilhados e isolamento entre casas).

## 4. Resposta: `series`

Toda invoice de série traz `series`:

- parcela: `{ kind: "installment", purchaseId, installmentNumber, installmentsCount }`;
- ocorrência: `{ kind: "recurrence", recurrenceId }`.

`installmentsCount` vem de `purchases.installments_count`, buscado **numa consulta só por lista** (`invoice.Service.Views`), sem N+1.

## 5. Testes

- Unitários (sem Docker): `series/generate_test.go` (31 de janeiro, bissexto, virada de ano, resto de centavos, 120 parcelas, horizonte).
- Ponta a ponta (Postgres real): `api/internal/api/series_test.go`: notebook 6x com 1ª parcela em agosto e hoje em outubro, escopo `following`,
  recorrência sem recriar excluída, horizonte sob demanda, edição/encerramento, isolamento entre casas e `viewer` (403).
- Postman: pastas 6 e 7 da coleção (`postman/prumia.postman_collection.json`).

## 6. Para estender

- Nova regra de geração: altere `generate.go` (funções puras) e acrescente casos à tabela de testes.
- Todo novo acesso a `invoices`, `purchases` ou `recurrences` **deve** filtrar por `household_id`; o único código sem esse filtro é `EnsureHorizonAll`
  (job do sistema), que sempre grava cada ocorrência na casa da própria recorrência.
- Mapeamento de erros de série: `series.ErrNotFound` (404) em `api/errors.go`.
