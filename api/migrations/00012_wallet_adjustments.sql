-- Ajustes de saldo ("Conferir saldo"): a pessoa informa o saldo REAL de uma carteira num mês e a diferença para o saldo
-- calculado vira um ajuste naquele mês. Não é receita nem despesa: só altera o saldo da carteira (o do mês e, por
-- carry-over, o dos meses seguintes). Regra em internal/summary e docs/developer-guide/incomes-and-wallets.md.
-- Exclusão lógica (deleted_at) com Desfazer; não há edição (para corrigir, exclui e confere de novo).

-- +goose Up

CREATE TABLE wallet_adjustments (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id     uuid        NOT NULL REFERENCES households (id),
    wallet_id        uuid        NOT NULL,
    competence_month date        NOT NULL CHECK (EXTRACT(day FROM competence_month) = 1),
    -- A diferença, com sinal: positivo = havia mais dinheiro do que o calculado; negativo = menos. Zero não é ajuste.
    amount_cents     bigint      NOT NULL CHECK (amount_cents <> 0),
    notes            text,
    created_by       uuid        NOT NULL REFERENCES users (id),
    created_at       timestamptz NOT NULL DEFAULT now(),
    deleted_at       timestamptz,
    -- FK composta: a carteira é obrigatoriamente da MESMA casa do ajuste.
    FOREIGN KEY (household_id, wallet_id) REFERENCES wallets (household_id, id)
);
CREATE INDEX wallet_adjustments_month_idx  ON wallet_adjustments (household_id, competence_month) WHERE deleted_at IS NULL;
CREATE INDEX wallet_adjustments_wallet_idx ON wallet_adjustments (household_id, wallet_id) WHERE deleted_at IS NULL;

-- +goose Down
-- Com perda: os ajustes deixam de existir (os saldos voltam a ser só receitas - despesas ± transferências).
DROP TABLE wallet_adjustments;
