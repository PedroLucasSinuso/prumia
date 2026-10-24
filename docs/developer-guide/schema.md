# Modelo de dados — prumia

Fonte de verdade: [api/migrations/](../../api/migrations/) (`00001_init.sql` e as seguintes). Este documento explica **o porquê**
das decisões; se os dois divergirem, a migration vence e este arquivo deve ser corrigido.

Regra de ouro: o schema é a decisão mais cara de reverter. Qualquer mudança vira uma **nova migration** (nunca editar
uma já aplicada) e deve evitar backfill: prefira colunas nullable + default + constraint depois.

## 1. Convenções

| Tema | Decisão | Motivo |
|---|---|---|
| PK | `uuid`, gerado na aplicação (UUIDv7); `gen_random_uuid()` é só rede de segurança | UUIDv7 é ordenável por tempo (bom para índices) e não vaza contagem de registros |
| Dinheiro | `BIGINT` em centavos, sempre BRL | sem erro de ponto flutuante; R$ 660,00 = `66000` |
| Datas | `DATE` sem fuso | vencimento, pagamento e competência são dias de calendário, não instantes |
| Mês | `DATE` do dia 1 (`2026-10-01`), garantido por `CHECK` | chave simples para agrupar e comparar meses |
| Auditoria | `created_at`, `updated_at` (`timestamptz`) | instantes reais usam fuso |
| Exclusão | `deleted_at` (lógica), com "desfazer" na UI | exigência da spec |
| Enums | `TEXT` + `CHECK` | alterar um `CHECK` é trivial; alterar `ENUM` do Postgres não é |
| Multi-casa | `household_id` em toda tabela de negócio + **FKs compostas** `(household_id, id)` | o banco recusa referência entre casas, mesmo se o código errar |

### Por que FKs compostas
Toda tabela de negócio declara `UNIQUE (household_id, id)` e as referências usam o par. Assim, uma invoice da casa A
**não consegue** apontar para categoria, compra ou membro da casa B: o Postgres rejeita. É a última linha de defesa do
isolamento entre casas (a primeira é o escopo `household_id` aplicado em todo repository).

### Índices únicos parciais
- Regras de negócio (e-mail, nome de categoria) usam `WHERE deleted_at IS NULL`: apagar libera o nome.
- Séries (parcelas e recorrências) **incluem linhas apagadas** de propósito: se o usuário excluiu a parcela 3, o gerador
  não a recria.

## 2. Identidade e acesso

- **users**: e-mail único case-insensitive entre ativos. `password_hash` = argon2id. `theme` (migration 00005, ampliada na 00006): tema de cor da conta (`marfim`, `solarized`, `latte`, `dracula`, `nord`, `gruvbox`, `rosepine`, `contraste`, `sistema`), padrão `marfim` (quem tinha `grafite` voltou ao Marfim); lido em `GET /auth/me` e gravado em `PATCH /auth/me`. Trocar a senha (`POST /auth/password`) apaga as outras sessões do usuário.
- **sessions**: o cookie carrega o token; o banco guarda só o **SHA-256** (vazamento do banco não entrega sessões).
- **households**: a unidade de dados.
- **household_members**: PK `(household_id, user_id)`; `role` ∈ `admin|member|viewer`. **Nunca apaga**: quem sai ganha
  `left_at`, para que invoices antigas com esse responsável continuem válidas. Regra de serviço: sempre ≥ 1 admin ativo.
- **household_invites**: convite por link; guarda hash do token, role, validade, uso (`used_at`/`used_by` andam juntos)
  e revogação.
- **password_reset_tokens**: link de redefinição gerado por admin (sem e-mail). Regra de serviço: só permitido quando
  **todas** as casas ativas do usuário-alvo têm o solicitante como admin (evita tomada de conta entre casas).

## 3. Despesas

### categories
Por casa. `default_wallet` é só **sugestão** ao pagar (Mercado → `benefit`). `is_essential` alimenta, no pós-MVP, a meta da
reserva de emergência (meses de gasto essencial). Em uso → **arquivar** (`archived_at`), não apagar.

#### Subcategorias (migration 00004)
`categories.parent_id` (opcional, FK composta `(household_id, parent_id)`, `CHECK parent_id <> id`). **Dois níveis**: a mãe é sempre de
topo, regra no serviço (`checkParent`), não no banco. A conta/parcela/recorrência fica ligada à categoria **mais específica**; a
soma da mãe é feita na leitura (`web/src/lib/categories.ts`), então o resumo do servidor continua por categoria folha. O nome é único
**dentro da mãe** (índice `categories_name_uq` com `COALESCE(parent_id, 0)`); a ordem (`sort_order`) é entre irmãs. Arquivar a mãe
arquiva as filhas com o **mesmo instante**; restaurar a mãe traz de volta só as que têm esse instante (filha arquivada à parte antes
continua arquivada). Excluir mãe com filhas: 409 `category_has_children`. Down: as filhas voltam ao topo (pode colidir nomes).

