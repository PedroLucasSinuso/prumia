# Receitas, carteiras e resumo mensal

Responde: como uma receita (salário, VR, outras) vira lançamentos mensais com regra de data e valor cheio ou por unidade, como o
recebimento é automático, como a repetição é gerada, editada e excluída com escopo, como o saldo de cada carteira é calculado, o que o resumo mensal soma e quando o app avisa sobre saldo de benefício. Código em
`api/internal/income` (fontes, lançamentos, regras puras), `api/internal/calendar` (dias úteis e feriados), `api/internal/tax`
(estimativa de INSS e IRRF), `api/internal/summary` (saldos e resumo) e
`api/internal/api/{incomes,summary,invoices}.go` (HTTP). Tabelas em [schema.md](schema.md) (seções 4 e 5).

## 1. Modelo em uma frase

Para quem usa, receita é **uma lista só**: pessoa, descrição, tipo, valor, regra de data e repetição ("todo mês", até um mês
opcional). Por baixo, uma **fonte** (`income_sources`) é o molde da repetição e gera **lançamentos** (`incomes`), um por mês de
competência. Receita **avulsa** é um lançamento sem fonte (`source_id` nulo). O estado é **derivado** (ver seção 4.1): não há
coluna de status.

## 2. Regras de valores

| Regra | Detalhe |
|---|---|
| Líquido | `bruto - soma(descontos)`, **calculado a cada leitura** (`income.Net`) e nunca gravado. |
| Modo de valor | `fixed` (valor cheio, `grossAmountCents`) ou `per_unit`: preço por unidade (`unitPriceCents`) x `quantity`, com rótulo livre (`unitLabel`: "dia trabalhado", "hora"...). O bruto por unidade é **sempre recalculado** (preço x quantidade), nunca digitado. Quantidade 1 a 999; quando não vem, vale o **número de dias úteis do mês**. |
| Descontos | Tipos `inss`, `irrf`, `health_plan`, `health_copay`, `other`; cada um com `name` (1 a 60) e `amountCents > 0`. No máximo 20. **Opcionais**; `inss` e `irrf` só valem em receita do tipo salário (`CheckSalaryTaxes`; vale e outras recusam); o servidor só os calcula em `GET /tax/estimate` (sugestão, seção 6.2). |
| Soma <= bruto | A soma dos descontos não pode ultrapassar o bruto. Erros por campo: `deductions`, `deductions[2].amountCents`... |
| Teto | Bruto e cada desconto até R$ 10 bilhões (`invoice.MaxAmount`). |
| Carteira | `walletId` opcional na entrada. Sem ele: a **carteira padrão** da casa; para o tipo `benefit`, a carteira ativa chamada "Benefício" se existir (senão a padrão). **Qualquer tipo pode ir para qualquer carteira** (a regra antiga "VR só no benefício" caiu, junto com o `CHECK` do banco). Trocar o tipo **não** troca a carteira; para isso, `walletId` no `PATCH`. Carteira de outra casa, inexistente ou arquivada = 400 no campo `walletId`. |
| Responsável | `userId` deve ser membro **ativo** da casa (400 no campo `userId`). A FK composta do banco recusa usuário de fora. |
| Datas | `competenceMonth` e `startMonth`/`endMonth` são dia 1. `expectedDate` é um dia de calendário (`caldate.Date`, sem fuso). |

### 2.1 Regra de data e dias úteis

`DateRule` (`api/internal/income/daterule.go`) diz **quando a receita cai em cada mês**. Três regras, nenhuma específica de pessoa:

| `rule` | `n` | Resultado |
|---|---|---|
| `day_of_month` | 1 a 31 | dia N do mês, travado no último dia do mês curto; depois aplica o **ajuste** |
| `nth_business_day` | 1 a 23 | N-ésimo dia útil do mês (se o mês tem menos, o último) |
| `last_business_day` | não se aplica | último dia útil do mês |

`weekendAdjust` (só vale para `day_of_month`; as outras já caem em dia útil): `forward` (**padrão**: próximo dia útil; pode virar o
mês), `backward` (dia útil anterior) ou `none` (mantém). Fontes criadas antes da migration `00007` foram migradas para `none`
(preserva a data de antes); fontes novas nascem com `forward`.

**Mês em que a regra cai (`monthOffset`, migration `00010`)**: por padrão a regra é aplicada ao mês da competência. Com `monthOffset = -1` ela
é aplicada ao **mês anterior**: o vale-refeição de outubro (preço por dia × dias úteis de **outubro**) é recebido no último dia útil de
**setembro**. A competência não muda (é nela que o dinheiro é gasto e que o resumo conta; "a data não importa para o mês, vale a competência"),
só a **data**. Detalhes:

- `DateRule.Offset` (`0` ou `-1`; qualquer outro valor é 400 em `dateRule.monthOffset`). `DateRule.ExpectedDate(competência)` calcula o mês
  `competência + Offset` (`AddMonths`) e aplica a regra e o ajuste a ele, com os feriados **do ano desse mês**: competência de janeiro com
  offset -1 usa dezembro do ano anterior. "Data específica" (`expectedDate` digitada) não tem regra e portanto não tem offset.
- Colunas `income_sources.date_rule_offset` e `incomes.date_rule_offset` (`smallint NOT NULL DEFAULT 0 CHECK (IN (-1, 0))`): o backfill é 0,
  então quem já tem dados não muda. O lançamento **copia** o offset da fonte (como já copia `date_rule`, `date_rule_n` e `weekend_adjust`).
- A **quantidade** padrão de receita por unidade continua sendo os dias úteis do mês da **competência** (`BusinessDaysInMonth(competência)`),
  nunca os do mês em que a data cai.
- O estado derivado não muda: `IsReceived` compara só `expectedDate` com hoje. Um vale de outubro com data em 30/09 já conta como **recebido** no
  resumo de outubro assim que 30/09 chega, e o resumo de setembro não o soma (o resumo agrupa por `competence_month`).
- `GET /income-dates` aceita `monthOffset` (`-1` ou `0`); a data devolvida pode ser do mês anterior, mas `businessDays` é sempre o da competência
  (`month` continua sendo a competência).
- Edição: o offset faz parte do `dateRule` enviado (campo omitido = 0, igual a `weekendAdjust` omitido = `forward`). Em `scope=following` ele
  vai para o molde e para este e os seguintes não recebidos, que têm a data recalculada; em `scope=this` muda só este lançamento.

