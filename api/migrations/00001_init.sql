-- Schema inicial do prumia. Racional completo em docs/developer-guide/schema.md.
--
-- Convenções (valem para todas as tabelas):
--   * PK uuid (gerado na aplicação com UUIDv7; o default do banco é só rede de segurança).
--   * Dinheiro: BIGINT em centavos, sempre BRL.
--   * Datas de calendário: DATE sem fuso. "Mês" é sempre o DATE do dia 1 (ex.: 2026-10-01).
--   * Exclusão lógica: deleted_at (timestamptz). Índices únicos de negócio são parciais (WHERE deleted_at IS NULL),
--     exceto os de séries (parcelas/recorrências), que incluem linhas apagadas para não ressuscitar ocorrências.
--   * Isolamento multi-casa: toda tabela de negócio tem household_id, e as FKs entre elas são COMPOSTAS
--     (household_id, id), de modo que o banco recusa referências entre casas diferentes.
--   * Enums como TEXT + CHECK (migrar um CHECK é trivial; migrar um ENUM do Postgres não é).

-- +goose Up

-- ---------------------------------------------------------------------------
-- Identidade e acesso
-- ---------------------------------------------------------------------------

CREATE TABLE users (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text        NOT NULL,
    name          text        NOT NULL,
    password_hash text        NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    deleted_at    timestamptz
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email)) WHERE deleted_at IS NULL;

