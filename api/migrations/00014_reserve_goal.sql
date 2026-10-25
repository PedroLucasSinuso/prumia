-- Meta da reserva de emergência (PT-5a): a casa define quantos MESES de gasto essencial quer guardados e quais carteiras
-- contam como reserva. O progresso é calculado (saldo das carteiras de reserva ÷ gasto essencial médio), nada é gravado.
-- Configuração opcional: casa sem meta (NULL) não vê nada novo. Regras em docs/developer-guide/incomes-and-wallets.md.

-- +goose Up
ALTER TABLE households ADD COLUMN reserve_target_months smallint
    CHECK (reserve_target_months IS NULL OR reserve_target_months BETWEEN 1 AND 36);
ALTER TABLE wallets ADD COLUMN counts_as_reserve boolean NOT NULL DEFAULT false;

-- +goose Down
-- Com perda: a meta e a marcação das carteiras de reserva somem (saldos, contas e receitas ficam).
ALTER TABLE wallets DROP COLUMN counts_as_reserve;
ALTER TABLE households DROP COLUMN reserve_target_months;