**Calendário** (`api/internal/calendar`, fonte única de "dia útil"): sábado, domingo e feriados **nacionais** não são úteis.
Funções puras e testadas em tabela com os feriados reais de 2026: `IsBusinessDay`, `NthBusinessDay`, `LastBusinessDay`,
`BusinessDaysInMonth`, `Roll(data, forward|backward|none)`. Os feriados vêm de `GET {HOLIDAYS_URL}/{ano}` (BrasilAPI;
`[{date,name,type}]`, só `national`), com cache em memória por ano (30 dias; 10 minutos depois de uma falha), prazo de 4 s e resposta
limitada a 1 MB. Se a API cair, devolver lixo (menos de 8 feriados) ou `HOLIDAYS_URL=off`, usa o **cálculo local** (`fallback.go`):
feriados fixos, Páscoa (algoritmo de Meeus/Jones/Butcher), Carnaval (segunda e terça), Sexta-feira Santa, Corpus Christi e a
Consciência Negra (nacional desde 2024). Feriados estaduais e municipais **não** entram. Com a consulta de CNPJ e as taxas de referência, é uma das três saídas de
rede da API (ver [security.md](security.md)). `GET /income-dates` devolve a prévia de uma regra (próximas datas e dias úteis de cada mês),
sem gravar nada. O endpoint não conhece "hoje": quem filtra as datas já passadas é o front (`lib/income.upcomingDates`, relógio injetado).

## 3. Repetição: geração, horizonte e reaplicação

Mesmo desenho das recorrências de despesa ([series-generation.md](series-generation.md)), com os mesmos números.

- **Criar** (`POST /incomes` com `repeats=true`, ou `POST /income-sources`) grava a fonte, os descontos do molde
  (`income_source_deductions`) e **todos os lançamentos de `startMonth` até o horizonte** numa transação. Horizonte = 12 meses depois
  do maior entre o mês de hoje e `startMonth`, limitado por `endMonth`. `generated_through` guarda o último mês gerado. `startMonth`
  fica a no máximo 120 meses de hoje. A `quantity` informada vale só para o primeiro mês; os outros usam os dias úteis.
- **Data esperada** de cada mês = `DateRule.ExpectedDate(mês)` (função pura `GenerateOccurrences`).
- **Cada lançamento gerado** copia da fonte: pessoa, tipo, carteira (`wallet_id`), nome (vira a descrição), valor (por unidade: preço e rótulo, com a
  quantidade = dias úteis do mês), **regra de data**, observação e descontos. A regra fica gravada no lançamento para o detalhe mostrá-la.
- **Não ressuscita**: o índice único `(source_id, competence_month)` **inclui linhas excluídas**; o insert usa `ON CONFLICT DO NOTHING`.
- **Estender sob demanda** (`Service.EnsureHorizon`): `GET /incomes?month=`, `GET /income-sources` e `GET /summary?month=` garantem a
  previsão até o mês pedido (teto: hoje + 60 meses). Idempotente e seguro com chamadas simultâneas (`FOR UPDATE`, `ON CONFLICT DO NOTHING`,
  `GREATEST`). Vale para qualquer papel, porque quem escreve é o sistema. Se falhar, a leitura segue (`Warn` no log).
- **Job diário**: `api horizon` chama `EnsureHorizonAll` (o único lugar sem filtro de casa).

### Editar o molde (`PATCH /income-sources/{id}`)

| Pedido | Efeito |
|---|---|
| Sem `applyFrom` | Só o molde muda. Lançamentos já gerados ficam; os meses ainda não gerados saem com o molde novo. |
| Com `applyFrom=AAAA-MM-01` | Os lançamentos que **ainda não contam como recebidos** daquele mês em diante recebem o molde **inteiro** (descrição, valor, regra de data e data calculada, observação, descontos trocados pelos do molde). Recebidos (inclusive os automáticos) **nunca mudam**; excluídos nunca voltam. |
| `walletId` | Muda a carteira do molde; com `applyFrom`, a dos lançamentos a receber daquele mês em diante (recebidos nunca mudam). |
| `endMonth` | Só **antecipar**. Os lançamentos a receber depois do novo fim são excluídos (logicamente). |
| `dateRule` / `dayOfMonth` | `dayOfMonth` é o atalho antigo (equivale a `day_of_month` mantendo o ajuste). |

A edição trava a fonte (`FOR UPDATE`) e roda em transação.

## 4. Lançamentos (`/incomes`)

- `GET ?month=` (obrigatório, dia 1): receitas da competência por data esperada. Cada item traz `netAmountCents`, `received`,
  `receivedAt`, `held`, `repeats`/`repeatsUntil`, o modo de valor e `dateRule`. Descontos e fontes vêm em consultas únicas (sem N+1).
- `POST` cria avulsa (data digitada ou regra) ou, com `repeats=true`, a repetição (exige `dateRule`).
- `PATCH ?scope=this|following` (padrão `this`): ver 4.2. `DELETE ?scope=` e `POST /{id}/restore?scope=`: ver 4.3.

### 4.1 Recebimento automático e "não caiu"

Uma receita **conta como recebida** quando `held_at IS NULL` e (`expected_date <= hoje` **ou** `received_at` preenchido). Ninguém
precisa marcar. A definição vive em dois lugares lado a lado: `Income.IsReceived(hoje)` (Go) e `income.ReceivedSQL` (SQL, usado pelo
resumo e pelos escopos), para não divergirem.

| Rota | Significado |
|---|---|
| `DELETE /{id}/receive` | **"Não caiu"**: grava `held_at`, limpa `received_at`. Deixa de contar como recebida e **sai do saldo** (volta a "a receber"; "atrasada" se a data passou). Se já não contava, 409 `not_received`. |
| `POST /{id}/receive` | **"Caiu"**: limpa `held_at`; se a data esperada ainda não chegou, marca `received_at` (hoje, ou o `receivedAt` do corpo). Se já conta como recebida, 409 `already_received`. |

As duas rodam com a linha travada. Receitas **passadas** que antes estavam "previstas" passam a contar como recebidas (a migration não
mexe nelas; o estado é derivado). `receivedAt` na resposta é o dia marcado ou, no automático, a data esperada.

### 4.2 Editar com escopo (`PATCH`)

Campos: pessoa, tipo (não muda a carteira), carteira (`walletId`), descrição, mês de competência, valor (modo, preço, quantidade, rótulo), regra de data ou data
digitada, descontos (a lista enviada substitui), observação.

- `scope=this`: só este lançamento; o molde não muda. Mudar o mês não pode colidir com outro mês da mesma repetição (o índice único inclui
  excluídos): 400 em `competenceMonth`. Mudar a regra ou o mês recalcula a data; uma `expectedDate` digitada vence.
