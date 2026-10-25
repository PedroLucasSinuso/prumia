-- Investimentos como carteira especial (PT-5b): uma carteira com kind = 'investment' guarda o valor de um investimento
-- (CDB, Tesouro, poupança...). Aporte e resgate são transferências entre ela e uma carteira comum; o rendimento entra
-- pelo "Conferir saldo" (ajuste). Não paga conta, não recebe receita e não entra no saldo projetado do mês.
-- Regras em internal/wallet e docs/developer-guide/incomes-and-wallets.md. Sem backfill: toda carteira existente é 'regular'.

-- +goose Up

ALTER TABLE wallets
    ADD COLUMN kind        text NOT NULL DEFAULT 'regular' CHECK (kind IN ('regular', 'investment')),
    ADD COLUMN institution text CHECK (institution IS NULL OR char_length(institution) BETWEEN 1 AND 60),
    -- A carteira padrão recebe as contas sem carteira definida: não pode ser um investimento.
    ADD CONSTRAINT wallets_default_not_investment CHECK (NOT (is_default AND kind = 'investment'));

-- +goose Down
-- Com perda: as carteiras de investimento viram carteiras comuns (o saldo e o histórico continuam) e a instituição some.
ALTER TABLE wallets
    DROP CONSTRAINT wallets_default_not_investment,
    DROP COLUMN institution,
    DROP COLUMN kind;
