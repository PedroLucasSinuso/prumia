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
| Descontos | Tipos `inss`, `irrf`, `health_plan`, `health_copay`, `other`; cada um com `name` (1 a 60) e `amountCents > 0`. No máximo 20. **Opcionais**; o servidor só os calcula em `GET /tax/estimate` (sugestão, seção 6.2). |
| Soma <= bruto | A soma dos descontos não pode ultrapassar o bruto. Erros por campo: `deductions`, `deductions[2].amountCents`... |
| Teto | Bruto e cada desconto até R$ 10 bilhões (`invoice.MaxAmount`). |
| Carteira | Derivada do tipo: `benefit` vai para a carteira `benefit`; `salary` e `other` para a `free`. Trocar o tipo troca a carteira. O campo `wallet` na entrada é opcional; incoerente = 400 no campo `wallet`. O banco reforça com `CHECK`. |
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

**Calendário** (`api/internal/calendar`, fonte única de "dia útil"): sábado, domingo e feriados **nacionais** não são úteis.
Funções puras e testadas em tabela com os feriados reais de 2026: `IsBusinessDay`, `NthBusinessDay`, `LastBusinessDay`,
`BusinessDaysInMonth`, `Roll(data, forward|backward|none)`. Os feriados vêm de `GET {HOLIDAYS_URL}/{ano}` (BrasilAPI;
`[{date,name,type}]`, só `national`), com cache em memória por ano (30 dias; 10 minutos depois de uma falha), prazo de 4 s e resposta
limitada a 1 MB. Se a API cair, devolver lixo (menos de 8 feriados) ou `HOLIDAYS_URL=off`, usa o **cálculo local** (`fallback.go`):
feriados fixos, Páscoa (algoritmo de Meeus/Jones/Butcher), Carnaval (segunda e terça), Sexta-feira Santa, Corpus Christi e a
Consciência Negra (nacional desde 2024). Feriados estaduais e municipais **não** entram. É, com a consulta de CNPJ, a única saída de
rede da API (ver [security.md](security.md)). `GET /income-dates` devolve a prévia de uma regra (próximas datas e dias úteis de cada mês),
sem gravar nada. O endpoint não conhece "hoje": quem filtra as datas já passadas é o front (`lib/income.upcomingDates`, relógio injetado).

## 3. Repetição: geração, horizonte e reaplicação

Mesmo desenho das recorrências de despesa ([series-generation.md](series-generation.md)), com os mesmos números.

- **Criar** (`POST /incomes` com `repeats=true`, ou `POST /income-sources`) grava a fonte, os descontos do molde
  (`income_source_deductions`) e **todos os lançamentos de `startMonth` até o horizonte** numa transação. Horizonte = 12 meses depois
  do maior entre o mês de hoje e `startMonth`, limitado por `endMonth`. `generated_through` guarda o último mês gerado. `startMonth`
  fica a no máximo 120 meses de hoje. A `quantity` informada vale só para o primeiro mês; os outros usam os dias úteis.