- `scope=following`: atualiza o molde e reaplica **só os campos enviados** a este e aos seguintes que **não contam como recebidos**;
  recebidos nunca mudam (inclusive este, se já estiver recebido: o molde e os próximos mudam, o mês recebido não). Por unidade: cada mês mantém a própria quantidade. `competenceMonth`,
  `expectedDate` e `quantity` valem por mês: 400. Sem repetição, equivale a `this`. Escopo desconhecido: 400.
- No formulário (`IncomeForm`), numa receita que se repete o **padrão é `following`** ("Este e os seguintes"), também quando o mês editado já foi
  recebido (aí a frase diz "Este mês já foi recebido e não muda; os próximos sim."). Os campos de um mês só (competência, data específica,
  quantidade) continuam editáveis, mas ao mexer neles o escopo **volta sozinho** para `this` com uma frase explicando, em vez de o servidor
  responder 400; voltar para "Este e os seguintes" descarta essas mudanças. O corpo do `PATCH` leva só o que mudou.
- O bruto por unidade é recalculado; informar `grossAmountCents` em receita por unidade é 400. Descontos acima do novo valor: 400, e nada muda.

### 4.3 Excluir e restaurar com escopo

Espelham as contas fixas ([series-generation.md](series-generation.md)).

- `DELETE ?scope=this`: exclusão lógica só deste mês (o mês continua "ocupado": não ressuscita).
- `DELETE ?scope=following`: exclui este e os seguintes **que não contam como recebidos** (recebidos nunca somem em lote) com o **mesmo
  `deleted_at`** (gerado uma vez, em microssegundos) e encerra a repetição no mês anterior ao primeiro excluído; se não sobra mês antes
  do início, a fonte inteira é excluída. O corte vai para `income_source_cuts` (migration `00007`: `batch_deleted_at`, `previous_end_month`,
  `cut_end_month`, igual a `recurrence_cuts`).
- `POST /{id}/restore?scope=this|following`: `following` restaura os da mesma repetição, mês maior ou igual, com o **mesmo `deleted_at`** (exclusões
  avulsas anteriores ficam) e devolve o fim (ou reativa a fonte) **só se ela ainda está como o lote a deixou**; senão 409 `series_changed`
  e nada muda. Restaurar o que não está excluído: 409 `not_deleted`.

### 4.4 Excluir a repetição inteira (`DELETE /income-sources/{id}`)

Para o botão **Excluir** de "Receitas que se repetem" e "Excluir esta repetição" no detalhe. `Service.DeleteSource` (em `scope.go`),
numa transação com a fonte travada: exclui (logicamente) **todos os lançamentos previstos** da fonte (os que ainda não contam como
recebidos, de qualquer mês) com o **mesmo `deleted_at`**, e encerra a repetição no mês anterior ao primeiro deles
(`endSourceBefore`, o mesmo corte de `income_source_cuts` do "este e os seguintes"); se não sobra mês antes do início, ou não havia
nenhum previsto, a fonte inteira é excluída (com corte registrado). **Recebidos nunca somem**; meses passados continuam no histórico.
`POST /income-sources/{id}/restore` (`RestoreSource`) desfaz o corte **mais recente** da fonte: confere o estado da fonte
(`undoSourceCut`; 409 `series_changed` se mudou), restaura só os lançamentos com o `deleted_at` do lote (exclusões avulsas
anteriores, de outro instante, continuam excluídas) e devolve o fim (ou reativa a fonte). Sem corte a desfazer: 409 `not_deleted`.
Fonte inexistente, já excluída ou de outra casa: 404. `viewer`: 403 (middleware). Testes: `api/incomes_source_delete_test.go`.

## 5. Carteiras e saldo

### 5.1 A tabela `wallets`

Carteira = um **rótulo com saldo inicial** (não é conta bancária): "Geral", "Benefício", "Nubank da Ana"... Cada casa tem as suas. Código em
`api/internal/wallet` (`model.go`, `service.go`, `resolve.go`) e `api/internal/api/wallets.go`.

| Campo | Regra |
|---|---|
| `name` | 1 a 40 caracteres, **único entre as ativas** da casa (sem diferenciar maiúsculas; índice parcial). Repetido = 409 `wallet_exists`. |
| `isDefault` | **Exatamente uma por casa** (índice único parcial). Não pode ser arquivada (409 `wallet_is_default`); `PATCH isDefault=true` troca qual é (numa transação, com as carteiras da casa travadas); `false` na padrão é 400. |
| `ownerUserId` | **Só etiqueta** ("carteira da Ana"): não restringe uso nem leitura. Tem de ser membro **ativo** da casa (400 `ownerUserId`); `null` limpa. |
| `warnOnOverdraft` | Liga o aviso de saldo insuficiente ao pagar (seção 7). Nasce `true` (a "Geral" nasce `false`). |
| `openingBalanceCents` | Saldo inicial, pode ser negativo (teto de R$ 10 bilhões). Vale a partir de `openingBalanceMonth`; sem mês, entra no saldo anterior de **todos** os meses. |
| `openingBalanceMonth` | Opcional (migration `00011`), dia 1 (senão 400 no campo); `null` no PATCH limpa. "O saldo inicial vale a partir deste mês" (seção 5.2.1). Só admin altera. |
| `sortOrder` | Ordem de exibição; a nova vai para o fim. |
| `archivedAt` | Não existe exclusão: só `POST .../archive` e `.../restore`. Arquivada não aparece para escolha em lançamentos novos (400 `walletId`/`defaultWalletId`) mas segue no histórico e no resumo (seção 6). |

- **Casa nova** (`household.Service.CreateWithin`, na mesma transação): "Geral" (padrão, sem aviso) e "Benefício" (com aviso); a categoria
  Mercado e "Alimentação fora" sugerem a "Benefício". **Casas existentes** ganharam as duas na migration `00008` (backfill): `free` virou
  "Geral" e `benefit` virou "Benefício" em receitas, fontes, `invoices.paid_wallet_id` e `categories.default_wallet_id`.
- **Autorização**: listar = qualquer membro (inclusive `viewer`); criar, renomear, definir dono, trocar a padrão, arquivar, restaurar e
  saldo inicial = só **admin** (o "Responsável"), conferido no `wallet.Service` (403 `forbidden`; `member` também). `viewer` nunca escreve
  (403 `read_only` no porteiro). O `household_id` vem da rota; carteira de outra casa em qualquer campo `walletId` é 400, e na URL, 404.
- **Quem valida**: receita, fonte, pagamento e categoria chamam `wallet.CheckUsable` (existe na casa e está ativa). Testes:
  `api/wallets_test.go`.

