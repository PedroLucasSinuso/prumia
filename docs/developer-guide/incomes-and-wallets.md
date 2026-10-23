# Receitas, carteiras e resumo mensal

Responde: como salário e VR viram lançamentos mensais com descontos, como a previsão é gerada e reaplicada, como o saldo de
cada carteira é calculado, o que o resumo mensal soma e quando o app avisa sobre saldo de benefício. Código em
`api/internal/income` (fontes, lançamentos, regras puras), `api/internal/summary` (saldos e resumo) e
`api/internal/api/{incomes,summary,invoices}.go` (HTTP). Tabelas em [schema.md](schema.md) (seções 4 e 5).

## 1. Modelo em uma frase

Uma **fonte** (`income_sources`) é o molde mensal de uma pessoa (salário, VR, outra). Ela gera **lançamentos** (`incomes`),
um por mês de competência, já com o bruto e os descontos do molde. Cada lançamento nasce **previsto** (`received_at` nulo) e
vira **recebido** quando alguém marca. Receita **avulsa** é um lançamento sem fonte (`source_id` nulo).

## 2. Regras de valores

| Regra | Detalhe |
|---|---|
| Líquido | `bruto - soma(descontos)`, **calculado a cada leitura** (`income.Net`) e nunca gravado. Não existe coluna de líquido. |
| Descontos | Tipos `inss`, `irrf`, `health_plan`, `health_copay`, `other`; cada um com `name` (1 a 60 caracteres) e `amountCents > 0`. No máximo 20 por lançamento. O app **não calcula impostos**: o usuário digita os valores. |
| Soma <= bruto | A soma dos descontos não pode ultrapassar o bruto (igual é aceito: líquido zero). Erros saem por campo: `deductions` (soma), `deductions[2].amountCents`, `deductions[0].kind`... |
| Teto | Bruto e cada desconto até R$ 10 bilhões (`invoice.MaxAmount`), o mesmo teto das despesas. Com no máximo 20 descontos, nenhuma soma estoura `int64`. |
| Carteira | Derivada do tipo: `benefit` vai para a carteira `benefit`; `salary` e `other` para a `free`. O campo `wallet` na entrada é opcional; se vier incoerente com o tipo (VR em carteira livre, salário em benefício) a resposta é **400 no campo `wallet`**. O banco reforça com `CHECK ((kind='benefit') = (wallet='benefit'))`. |
| Responsável | `userId` deve ser membro **ativo** da casa (quem saiu, ou de outra casa, dá **400 no campo `userId`**). Além disso, a FK composta do banco recusa usuário de fora da casa. |
| Datas | `competenceMonth` e `startMonth`/`endMonth` são dia 1. `expectedDate` é um dia de calendário. `caldate.Date`, sem fuso. |

## 3. Previsão: geração, horizonte e reaplicação

Mesmo desenho das recorrências de despesa ([series-generation.md](series-generation.md)), com os mesmos números.

- **Criar a fonte** (`POST /income-sources`) grava a fonte, os descontos do molde (`income_source_deductions`) e **todos os
  lançamentos de `startMonth` até o horizonte** numa transação. Horizonte = 12 meses depois do maior entre o mês de hoje e
  `startMonth`, limitado por `endMonth`. `generated_through` guarda o último mês gerado. `startMonth` fica a no máximo 120 meses de hoje.
- **Data esperada** = `dayOfMonth` do mês, travada no último dia do mês curto (`caldate.WithDayClamped`): dia 31 vira 28/fev (29 em
  bissexto), 30/abr. Função pura `income.GenerateOccurrences`, testada em tabela.
- **Cada lançamento gerado** copia da fonte: pessoa, tipo, carteira, nome (vira a descrição), bruto, observação e os descontos.
- **Não ressuscita**: o índice único `(source_id, competence_month)` **inclui linhas excluídas**. O insert usa
  `ON CONFLICT DO NOTHING`; um mês que o usuário apagou continua "ocupado" e é ignorado em silêncio. Os descontos só são gravados
  para os lançamentos que de fato existem depois do insert (relê os ids), então uma corrida entre duas gerações nunca quebra a FK.