-- Sessão por cookie. O cookie carrega o token; o banco guarda apenas o SHA-256 dele.
CREATE TABLE sessions (
    token_hash   bytea       PRIMARY KEY,
    user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    user_agent   text,
    ip           text
);
CREATE INDEX sessions_user_idx    ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE households (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name       text        NOT NULL,
    created_by uuid        NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

-- Membros nunca são apagados: quem sai ganha left_at. Assim invoices antigas que apontam
-- para o membro (responsável) continuam válidas. Regra de serviço: sempre >= 1 admin ativo.
CREATE TABLE household_members (
    household_id uuid        NOT NULL REFERENCES households (id),
    user_id      uuid        NOT NULL REFERENCES users (id),
    role         text        NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
    joined_at    timestamptz NOT NULL DEFAULT now(),
    left_at      timestamptz,
    PRIMARY KEY (household_id, user_id)
);
CREATE INDEX household_members_user_idx ON household_members (user_id);

CREATE TABLE household_invites (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id uuid        NOT NULL REFERENCES households (id),
    token_hash   bytea       NOT NULL UNIQUE,
    role         text        NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
    created_by   uuid        NOT NULL REFERENCES users (id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    used_at      timestamptz,
    used_by      uuid        REFERENCES users (id),
    revoked_at   timestamptz,
    CHECK ((used_at IS NULL) = (used_by IS NULL))
);
CREATE INDEX household_invites_household_idx ON household_invites (household_id);

-- Link de redefinição de senha gerado por um admin (sem e-mail). Regra de serviço: só é permitido quando
-- todas as casas ativas do usuário-alvo têm o solicitante como admin (evita tomada de conta entre casas).
CREATE TABLE password_reset_tokens (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash bytea       NOT NULL UNIQUE,
    created_by uuid        NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    used_at    timestamptz
);
CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id);

-- ---------------------------------------------------------------------------
-- Categorias
-- ---------------------------------------------------------------------------

CREATE TABLE categories (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id   uuid        NOT NULL REFERENCES households (id),
    name           text        NOT NULL,
    -- Carteira sugerida ao pagar (ex.: Mercado -> 'benefit'). Só sugestão; a escolha final é no pagamento.
    default_wallet text        CHECK (default_wallet IN ('free', 'benefit')),
    -- Gasto essencial: base do cálculo da meta da reserva de emergência (pós-MVP).
    is_essential   boolean     NOT NULL DEFAULT false,
    sort_order     integer     NOT NULL DEFAULT 0,
    archived_at    timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    deleted_at     timestamptz,
    UNIQUE (household_id, id)
);
CREATE UNIQUE INDEX categories_name_uq ON categories (household_id, lower(name)) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Despesas: compra parcelada, recorrência e invoices
-- ---------------------------------------------------------------------------

-- Cabeçalho de uma compra parcelada: responde "quando comprei o notebook e quanto custou no total?".
-- As parcelas são linhas de invoices (purchase_id + installment_number).
CREATE TABLE purchases (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id        uuid        NOT NULL REFERENCES households (id),
    category_id         uuid        NOT NULL,
    responsible_user_id uuid,
    description         text        NOT NULL,
    purchase_date       date        NOT NULL,
    total_amount_cents  bigint      NOT NULL CHECK (total_amount_cents > 0),
    installments_count  smallint    NOT NULL CHECK (installments_count BETWEEN 2 AND 120),
    notes               text,
    created_by          uuid        NOT NULL REFERENCES users (id),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    deleted_at          timestamptz,
    UNIQUE (household_id, id),
    FOREIGN KEY (household_id, category_id)         REFERENCES categories (household_id, id),
    FOREIGN KEY (household_id, responsible_user_id) REFERENCES household_members (household_id, user_id)
);
CREATE INDEX purchases_household_date_idx ON purchases (household_id, purchase_date DESC) WHERE deleted_at IS NULL;

-- Conta fixa mensal (aluguel, internet...). Gera uma invoice por mês até um horizonte.
CREATE TABLE recurrences (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id        uuid        NOT NULL REFERENCES households (id),
    category_id         uuid        NOT NULL,
    responsible_user_id uuid,
    description         text        NOT NULL,
    amount_cents        bigint      NOT NULL CHECK (amount_cents > 0),
    day_of_month        smallint    NOT NULL CHECK (day_of_month BETWEEN 1 AND 31), -- 31 vira o último dia do mês curto
    start_month         date        NOT NULL CHECK (EXTRACT(DAY FROM start_month) = 1),
    end_month           date        CHECK (EXTRACT(DAY FROM end_month) = 1),
    generated_through   date        NOT NULL CHECK (EXTRACT(DAY FROM generated_through) = 1), -- último mês gerado
    notes               text,
    created_by          uuid        NOT NULL REFERENCES users (id),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    deleted_at          timestamptz,
    CHECK (end_month IS NULL OR end_month >= start_month),
    UNIQUE (household_id, id),
    FOREIGN KEY (household_id, category_id)         REFERENCES categories (household_id, id),
    FOREIGN KEY (household_id, responsible_user_id) REFERENCES household_members (household_id, user_id)
);

CREATE TABLE invoices (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id        uuid        NOT NULL REFERENCES households (id),
    category_id         uuid        NOT NULL,
    responsible_user_id uuid,
    description         text        NOT NULL,
    amount_cents        bigint      NOT NULL CHECK (amount_cents > 0),
    due_date            date        NOT NULL,
    -- Mês a que o gasto se refere (default = mês do vencimento). O resumo mensal usa este campo.
    competence_month    date        NOT NULL CHECK (EXTRACT(DAY FROM competence_month) = 1),

    -- Série (no máximo uma): parcela de compra OU ocorrência de recorrência.
    purchase_id         uuid,
    installment_number  smallint    CHECK (installment_number >= 1),
    recurrence_id       uuid,
    occurrence_month    date        CHECK (EXTRACT(DAY FROM occurrence_month) = 1),

    -- Pagamento. paid_amount_cents pode diferir de amount_cents (juros, multa, desconto).
    paid_at             date,
    paid_wallet         text        CHECK (paid_wallet IN ('free', 'benefit')),
    paid_amount_cents   bigint      CHECK (paid_amount_cents > 0),
    paid_by_user_id     uuid        REFERENCES users (id),

    notes               text,
    created_by          uuid        NOT NULL REFERENCES users (id),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    deleted_at          timestamptz,

    UNIQUE (household_id, id),
    FOREIGN KEY (household_id, category_id)         REFERENCES categories (household_id, id),
    FOREIGN KEY (household_id, responsible_user_id) REFERENCES household_members (household_id, user_id),
    FOREIGN KEY (household_id, purchase_id)         REFERENCES purchases (household_id, id),
    FOREIGN KEY (household_id, recurrence_id)       REFERENCES recurrences (household_id, id),

    CONSTRAINT invoices_paid_all_or_none CHECK (
        (paid_at IS NULL AND paid_wallet IS NULL AND paid_amount_cents IS NULL AND paid_by_user_id IS NULL)
        OR (paid_at IS NOT NULL AND paid_wallet IS NOT NULL AND paid_amount_cents IS NOT NULL)
    ),
    CONSTRAINT invoices_single_series CHECK (purchase_id IS NULL OR recurrence_id IS NULL),
    CONSTRAINT invoices_purchase_pair CHECK ((purchase_id IS NULL) = (installment_number IS NULL)),
    CONSTRAINT invoices_recurrence_pair CHECK ((recurrence_id IS NULL) = (occurrence_month IS NULL))
);
-- Séries: incluem linhas apagadas de propósito (o gerador não recria o que o usuário excluiu).
CREATE UNIQUE INDEX invoices_installment_uq ON invoices (purchase_id, installment_number)  WHERE purchase_id IS NOT NULL;
CREATE UNIQUE INDEX invoices_occurrence_uq  ON invoices (recurrence_id, occurrence_month)  WHERE recurrence_id IS NOT NULL;
-- Listagem do mês (tela principal) e fila de pendentes (atrasadas / a vencer).
CREATE INDEX invoices_competence_idx ON invoices (household_id, competence_month) WHERE deleted_at IS NULL;
CREATE INDEX invoices_pending_idx    ON invoices (household_id, due_date)         WHERE deleted_at IS NULL AND paid_at IS NULL;
CREATE INDEX invoices_paid_idx       ON invoices (household_id, paid_at)          WHERE deleted_at IS NULL AND paid_at IS NOT NULL;
CREATE INDEX invoices_purchase_idx   ON invoices (purchase_id)   WHERE purchase_id IS NOT NULL;
CREATE INDEX invoices_recurrence_idx ON invoices (recurrence_id) WHERE recurrence_id IS NOT NULL;

-- Dados do boleto (1:1 com a invoice). Nunca guarda o arquivo, só o que foi extraído.
-- Duplicidade (mesma linha digitável) é verificada no serviço contra invoices não apagadas.
CREATE TABLE invoice_boletos (
    invoice_id            uuid        PRIMARY KEY,
    household_id          uuid        NOT NULL,
    digitable_line        text        NOT NULL CHECK (digitable_line ~ '^[0-9]{47,48}$'),
    barcode               text        CHECK (barcode ~ '^[0-9]{44}$'),
    beneficiary_name      text,
    document_amount_cents bigint      CHECK (document_amount_cents > 0),
    document_due_date     date,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (household_id, invoice_id) REFERENCES invoices (household_id, id) ON DELETE CASCADE
);
CREATE INDEX invoice_boletos_line_idx ON invoice_boletos (household_id, digitable_line);

-- ---------------------------------------------------------------------------
-- Receitas: fonte recorrente (previsão) e lançamentos mensais
-- ---------------------------------------------------------------------------

-- Define uma receita recorrente de uma pessoa (salário, VR...). Gera um lançamento por mês até um horizonte,
-- já com a previsão (bruto + descontos do template), editável mês a mês.
CREATE TABLE income_sources (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id       uuid        NOT NULL REFERENCES households (id),
    user_id            uuid        NOT NULL,
    kind               text        NOT NULL CHECK (kind IN ('salary', 'benefit', 'other')),
    name               text        NOT NULL,
    wallet             text        NOT NULL CHECK (wallet IN ('free', 'benefit')),
    gross_amount_cents bigint      NOT NULL CHECK (gross_amount_cents > 0),
    day_of_month       smallint    NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
    start_month        date        NOT NULL CHECK (EXTRACT(DAY FROM start_month) = 1),
    end_month          date        CHECK (EXTRACT(DAY FROM end_month) = 1),
    generated_through  date        NOT NULL CHECK (EXTRACT(DAY FROM generated_through) = 1),
    notes              text,
    created_by         uuid        NOT NULL REFERENCES users (id),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    deleted_at         timestamptz,
    CHECK (end_month IS NULL OR end_month >= start_month),
    CHECK ((kind = 'benefit') = (wallet = 'benefit')),
    UNIQUE (household_id, id),
    FOREIGN KEY (household_id, user_id) REFERENCES household_members (household_id, user_id)
);

-- Descontos do template da fonte (INSS, IRRF, plano, coparticipação média...).
CREATE TABLE income_source_deductions (
    id           uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id uuid     NOT NULL,
    source_id    uuid     NOT NULL,
    kind         text     NOT NULL CHECK (kind IN ('inss', 'irrf', 'health_plan', 'health_copay', 'other')),
    name         text     NOT NULL,
    amount_cents bigint   NOT NULL CHECK (amount_cents > 0),
    position     smallint NOT NULL DEFAULT 0,
    FOREIGN KEY (household_id, source_id) REFERENCES income_sources (household_id, id) ON DELETE CASCADE
);
CREATE INDEX income_source_deductions_source_idx ON income_source_deductions (source_id);

-- Lançamento mensal. source_id nulo = receita avulsa. Líquido = bruto - soma dos descontos (calculado, não gravado).
CREATE TABLE incomes (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id       uuid        NOT NULL REFERENCES households (id),
    source_id          uuid,
    user_id            uuid        NOT NULL,
    kind               text        NOT NULL CHECK (kind IN ('salary', 'benefit', 'other')),
    description        text        NOT NULL,
    wallet             text        NOT NULL CHECK (wallet IN ('free', 'benefit')),
    competence_month   date        NOT NULL CHECK (EXTRACT(DAY FROM competence_month) = 1),
    expected_date      date        NOT NULL,
    gross_amount_cents bigint      NOT NULL CHECK (gross_amount_cents > 0),
    received_at        date,       -- nulo = previsto; preenchido = recebido
    notes              text,
    created_by         uuid        NOT NULL REFERENCES users (id),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    deleted_at         timestamptz,
    CHECK ((kind = 'benefit') = (wallet = 'benefit')),
    UNIQUE (household_id, id),
    FOREIGN KEY (household_id, source_id) REFERENCES income_sources (household_id, id),
    FOREIGN KEY (household_id, user_id)   REFERENCES household_members (household_id, user_id)
);
CREATE UNIQUE INDEX incomes_occurrence_uq ON incomes (source_id, competence_month) WHERE source_id IS NOT NULL;
CREATE INDEX incomes_competence_idx ON incomes (household_id, competence_month) WHERE deleted_at IS NULL;

CREATE TABLE income_deductions (
    id           uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id uuid     NOT NULL,
    income_id    uuid     NOT NULL,
    kind         text     NOT NULL CHECK (kind IN ('inss', 'irrf', 'health_plan', 'health_copay', 'other')),
    name         text     NOT NULL,
    amount_cents bigint   NOT NULL CHECK (amount_cents > 0),
    position     smallint NOT NULL DEFAULT 0,
    FOREIGN KEY (household_id, income_id) REFERENCES incomes (household_id, id) ON DELETE CASCADE
);
CREATE INDEX income_deductions_income_idx ON income_deductions (income_id);

-- +goose Down

DROP TABLE income_deductions;
DROP TABLE incomes;
DROP TABLE income_source_deductions;
DROP TABLE income_sources;
DROP TABLE invoice_boletos;
DROP TABLE invoices;
DROP TABLE recurrences;
DROP TABLE purchases;
DROP TABLE categories;
DROP TABLE password_reset_tokens;
DROP TABLE household_invites;
DROP TABLE household_members;
DROP TABLE households;
DROP TABLE sessions;
DROP TABLE users;