### 5.2 O saldo

O saldo agora **é transportado**: o que sobra (ou falta) num mês entra como **saldo anterior** do seguinte.

```
anterior(carteira, mês) = saldo inicial + soma, nos meses ANTERIORES ao consultado, de (receitas RECEBIDAS líquidas - despesas PAGAS
                          + transferências recebidas - transferências enviadas + ajustes de saldo)
saldo(carteira, mês)    = anterior + receitas RECEBIDAS do mês - despesas PAGAS do mês
                          + transferências recebidas do mês - enviadas do mês + ajustes do mês   (REALIZADO)
do mês                  = receitas RECEBIDAS do mês - despesas PAGAS do mês + transferências recebidas - enviadas + ajustes
```

Definições (decisão deste módulo, onde a spec era aberta):

| Termo | Definição |
|---|---|
| Receita do mês | lançamentos não excluídos com `competence_month = mês`. Usa o **líquido** (bruto - descontos). |
| Recebida | **Derivada** (seção 4.1): a data esperada chegou (ou foi marcada antes) e ninguém disse "não caiu". A data não importa para o mês; vale a competência. |
| Prevista (`expectedIncomeCents`) | líquido de **todas** as receitas do mês na carteira (a receber + recebidas, inclusive as "não caiu"). `expected - received` = ainda a receber. |
| Despesa do mês | invoices não excluídas e **pagas**, com `competence_month = mês`, na carteira de pagamento (`paid_wallet_id`). |
| Valor da despesa | `paid_amount_cents` (o que foi **efetivamente pago**, com juros/multa/desconto), nunca o `amount_cents` original. |

**Por que tudo por competência**: a spec manda o resumo usar competência; usar a mesma régua para receita e despesa evita misturar
critérios (uma invoice de setembro paga em outubro pertence a setembro). Consequências a conhecer:

- O saldo anterior é **realizado**, como o saldo: só conta o que já foi recebido/pago. Para um mês futuro, a receita de um mês anterior que
  ainda não "caiu" **não** está no saldo anterior (está no `expected` do próprio mês, que o projetado soma).
- Receita **a receber** (data futura) ou **"não caiu"** não entra no saldo (só em `expectedIncomeCents`). Como o recebimento é automático,
  ninguém precisa marcar o salário/VR; o saldo só fica menor se alguém disser "não caiu".
- Uma invoice paga com uma carteira conta para a competência **da invoice**, não do dia do pagamento.
- Não é saldo bancário, mas dá para **reconciliar** com o real a qualquer momento: é o "Conferir saldo" (seção 5.4). Mover dinheiro
  entre carteiras é a **transferência** (seção 5.3).

### 5.3 Transferências entre carteiras

Mover dinheiro de uma carteira para outra (guardar R$ 500 do Geral na Reserva, ou tirar de lá). **Não é receita nem despesa**: só
altera o saldo das duas carteiras. Código em `api/internal/transfer` (`model.go`, `service.go`) e `api/internal/api/transfers.go`;
tabela `wallet_transfers` (migration `00009`, ver [schema.md](schema.md)).

| Regra | Detalhe |
|---|---|
| Campos | `fromWalletId`, `toWalletId`, `amountCents` (`> 0`, até R$ 10 bilhões, o mesmo teto das contas), `transferDate` (padrão hoje), `competenceMonth` (dia 1; padrão = mês da data), `notes` (opcional, até 500, `invoice.CheckNotes`). |
| Validação | Origem = destino: 400 em `toWalletId`. Carteira inexistente, **de outra casa** ou **arquivada**: 400 no campo (`wallet.CheckUsable`; a FK composta do banco é a segunda barreira). Arquivada só vale para transferências **antigas**: elas seguem nos saldos. |
| Sem edição | Só criar, excluir (`deleted_at`) e restaurar (o Desfazer). Para corrigir, exclui e cria outra. Excluir uma já excluída = 404; restaurar uma ativa = 409 `not_deleted`. |
| Autorização | Listar = qualquer membro. Criar/excluir/restaurar = `admin` e `member`; `viewer` nunca escreve (403 `read_only` no porteiro, como em todas as rotas de escrita). `household_id` sempre da rota. |
| Rotas | `GET /transfers?month=` (lista da competência, `transfer_date DESC`), `POST /transfers`, `DELETE /transfers/{id}` (204), `POST /transfers/{id}/restore`. |

**Efeito nos saldos** (`summary.transfersByWallet`, uma consulta a mais no resumo, agora **6**, sem N+1): origem e destino entram na mesma
agregação (`UNION ALL` com o sinal certo) e cada `WalletBalance` ganha `transfersInCents` e `transfersOutCents` (do mês, por
`competence_month`). `balanceCents`, `monthBalanceCents` e `projectedCents` somam `transfersIn - transfersOut`; `carryOverCents`
inclui o líquido das transferências de **todos os meses anteriores**. Carteira arquivada aparece também se tiver transferência no mês.
Transferência **nunca** entra em `byCategory`, `totalPaidCents`, `totalPendingCents`, nem em `expectedIncomeCents/receivedIncomeCents/paidCents`.

**Aviso de saldo**: depois de gravar, o handler chama `summary.OverdraftWarning(origem, competência)` (o mesmo do pagamento, já com a
transferência). Se a **origem** tem `warnOnOverdraft` e o saldo realizado acumulado ficou `< 0`, a resposta 201 (`TransferResult`) traz
`warnings: ["wallet_balance_insufficient"]` e `warningDetails: [{code, walletId}]`. **Nunca bloqueia**.

A exportação CSV (`invoice/export.go`) lista só contas, então não muda.

### 5.4 Conferir saldo (ajustes de saldo)

O saldo soma só o que está cadastrado: se a pessoa lança a receita e esquece os gastos, sobra dinheiro "falso" nos meses seguintes.
"Conferir saldo" reconcilia com a realidade: a pessoa digita o **saldo real** da carteira no fim de um mês e a **diferença** para o
saldo calculado vira um **ajuste** naquele mês. Como a transferência, **não é receita nem despesa**: só altera o saldo da carteira.
Código em `api/internal/adjustment` (`model.go`, `service.go`) e `api/internal/api/adjustments.go`; tabela `wallet_adjustments`
(migration `00012`, ver [schema.md](schema.md)).