- **Estender sob demanda** (`Service.EnsureHorizon`): `GET /incomes?month=`, `GET /income-sources` e `GET /summary?month=` garantem
  a previsão até o mês pedido (teto: hoje + 60 meses; respeita `endMonth`). Idempotente e seguro com chamadas simultâneas: relê a
  fonte **travada** (`FOR UPDATE`), usa `ON CONFLICT DO NOTHING` e atualiza `generated_through` com `GREATEST`.
  Vale para qualquer papel, inclusive `viewer`, porque quem escreve é o sistema, não o usuário.
- **Leitura que grava nunca derruba a leitura**: se estender falhar, o handler registra `Warn` no log e responde com o que existe.
- **Job diário**: `api horizon` agora também chama `EnsureHorizonAll` das fontes (todas as casas; o único lugar sem filtro de casa,
  porque roda como sistema).

### Editar a fonte (`PATCH /income-sources/{id}`)

| Pedido | Efeito |
|---|---|
| Sem `applyFrom` | Só o molde muda (nome, bruto, dia, observação, descontos). Lançamentos já gerados ficam como estão; os meses ainda não gerados já saem com o molde novo. |
| Com `applyFrom=AAAA-MM-01` | Os lançamentos **previstos** (não recebidos, não excluídos) daquele mês em diante recebem o molde **inteiro**: descrição, bruto, observação, data esperada (dia do molde, com trava) e **os descontos são trocados pelos do molde**. Ajustes mês a mês feitos nesses lançamentos (por exemplo, a coparticipação variável) são sobrescritos: é o que "reaplicar o template" significa. Lançamentos **recebidos nunca mudam**; excluídos nunca voltam. `applyFrom` fora do dia 1 = 400. |
| `endMonth` | Só **antecipar** (igual às recorrências): adiar ou reabrir = 400; antes de `startMonth` = 400. Os previstos **depois** do novo fim são excluídos (logicamente); recebidos ficam. O horizonte passa a respeitar o fim. |
| `deductions` | Substitui a lista inteira do molde. Revalida a soma contra o bruto resultante (novo ou atual). |

A edição trava a linha da fonte (`FOR UPDATE`) e roda em transação: se qualquer validação falhar, nada muda.

## 4. Lançamentos (`/incomes`)

- `GET ?month=` (obrigatório, dia 1): previstos e recebidos da competência, ordenados por data esperada. Cada item traz
  `netAmountCents` (calculado) e `received`/`receivedAt`. Descontos de todos os itens vêm em **uma** consulta (sem N+1).
- `POST` cria receita **avulsa** (`sourceId` nulo).
- `PATCH` ajusta descrição, data esperada, bruto, observação e descontos (lista enviada **substitui** a atual; `[]` remove todos).
  Editar um lançamento gerado por fonte **não altera a fonte**. Se só o bruto muda, a soma dos descontos atuais é revalidada.
  Tipo, carteira, pessoa e competência não mudam (exclua e lance de novo).
- `DELETE` é exclusão lógica (204). Some das listas e dos saldos.
- `POST /{id}/receive` marca como recebida (`receivedAt` padrão hoje). O UPDATE é condicional (`received_at IS NULL`): receber de
  novo, ou dois cliques simultâneos, dá **409 `already_received`**. `DELETE /{id}/receive` desfaz (volta a previsto); se não estava
  recebida, **409 `not_received`**.

## 5. Carteiras e saldo

Não existe tabela de carteira. São dois valores (`free`, `benefit`) por casa, e o saldo é **calculado**, por mês:

```
saldo(carteira, mês) = receitas RECEBIDAS na carteira - despesas PAGAS com a carteira
```

Definições (decisão deste módulo, onde a spec era aberta):

