-- Transferências entre carteiras da casa (guardar R$ 500 do Geral na Reserva, tirar de lá). Não é receita nem despesa:
-- só move saldo de uma carteira para outra (ver internal/summary e docs/developer-guide/incomes-and-wallets.md).
-- Exclusão lógica (deleted_at) com Desfazer; não há edição.

-- +goose Up

CREATE TABLE wallet_transfers (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id     uuid        NOT NULL REFERENCES households (id),
    from_wallet_id   uuid        NOT NULL,
    to_wallet_id     uuid        NOT NULL,
    amount_cents     bigint      NOT NULL CHECK (amount_cents > 0),
    transfer_date    date        NOT NULL,
    competence_month date        NOT NULL CHECK (EXTRACT(day FROM competence_month) = 1),
    notes            text,
    created_by       uuid        NOT NULL REFERENCES users (id),
    created_at       timestamptz NOT NULL DEFAULT now(),
    deleted_at       timestamptz,
    -- FKs compostas: as duas carteiras são obrigatoriamente da MESMA casa da transferência.
    FOREIGN KEY (household_id, from_wallet_id) REFERENCES wallets (household_id, id),
    FOREIGN KEY (household_id, to_wallet_id)   REFERENCES wallets (household_id, id),
    CONSTRAINT wallet_transfers_distinct CHECK (from_wallet_id <> to_wallet_id)
);
CREATE INDEX wallet_transfers_month_idx ON wallet_transfers (household_id, competence_month) WHERE deleted_at IS NULL;
CREATE INDEX wallet_transfers_from_idx  ON wallet_transfers (household_id, from_wallet_id) WHERE deleted_at IS NULL;
CREATE INDEX wallet_transfers_to_idx    ON wallet_transfers (household_id, to_wallet_id) WHERE deleted_at IS NULL;

-- +goose Down
-- Com perda: as transferências deixam de existir (os saldos voltam a ser só receitas - despesas).
DROP TABLE wallet_transfers;