| Regra | Detalhe |
|---|---|
| Entrada | `walletId`, `actualBalanceCents` (o saldo **real**, pode ser negativo; até ±R$ 10 bilhões), `competenceMonth` (dia 1; padrão = mês atual), `notes` (opcional, até 500). |
| Diferença | O servidor calcula o saldo **realizado** até o fim do mês (`balanceCents` do resumo, via `summary.WalletMonth`, a MESMA conta do resumo e do aviso de saldo, já com os ajustes anteriores) e grava `amount_cents = real - calculado`. A prévia da tela é só informativa. Diferença zero = 400 em `actualBalanceCents` ("o saldo já confere"). |
| Validação | Carteira inexistente, de outra casa ou **arquivada**: 400 em `walletId`. Mês fora do dia 1, **futuro** (depois do mês atual) ou **anterior ao mês de início** da carteira: 400 em `competenceMonth`. |
| Vários no mesmo mês | Permitido: cada conferência grava só a nova diferença (o calculado já inclui as anteriores). A lista mostra todos. |
| Sem edição | Criar, excluir (`deleted_at`) e restaurar (o Desfazer devolve a **mesma** diferença, sem recalcular). Excluir um já excluído = 404; restaurar um ativo = 409 `not_deleted`. |
| Autorização | Listar = qualquer membro. Criar/excluir/restaurar = `admin` e `member`; `viewer` nunca escreve (403 `read_only` no porteiro). `household_id` sempre da rota. |
| Rotas | `GET /wallet-adjustments?month=`, `POST /wallet-adjustments` (201 com o ajuste), `DELETE /wallet-adjustments/{id}` (204), `POST /wallet-adjustments/{id}/restore`. |

**Efeito nos saldos** (`summary.adjustmentsByWallet`, mais uma consulta agregada no resumo, agora **7**, sem N+1): cada `WalletBalance`
ganha `adjustmentsCents` (soma do mês, com sinal). `balanceCents`, `monthBalanceCents` e `projectedCents` somam os ajustes do mês;
`carryOverCents` inclui os ajustes dos meses anteriores, com o mesmo filtro de mês de início (`sinceOpening`). Carteira arquivada aparece
também se tiver ajuste no mês. Ajuste **nunca** entra em `byCategory`, totais, nem em previsto/recebido/pago. O `OverdraftWarning`
(aviso ao pagar/transferir) passa por `WalletMonth`, então um ajuste para baixo faz o pagamento seguinte avisar.

**Armadilha conhecida**: se a pessoa confere o saldo e **depois** lança um gasto esquecido daquele mês, o gasto entra além do ajuste
(conta duas vezes). A tela avisa no formulário e mostra o ajuste no cartão da carteira ("ajustes de saldo (conferência)") e na lista
"Ajustes de saldo do mês" do Resumo; a correção é conferir de novo (ou excluir o ajuste).

Na UI (Resumo): botão **Conferir saldo** em cada cartão de carteira (só para quem escreve, só até o mês atual, nunca em arquivada);
o painel mostra o calculado, a prévia da diferença e grava; o aviso traz **Desfazer**. Testes: `api/adjustments_test.go` (cenário
do plano, mês passado, validações, papéis, isolamento, excluir/restaurar, aviso de saldo), `summary/summary_test.go` (`assemble` com
ajustes), `platform/db/migrate_adjustments_test.go` (Up/Down/Up com dados) e `web/src/pages/BalanceCheck.test.tsx`.

#### 5.2.1 Mês de início do saldo inicial

Quem começa a usar o app no meio da vida financeira (contas de agosto a janeiro, app usado desde outubro) não precisa lançar o passado:
a carteira ganha um **mês de início S** (`wallets.opening_balance_month`, `NULL` = comportamento de sempre, nenhuma carteira existente muda).
Para o mês consultado M:

| Caso | `carryOverCents` |
|---|---|
| S nulo | saldo inicial + movimento de todos os meses < M (regra de 5.2) |
| M < S | **0** (a carteira "ainda não começou"; o saldo inicial não entra). O movimento do **próprio** mês M segue calculado, então agosto e setembro mostram o que foi cadastrado |
| M = S | saldo inicial |
| M > S | saldo inicial + movimento dos meses m com S ≤ m < M. O movimento anterior a S **nunca** entra |

"Movimento" é a mesma definição de saldo (recebido líquido − pago + transferências recebidas − enviadas). A regra mora num só lugar:
`summary.sinceOpening`, o filtro `(w.opening_balance_month IS NULL OR competência >= w.opening_balance_month)` aplicado, com `JOIN wallets`,
às quatro consultas de saldo anterior (receitas, pagos, transferências, ajustes), mais o zero de M < S em `assemble`. Resumo, projetado e
`OverdraftWarning` (aviso ao pagar/transferir) passam pelas mesmas consultas, então não divergem. Carteira arquivada continua aparecendo só
com saldo anterior ≠ 0 ou movimento no mês, já com a regra nova. `WalletBalance.openingBalanceMonth` leva o mês à UI.
Testes: `api/wallet_opening_month_test.go` (cenário das parcelas, NULL, PATCH, M<S/=S/>S, início depois do último movimento, aviso,
isolamento), `summary/summary_test.go` e `platform/db/migrate_opening_month_test.go` (Up/Down/Up com dados).

### 5.5 Reserva de emergência (meta)

Opcional (PT-5a): a casa define quantos **meses de gasto essencial** quer guardados e quais carteiras contam como reserva.
Nada é gravado além da configuração: `households.reserve_target_months` (1 a 36, `NULL` = sem meta) e `wallets.counts_as_reserve`
(migration `00014`). Código em `api/internal/reserve` e `api/internal/api/reserve.go`.

| Regra | Detalhe |
|---|---|
| Gasto essencial médio | Média, nos **6 meses anteriores** ao consultado **que tiveram alguma conta** na casa, das contas de categorias essenciais (`is_essential` da categoria **ou da categoria principal dela**): valor pago (`paid_amount_cents`) se paga, senão o valor da conta. Meses sem nenhuma conta (antes de começar a usar o app) não puxam a média para baixo. Sem histórico, usa o próprio mês. |
| Guardado | Soma do saldo **realizado** (o `balanceCents` do resumo, via `summary.Month`) das carteiras marcadas, no mês consultado. |
| Meta | `targetCents = meses × gasto essencial médio`. |
| Rotas | `GET /reserve?month=` (qualquer membro), `PUT /reserve {targetMonths, walletIds}` (só o Responsável, como as carteiras; responde o status do mês atual). Carteira de outra casa = 400 em `walletIds`; meses fora de 1 a 36 = 400 em `targetMonths`. |