| Termo | Definição |
|---|---|
| Receita do mês | lançamentos não excluídos com `competence_month = mês`. Usa o **líquido** (bruto - descontos). |
| Recebida | `received_at` preenchido. A data de recebimento não importa para o mês; vale a competência. |
| Prevista (`expectedIncomeCents`) | líquido de **todas** as receitas do mês na carteira (previstas + recebidas). `expected - received` = ainda a receber. |
| Despesa do mês | invoices não excluídas e **pagas**, com `competence_month = mês`, na carteira de pagamento (`paid_wallet`). |
| Valor da despesa | `paid_amount_cents` (o que foi **efetivamente pago**, com juros/multa/desconto), nunca o `amount_cents` original. |

**Por que tudo por competência**: a spec manda o resumo usar competência; usar a mesma régua para receita e despesa evita misturar
critérios (uma invoice de setembro paga em outubro pertence a setembro). Consequências a conhecer:

- O saldo é **do mês**: **não há saldo transportado** entre meses (VR que sobrou em outubro não soma em novembro). É uma estimativa
  por mês, não um controle bancário. Transportar saldo é uma evolução possível, mas muda o significado de "saldo do mês".
- Receita **prevista** não entra no saldo (só `expectedIncomeCents`). Quem não marca o salário/VR como recebido vê saldo menor.
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

`projetado = previsto para entrar − (já pago + a pagar)`. Responde "no fim do mês, sobra ou falta?" sem depender de a pessoa ter
marcado o salário como recebido: no dia 22, com o salário do dia 30 só previsto, o **realizado** (recebido − pago) é negativo, mas
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

## 7. Aviso de saldo de benefício ao pagar

`POST /invoices/{id}/pay` com `wallet = benefit`: depois de gravar o pagamento, o handler calcula o saldo da carteira de
benefício **na competência da invoice** (seção 5, já incluindo este pagamento). Se `saldo < 0`, responde 200 com
`warnings: ["benefit_balance_insufficient"]`. **Nunca bloqueia**: o pagamento já foi feito. Pagar com a carteira livre nunca avisa.
Se o cálculo falhar, vira `Warn` no log e `warnings: []` (o pagamento não vira erro).

Pegadinha esperada: como só receitas **recebidas** contam, quem paga o mercado antes de marcar o VR como recebido recebe o aviso.
A UI deve lembrar de marcar o VR como recebido.

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
| Receber o que já foi recebido | 409 `already_received` |
| Desfazer o que não foi recebido | 409 `not_received` |
| `viewer` escrevendo | 403 `read_only` |
| Corpo JSON inválido | 400 `bad_request` |

## 11. Testes

- Unitários (sem Docker): `income/rules_test.go` (líquido, soma de descontos, carteira, previsão com dia 31, horizonte) e
  `summary/summary_test.go` (saldo, projetado, atraso, montagem, ordem das categorias) e `summary/history_test.go` (intervalo
  padrão e limites, meses vazios com zero, ordem das séries).
- Ponta a ponta (Postgres real, `api/internal/api/incomes_test.go`): salário com INSS/IRRF/plano/coparticipação variável,
  reaplicação com `applyFrom` sem tocar nos recebidos, exclusão que não ressuscita, horizonte sob demanda, encerramento,
  VR em carteira livre, receber duas vezes, resumo com receita e despesa em carteiras diferentes, aviso de saldo, isolamento entre
  casas, `viewer` e responsável fora da casa. `summary_history_test.go`: histórico por competência (≠ vencimento), excluídas fora,
  parcelas e fixas em `seriesCents`, horizonte estendido até `to`, 400 nos intervalos inválidos, `viewer` lendo, isolamento entre
  casas; saldo projetado com o salário só previsto, "a pagar" estimado pela carteira da categoria (filha herda da mãe) e atraso.
- Manual: pasta **8. Receitas, fontes de receita e resumo do mês** da coleção em [postman/](postman/prumia.postman_collection.json).