- **Data esperada** de cada mês = `DateRule.ExpectedDate(mês)` (função pura `GenerateOccurrences`).
- **Cada lançamento gerado** copia da fonte: pessoa, tipo, carteira, nome (vira a descrição), valor (por unidade: preço e rótulo, com a
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

Campos: pessoa, tipo (muda a carteira), descrição, mês de competência, valor (modo, preço, quantidade, rótulo), regra de data ou data
digitada, descontos (a lista enviada substitui), observação.

- `scope=this`: só este lançamento; o molde não muda. Mudar o mês não pode colidir com outro mês da mesma repetição (o índice único inclui
  excluídos): 400 em `competenceMonth`. Mudar a regra ou o mês recalcula a data; uma `expectedDate` digitada vence.
- `scope=following`: atualiza o molde e reaplica **só os campos enviados** a este e aos seguintes que **não contam como recebidos**;
  recebidos nunca mudam (inclusive este, se já estiver recebido). Por unidade: cada mês mantém a própria quantidade. `competenceMonth`,
  `expectedDate` e `quantity` valem por mês: 400. Sem repetição, equivale a `this`. Escopo desconhecido: 400.
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

Não existe tabela de carteira. São dois valores (`free`, `benefit`) por casa, e o saldo é **calculado**, por mês:

```
saldo(carteira, mês) = receitas RECEBIDAS na carteira - despesas PAGAS com a carteira
```

Definições (decisão deste módulo, onde a spec era aberta):

| Termo | Definição |
|---|---|
| Receita do mês | lançamentos não excluídos com `competence_month = mês`. Usa o **líquido** (bruto - descontos). |
| Recebida | **Derivada** (seção 4.1): a data esperada chegou (ou foi marcada antes) e ninguém disse "não caiu". A data não importa para o mês; vale a competência. |
| Prevista (`expectedIncomeCents`) | líquido de **todas** as receitas do mês na carteira (a receber + recebidas, inclusive as "não caiu"). `expected - received` = ainda a receber. |
| Despesa do mês | invoices não excluídas e **pagas**, com `competence_month = mês`, na carteira de pagamento (`paid_wallet`). |
| Valor da despesa | `paid_amount_cents` (o que foi **efetivamente pago**, com juros/multa/desconto), nunca o `amount_cents` original. |

**Por que tudo por competência**: a spec manda o resumo usar competência; usar a mesma régua para receita e despesa evita misturar
critérios (uma invoice de setembro paga em outubro pertence a setembro). Consequências a conhecer:

- O saldo é **do mês**: **não há saldo transportado** entre meses (VR que sobrou em outubro não soma em novembro). É uma estimativa
  por mês, não um controle bancário. Transportar saldo é uma evolução possível, mas muda o significado de "saldo do mês".
- Receita **a receber** (data futura) ou **"não caiu"** não entra no saldo (só em `expectedIncomeCents`). Como o recebimento é automático,
  ninguém precisa marcar o salário/VR; o saldo só fica menor se alguém disser "não caiu".
- Uma invoice paga com a carteira de benefício conta para a competência **da invoice**, não do dia do pagamento.

## 6. Resumo mensal (`GET /summary?month=`)

Escopado por `household_id`, tudo por competência, em **4 consultas agregadas** (sem N+1): receitas por carteira, pagos por
carteira, pendentes por carteira estimada (com o atraso), invoices por categoria. A montagem (`summary.assemble`) é pura e testada em tabela.

| Campo | Cálculo |
|---|---|
| `wallets.{free,benefit}.expectedIncomeCents / receivedIncomeCents / paidCents` | ver seção 5 |
| `wallets.*.balanceCents` | **realizado**: `receivedIncomeCents - paidCents` (pode ser negativo) |
| `wallets.*.pendingCents` | **estimativa** do que falta pagar com a carteira (ver "saldo projetado" abaixo) |
| `wallets.*.projectedCents` | **saldo projetado**: `expectedIncomeCents - paidCents - pendingCents` |
| `overdueCents` / `overdueCount` | pendentes da competência com `due_date < hoje` (fuso da app): soma e quantidade |
| `totalPaidCents` | soma de `paid_amount_cents` das invoices **pagas** da competência |
| `totalPendingCents` | soma de `amount_cents` das invoices **não pagas** da competência; **inclui as atrasadas** |
| `byCategory[].totalCents` | por categoria: valor pago (se paga) ou valor da invoice (se pendente), somados |
| `byCategory[].paidCents` | parte já paga (valor efetivo) |
| Ordem de `byCategory` | `totalCents` decrescente; empate pelo `categoryId`, para a ordem ser estável |

Categorias arquivadas aparecem se tiverem invoices no mês. O nome da categoria não vem no resumo; o front cruza pelo `categoryId`
com `GET /categories?includeArchived=true`. Mês sem dados devolve zeros e `byCategory: []`. `month` fora do dia 1 = 400 no campo `month`.

### Saldo projetado (o número principal do resumo)

`projetado = previsto para entrar − (já pago + a pagar)`. Responde "no fim do mês, sobra ou falta?" sem depender de o salário já ter caído: no dia 22, com o salário do dia 30 só previsto, o **realizado** (recebido − pago) é negativo, mas
isso não é alarme. Por isso a UI usa o projetado como número principal e o coral/`[ ✖ ]` **só quando o projetado é negativo**; o
realizado aparece em segundo plano ("hoje: …").

**Decisão sobre o "a pagar" por carteira**: a carteira de uma conta pendente só é conhecida ao pagar (`paid_wallet`). A estimativa
usa a **carteira padrão da categoria** (`categories.default_wallet`); se a categoria é filha e não tem padrão, usa a da mãe; sem
nenhuma, vai para a **livre**. Na soma da casa (`free.projected + benefit.projected`) a escolha não importa: o total é
`previsto − pago − pendente` de qualquer jeito. Por carteira é uma estimativa (quem paga o mercado com a livre, por exemplo, verá
a livre "melhor" do que vai ficar até pagar). `BenefitBalance` (aviso ao pagar, seção 7) continua usando o **realizado**.

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

## 7. Aviso de saldo de benefício ao pagar

`POST /invoices/{id}/pay` com `wallet = benefit`: depois de gravar o pagamento, o handler calcula o saldo da carteira de
benefício **na competência da invoice** (seção 5, já incluindo este pagamento). Se `saldo < 0`, responde 200 com
`warnings: ["benefit_balance_insufficient"]`. **Nunca bloqueia**: o pagamento já foi feito. Pagar com a carteira livre nunca avisa.
Se o cálculo falhar, vira `Warn` no log e `warnings: []` (o pagamento não vira erro).

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
| Validação (campo, soma de descontos, carteira incoerente, responsável fora da casa, mês fora do dia 1) | 400 `validation_error` com `fields` |
| Lançamento/fonte inexistente, excluído ou de outra casa | 404 `not_found` |
| "Caiu" numa receita que já conta como recebida | 409 `already_received` |
| "Não caiu" numa que não conta como recebida | 409 `not_received` |
| Restaurar o que não está excluído | 409 `not_deleted` |
| Desfazer o lote depois que a repetição mudou (também em `/income-sources/{id}/restore`) | 409 `series_changed` |
| `scope` desconhecido, regra de data inválida, mês que colide na repetição | 400 `validation_error` (campo `scope`, `dateRule.n`, `competenceMonth`...) |
| `viewer` escrevendo | 403 `read_only` |
| Corpo JSON inválido | 400 `bad_request` |

## 11. Testes

- Unitários (sem Docker): `calendar/calendar_test.go` (dias úteis, N-ésimo e último dia útil, `Roll`, feriados de 2026 contra a lista real da
  BrasilAPI, API falsa com cache/TTL/falha/`off`), `tax/estimate_test.go` (INSS e IRRF por faixa, redução da Lei 15.270, dependentes, ano
  sem tabela), `income/rules_test.go` (líquido, soma de descontos, carteira, regras de data em meses reais, valor por unidade, estado derivado,
  horizonte) e `summary/*_test.go`.
- Migration (`platform/db/migrate_receitas_test.go`): sobe até a `00006`, cria fonte e receita no formato antigo, aplica a `00007` e confere
  que viraram valor fixo + dia N + ajuste `none`; Up/Down/Up em `migrate_test.go`.
- Ponta a ponta (Postgres real): `api/incomes_test.go` (descontos, reaplicação, exclusão que não ressuscita, horizonte, VR, resumo, aviso,
  papéis) e `api/incomes_v2_test.go` (regras de data em meses reais, valor por unidade, recebimento automático e "não caiu" com relógio
  móvel, excluir/restaurar com escopo incluindo lotes empilhados e recebidos intocados, editar com escopo, prévia e impostos, isolamento
  entre casas e `viewer`). As varreduras de `security_test.go` cobrem as rotas novas sozinhas.
- Datas da prévia: `income/rules_test.go` (`TestRegrasDeData2026`) fixa as datas reais usadas pelos testes do front (virada de ano, feriados, mês curto, ajustes).
- Manual: pasta **8. Receitas, fontes de receita e resumo do mês** da coleção em [postman/](postman/prumia.postman_collection.json).