Na UI: card "Reserva de emergência (opcional)" em Ajustes > Carteiras (o Responsável escolhe a meta e marca as carteiras; os outros só
veem quando há meta) e o bloco "Reserva de emergência" no Resumo (só com meta): guardado, quantos meses cobre, a meta e o medidor.
Testes: `api/reserve_test.go`, `platform/db/migrate_reserve_test.go` e `web/src/pages/Reserve.test.tsx`.

### 5.6 Investimentos (carteira especial)

PT-5b. Um investimento (CDB, Tesouro, poupança...) é uma **carteira com `kind = 'investment'`** (migration `00015`), e não uma
entidade à parte: reaproveita o saldo transportado, as transferências e o Conferir saldo, sem duplicar a conta do saldo.

| Regra | Detalhe |
|---|---|
| Tipo | `wallets.kind`: `regular` (padrão) ou `investment`. Escolhido **só ao criar** (`WalletInput.kind`); o PATCH não muda o tipo. |
| Instituição | `wallets.institution` (opcional, até 60 caracteres; vazio = `NULL`). Só etiqueta. Editável no PATCH (`null` limpa). |
| Aporte e resgate | **Transferências** (`CheckUsable`): aporte = da carteira comum para o investimento; resgate = o contrário. |
| Rendimento | **Conferir saldo** (ajuste): a pessoa informa o valor atual e a diferença vira ajuste do mês. |
| Não paga nem recebe | `wallet.CheckSpendable` (pagar invoice, receita e molde de receita, carteira padrão de categoria) recusa investimento com 400 no campo. A sugestão de carteira para Vale (`BenefitOrDefaultID`) só olha carteiras `regular`. |
| Não é padrão | `CHECK (NOT (is_default AND kind = 'investment'))` no banco e 400 em `isDefault` no PATCH. |
| Resumo | `WalletBalance.kind` vai na resposta; o cálculo é o mesmo de qualquer carteira. O **front** separa: o saldo projetado da casa soma só as `regular`, e os investimentos aparecem no bloco "investimentos" (`InvestmentCard`: valor, aportes, resgates, rendimento e atualizações). |
| Reserva | Um investimento pode contar como reserva (5.5), como qualquer carteira. |

**Taxas de referência (PT-5c).** `GET /rates` (só logado; não é recurso da casa) devolve CDI, Selic e IPCA acumulado em 12 meses
da BrasilAPI (`GET {RATES_URL}`, padrão `https://brasilapi.com.br/api/taxas/v1`, resposta `[{nome, valor}]` com `valor` em % ao ano).
Os valores viram **basis points** inteiros (`1490` = 14,90%) com aritmética exata (`big.Rat`, sem float); resposta com valor fora de
-50% a 100% ou sem nenhuma taxa conhecida é descartada. Cache de 12 h; depois de uma falha, `available: false` com a última leitura boa
(ou lista vazia) e nova tentativa em 10 min; uma consulta por vez. Código em `api/internal/rates` e `api/internal/api/rates.go`
(ligado por `Server.WithRates`). No front, o bloco "investimentos" mostra as referências e cada `InvestmentCard` compara o
**rendimento do mês** (ajustes ÷ valor antes deles: saldo anterior + aportes − resgates) com o CDI mensal equivalente
(`lib/rates.ts`; conta só de exibição). Testes: `rates/rates_test.go`, `api/rates_test.go` e `web/src/pages/Investments.test.tsx`.

Fora de escopo: taxa contratada por investimento, cotação de ações e fundos.
Testes: `api/investments_test.go`, `platform/db/migrate_investment_wallets_test.go` e `web/src/pages/Investments.test.tsx`.

## 6. Resumo mensal (`GET /summary?month=`)

Escopado por `household_id`, tudo por competência, em **7 consultas** (sem N+1): carteiras da casa, receitas por carteira (mês e meses
anteriores, com `FILTER`), pagos por carteira (idem), pendentes por carteira estimada (com o atraso), transferências por carteira (idem),
ajustes de saldo por carteira (idem) e invoices por categoria. O saldo
anterior sai da **mesma agregação** (`competence_month < mês`), sem consulta por carteira. A montagem (`summary.assemble`) é pura e
testada em tabela.

`wallets` é uma **lista** (não mais `{free, benefit}`): a carteira padrão primeiro, depois `sortOrder` e nome. Cada item:

| Campo | Cálculo |
|---|---|
| `walletId`, `name`, `ownerUserId`, `isDefault`, `archived` | da carteira |
| `openingBalanceCents` | saldo inicial da carteira |
| `openingBalanceMonth` | mês (dia 1) em que o saldo inicial passa a valer; `null` = desde o início |
| `carryOverCents` | saldo anterior (seções 5.2 e 5.2.1; 0 antes do mês de início) |
| `expectedIncomeCents / receivedIncomeCents / paidCents` | do mês, ver seção 5.2 |
| `transfersInCents / transfersOutCents` | transferências recebidas / enviadas na competência (seção 5.3) |
| `adjustmentsCents` | soma, com sinal, dos ajustes de saldo da competência (seção 5.4) |
| `balanceCents` | **realizado acumulado**: `carryOver + receivedIncomeCents - paidCents + transfersInCents - transfersOutCents + adjustmentsCents` (pode ser negativo) |
| `monthBalanceCents` | só o mês: `receivedIncomeCents - paidCents + transfersInCents - transfersOutCents + adjustmentsCents` |
| `pendingCents` | **estimativa** do que falta pagar com a carteira (ver "saldo projetado" abaixo) |
| `projectedCents` | **saldo projetado**: `carryOver + expectedIncomeCents - paidCents - pendingCents + transfersInCents - transfersOutCents + adjustmentsCents` |

**Carteira arquivada** só entra na lista se tem `carryOver` diferente de zero **ou** algum movimento no mês (previsto, recebido, pago, a
pagar, transferência ou ajuste). As ativas sempre entram.

| Outros campos | Cálculo |
|---|---|
| `overdueCents` / `overdueCount` | pendentes da competência com `due_date < hoje` (fuso da app): soma e quantidade |
| `totalPaidCents` | soma de `paid_amount_cents` das invoices **pagas** da competência |
| `totalPendingCents` | soma de `amount_cents` das invoices **não pagas** da competência; **inclui as atrasadas** |
| `byCategory[].totalCents` | por categoria: valor pago (se paga) ou valor da invoice (se pendente), somados |
| `byCategory[].paidCents` | parte já paga (valor efetivo) |
| Ordem de `byCategory` | `totalCents` decrescente; empate pelo `categoryId`, para a ordem ser estável |

Categorias arquivadas aparecem se tiverem invoices no mês. O nome da categoria não vem no resumo; o front cruza pelo `categoryId`
com `GET /categories?includeArchived=true`; o das carteiras já vem no item. Mês sem dados devolve a lista de carteiras (com o saldo anterior)
e `byCategory: []`. `month` fora do dia 1 = 400 no campo `month`.