### payees (migration 00003)
Favorecido: quem recebe o pagamento, com o **nome que a casa escolhe** (`name`: "Gás") e, opcionalmente, `cnpj` (só dígitos,
validado pelos dígitos verificadores no serviço; único por casa entre os não excluídos), `legal_name` (razão social, informativa)
e `default_category_id` (sugestão ao lançar a conta). Mesmo ciclo das categorias: em uso → **arquivar** (`archived_at`), não apagar.
`invoices.payee_id` é nullable (FK composta `(household_id, payee_id)`) e nunca obrigatório; só a avulsa e a edição o usam por ora.
Racional: [boleto-extraction.md](boleto-extraction.md) (o reconhecimento pelo CNPJ do boleto vem num PR seguinte).

### purchases (compra parcelada)
Cabeçalho que responde *"quando comprei o notebook e quanto custou?"*: `purchase_date`, `total_amount_cents`,
`installments_count`. As parcelas são linhas de `invoices`. Sem agrupamento por fatura de cartão (decisão do usuário).

### recurrences (conta fixa)
Gera uma invoice por mês até um horizonte. `generated_through` = último mês materializado; `EnsureHorizon` (sob demanda, mais o comando `api horizon`) estende
o horizonte. Ver [series-generation.md](series-generation.md). `day_of_month = 31` vira o último dia de meses curtos.

### recurrence_cuts (migration 00002)
Registro de cada encerramento feito por "excluir esta e as seguintes": `batch_deleted_at` (= `deleted_at` das ocorrências do lote),
`previous_end_month` (fim antes do corte; `NULL` = sem fim) e `cut_end_month` (`NULL` = o corte excluiu a recorrência). Serve só para o
Desfazer em lote devolver o fim anterior. PK `(recurrence_id, batch_deleted_at)`, FK composta com a casa.

### invoices
- `due_date` (vencimento) e `competence_month` (a que mês o gasto pertence; o resumo mensal usa **este**).
- **Série** (no máx. uma): `purchase_id + installment_number` **ou** `recurrence_id + occurrence_month`.
  Os `CHECK`s garantem os pares e a exclusividade.
- **Pagamento** (tudo ou nada): `paid_at`, `paid_wallet`, `paid_amount_cents` (pode diferir do valor: juros, multa,
  desconto), `paid_by_user_id`. Estado é derivado: pago = `paid_at IS NOT NULL`; atrasada = pendente com `due_date < hoje`.
  Não existe coluna `status`, para não haver dois jeitos de dizer a mesma coisa.
- Índices: lista do mês (`competence_month`), fila de pendentes (`due_date` parcial) e pagos (`paid_at` parcial).

### invoice_boletos (1:1)
Só os **dados** extraídos (linha digitável 47–48 dígitos, código de barras 44, beneficiário, valor e vencimento do
documento). Nunca o arquivo. Duplicidade de linha digitável é verificada no serviço.

## 4. Receitas

- **income_sources**: fonte recorrente de uma pessoa (salário, VR). Define a **previsão**: bruto + descontos de template,
  dia do mês, horizonte (`generated_through`). Satisfaz o requisito de não relançar salário todo mês.
- **income_source_deductions**: descontos do template (INSS, IRRF, plano, coparticipação média…).
- **incomes**: lançamento mensal. `source_id` nulo = receita avulsa. `received_at` nulo = **previsto**; preenchido =
  recebido. É editável mês a mês (coparticipação varia).
- **income_deductions**: descontos do mês, copiados do template e ajustáveis.
- **Líquido = bruto − soma dos descontos**, calculado, **não gravado** (evita inconsistência).
- `CHECK ((kind='benefit') = (wallet='benefit'))`: VR só existe na carteira de benefício e vice-versa.
- O app **não calcula impostos**.

## 5. Carteiras

Não existe tabela de carteira: são dois valores (`free`, `benefit`) por casa.
Saldo = receitas recebidas na carteira − invoices pagas com aquela carteira. Saldo de benefício insuficiente
**só avisa**, não bloqueia (é estimativa, não controle bancário). Definições exatas (o que conta como "do mês", valor pago efetivo,
sem saldo transportado) em [incomes-and-wallets.md](incomes-and-wallets.md).

## 6. O que o schema ainda NÃO cobre (pós-MVP, de propósito)

Reserva de emergência e investimentos. Previsto como **novas tabelas** (ex.: `goals`, `goal_contributions`), referenciando
`households` e `categories.is_essential`. Como é adição pura, não exige backfill.