### Saldo projetado (o número principal do resumo)

`projetado = saldo anterior + previsto para entrar − (já pago + a pagar)`. Responde "no fim do mês, sobra ou falta?" sem depender de o salário já ter caído: no dia 22, com o salário do dia 30 só previsto, o **realizado** (anterior + recebido − pago) pode ser negativo, mas
isso não é alarme. Por isso a UI usa o projetado como número principal e o coral/`[ ✖ ]` **só quando o projetado é negativo**; o
realizado aparece em segundo plano ("hoje: …").

**Decisão sobre o "a pagar" por carteira**: a carteira de uma conta pendente só é conhecida ao pagar (`paid_wallet_id`). A estimativa
usa a **carteira padrão da categoria** (`categories.default_wallet_id`); se a categoria é filha e não tem padrão, usa a da mãe; sem
nenhuma, vai para a **carteira padrão da casa**. Na soma da casa a escolha não importa: o total é
`anterior + previsto − pago − pendente` de qualquer jeito. Por carteira é uma estimativa (quem paga o mercado com a Geral, por exemplo, verá
a Geral "melhor" do que vai ficar até pagar). O aviso ao pagar (seção 7) usa o **realizado**.

## 6.1 Histórico por categoria (`GET /summary/categories?from=&to=`)

Alimenta os gráficos do resumo. Código em `api/internal/summary/history.go`.

- Intervalo: `from` e `to` são dias 1. Padrão: os **6 meses até o mês atual** (fuso da app); com só `to`, os 6 até ele; com só `from`,
  os 6 a partir dele. Máximo **24 meses**; dia ≠ 1, `to < from` ou intervalo maior = 400 `validation_error`.
- Uma consulta: `GROUP BY category_id, competence_month` sobre `invoices` não excluídas da casa no intervalo, coberta pelo índice
  `invoices_competence_idx (household_id, competence_month) WHERE deleted_at IS NULL` (sem migration nova).
- Por categoria **folha** (como o resumo): a soma da mãe e o empilhamento das filhas são feitos no front (`web/src/lib/history.ts`).
- `totalCents` segue a régua do resumo (pago = valor efetivo; pendente = valor da invoice); `paidCents` é a parte paga; `seriesCents`
  é a parte que é **parcela ou conta fixa** (`purchase_id` ou `recurrence_id`): é o que a seção "Compromissos futuros" soma.
- **Todos os meses aparecem** em cada série (zero onde não houve conta); `months` lista o intervalo. Séries ordenadas pela soma do
  período (maior primeiro), empate pelo id.
- Como o resumo, estende o horizonte das contas fixas e das receitas até `to` antes de ler (o intervalo é validado antes, então um
  pedido inválido não grava nada). Todos os membros leem, inclusive `viewer`.

## 6.2 Estimativa de INSS e IRRF (`GET /tax/estimate`)

Sugestão **opcional** para preencher os descontos (o formulário tem o botão "Sugerir INSS e IRRF"); nada é gravado nem aplicado sozinho.
`?month=AAAA-MM-01&grossCents=&dependents=` devolve `{ inssCents, irrfCents, tableYear, sources, checkedOn, approximate }`. O endpoint
fica sob a casa (`/households/{id}/tax/estimate`, qualquer membro lê) e `approximate` é **sempre verdadeiro**.

- Tabelas **versionadas por ano** em `api/internal/tax/tables.go` (hoje só 2026), com as URLs oficiais e a data da conferência
  (`checkedOn`, 23/10/2026). Ano sem tabela usa a mais recente (`tableYear` mostra qual; a tela avisa). Para um ano novo, copie o bloco,
  troque os números pelas tabelas oficiais e acrescente o caso em `estimate_test.go`.
- **INSS** (Portaria Interministerial MPS/MF nº 13/2026): progressivo, 7,5% até R$ 1.621,00; 9% até R$ 2.902,84; 12% até R$ 4.354,27;
  14% até R$ 8.475,55 (teto; contribuição máxima R$ 988,09). Arredonda uma vez, no fim.
- **IRRF** (Receita Federal, tabela mensal de 2026): isento até R$ 2.428,80; 7,5% (dedução R$ 182,16) até R$ 2.826,65; 15% (R$ 394,16) até
  R$ 3.751,05; 22,5% (R$ 675,49) até R$ 4.664,68; 27,5% (R$ 908,73) acima. Base = bruto − a dedução mais vantajosa entre (INSS + R$ 189,59
  por dependente) e o desconto simplificado de R$ 607,20.
- **Lei 15.270/2025** (art. 3º-A da Lei 9.250/1995, texto conferido no Planalto): rendimentos tributáveis até R$ 5.000,00 têm redução de
  até R$ 312,89 (imposto zero); de R$ 5.000,01 a R$ 7.350,00 a redução é `R$ 978,62 − 0,133145 × rendimentos`, decrescente até zerar;
  acima, nenhuma. A redução é limitada ao imposto da tabela progressiva. "Rendimentos" = o bruto.
- **Não considera**: pensão alimentícia, previdência privada, outros rendimentos, 13º, PLR, férias, mais de um vínculo. Por isso é estimativa;
  a tela avisa "estimativa pela tabela de 2026; confira no seu holerite".
- Não existe API pública oficial; fontes conferidas: gov.br/inss (tabela de contribuição mensal), gov.br/receitafederal (tabelas do IRPF 2026)
  e planalto.gov.br (Lei 15.270/2025). Valores de teste conferidos à mão contra elas.

## 7. Aviso de saldo insuficiente ao pagar

`POST /invoices/{id}/pay` exige `walletId` (carteira ativa da casa; ausente ou inválido = 400 `walletId`). Depois de gravar o pagamento,
`summary.OverdraftWarning` calcula o saldo **realizado acumulado** da carteira usada **até a competência da invoice** (seção 5.2, já
incluindo este pagamento e o saldo anterior). Se a carteira tem `warnOnOverdraft = true` e o saldo `< 0`, a resposta 200 traz
`warnings: ["wallet_balance_insufficient"]` e `warningDetails: [{code, walletId}]` (a carteira que estourou; o front escreve o nome).
**Nunca bloqueia**: o pagamento já foi feito. Carteira com o aviso desligado nunca avisa. Se o cálculo falhar, vira `Warn` no log e
`warnings: []` (o pagamento não vira erro). O código antigo `benefit_balance_insufficient` **deixou de existir**.

Pegadinha esperada: como só receitas **recebidas** contam, quem paga o mercado antes da data do VR (ou com o VR como "não caiu")
recebe o aviso. Se o dinheiro entrou adiantado, "Caiu" resolve.

## 8. Quem vê o quê (privacidade)

**Decisão**: a casa é a unidade de dados. Todo membro ativo, **inclusive `viewer`**, vê as receitas, fontes e o resumo de **todos** os
membros da casa; a spec diz que receitas são "por pessoa" (campo `userId`), mas isso identifica de quem é, não restringe a leitura.
Escrita: `viewer` nunca escreve (403 `read_only` no middleware); `member` e `admin` lançam e editam receitas de qualquer membro.
Quem não é membro da casa recebe 404 (sem revelar que ela existe). Restringir renda por pessoa seria uma mudança de produto (e de
queries), não está implementada.

## 9. Isolamento entre casas

Todo método do serviço recebe `householdID` da rota autorizada e filtra por ele: leitura, edição, exclusão, recebimento, geração e
reaplicação (`reapplyTemplate` seleciona os ids **com** `household_id`). As FKs compostas do schema são a segunda barreira
(lançamento aponta para fonte e membro da mesma casa; descontos apontam para o lançamento da mesma casa). O único código sem
filtro de casa é `EnsureHorizonAll`, usado só pelo job `api horizon`.

## 10. Erros

| Situação | Resposta |
|---|---|
| Validação (campo, soma de descontos, `walletId` inexistente/de outra casa/arquivada, responsável fora da casa, mês fora do dia 1) | 400 `validation_error` com `fields` |
| Lançamento/fonte inexistente, excluído ou de outra casa | 404 `not_found` |
| "Caiu" numa receita que já conta como recebida | 409 `already_received` |
| "Não caiu" numa que não conta como recebida | 409 `not_received` |
| Restaurar o que não está excluído | 409 `not_deleted` |
| Desfazer o lote depois que a repetição mudou (também em `/income-sources/{id}/restore`) | 409 `series_changed` |
| `scope` desconhecido, regra de data inválida, mês que colide na repetição | 400 `validation_error` (campo `scope`, `dateRule.n`, `competenceMonth`...) |
| `viewer` escrevendo | 403 `read_only` |
| Carteira: `member` escrevendo (só admin) | 403 `forbidden` |
| Carteira: nome já usado por outra ativa (criar, renomear, restaurar) | 409 `wallet_exists` |
| Carteira: arquivar a padrão | 409 `wallet_is_default` |
| Carteira inexistente ou de outra casa (na URL) | 404 `not_found` |
| Transferência: origem = destino, valor ≤ 0, carteira de outra casa/arquivada, competência fora do dia 1 | 400 `validation_error` com `fields` (`toWalletId`, `fromWalletId`, `amountCents`, `competenceMonth`) |
| Transferência inexistente, já excluída (ao excluir) ou de outra casa | 404 `not_found` |
| Restaurar transferência que não está excluída | 409 `not_deleted` |
| Conferir saldo: carteira de outra casa/arquivada, mês futuro, fora do dia 1 ou antes do mês de início, saldo que já confere | 400 `validation_error` com `fields` (`walletId`, `competenceMonth`, `actualBalanceCents`) |
| Ajuste inexistente, já excluído (ao excluir) ou de outra casa | 404 `not_found`; restaurar um que não está excluído: 409 `not_deleted` |
| Corpo JSON inválido | 400 `bad_request` |

## 11. Testes

- Unitários (sem Docker): `calendar/calendar_test.go` (dias úteis, N-ésimo e último dia útil, `Roll`, feriados de 2026 contra a lista real da
  BrasilAPI, API falsa com cache/TTL/falha/`off`), `tax/estimate_test.go` (INSS e IRRF por faixa, redução da Lei 15.270, dependentes, ano
  sem tabela), `income/rules_test.go` (líquido, soma de descontos, carteira, regras de data em meses reais, valor por unidade, estado derivado,
  horizonte) e `summary/*_test.go` (saldo anterior e arquivadas em tabela).
- Mês anterior (`monthOffset`): `income/rules_test.go` (último, N-ésimo e dia N com offset -1, virada de ano e feriado de 25/12, validação),
  `platform/db/migrate_offset_test.go` (Up/Down/Up da `00010` com dados, backfill 0 e o `CHECK`) e `api/incomes_offset_test.go` (repetição, quantidade
  da competência, resumo recebido, `following` e `this`, prévia).
- Migration (`platform/db/migrate_receitas_test.go`): sobe até a `00006`, cria fonte e receita no formato antigo, aplica a `00007` e confere
  que viraram valor fixo + dia N + ajuste `none`; Up/Down/Up em `migrate_test.go`. Carteiras (`migrate_wallets_test.go`): sobe até a `00007`
  com dados `free`/`benefit` em duas casas (e uma excluída), aplica a `00008` e confere a conversão para os ids, o `Down` (volta ao texto) e
  um novo `Up`; `TestSchemaCarteiras` confere as garantias do banco (uma padrão por casa, nome único entre ativas, FKs compostas).
- Ponta a ponta (Postgres real): `api/incomes_test.go` (descontos, reaplicação, exclusão que não ressuscita, horizonte, VR, resumo, aviso,
  papéis), `api/wallets_test.go` (CRUD, papéis, uma padrão por casa, arquivar/restaurar, isolamento entre casas, saldo anterior acumulando entre meses, aviso por carteira) e `api/incomes_v2_test.go` (regras de data em meses reais, valor por unidade, recebimento automático e "não caiu" com relógio
  móvel, excluir/restaurar com escopo incluindo lotes empilhados e recebidos intocados, editar com escopo, prévia e impostos, isolamento
  entre casas e `viewer`). As varreduras de `security_test.go` cobrem as rotas novas sozinhas.
- Datas da prévia: `income/rules_test.go` (`TestRegrasDeData2026`) fixa as datas reais usadas pelos testes do front (virada de ano, feriados, mês curto, ajustes).
- Transferências: `api/transfers_test.go` (padrões, validações, papéis, isolamento entre casas, excluir/restaurar, efeito nos saldos do mês, saldo anterior acumulando e projetado, nada muda em categorias/totais, arquivadas, aviso de saldo), `summary/summary_test.go` (`assemble` com transferências) e `platform/db/migrate_transfers_test.go` (Up/Down/Up com dados e as garantias do banco). `security_test.go` cria uma transferência no cenário e varre a rota nova.
- Manual: pasta **8. Receitas, fontes de receita e resumo do mês** da coleção em [postman/](postman/prumia.postman_collection.json).
