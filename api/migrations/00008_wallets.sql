-- Carteiras configuráveis da casa. Até a 00007 a carteira era um texto fixo ('free' ou 'benefit') em incomes,
-- income_sources, invoices.paid_wallet e categories.default_wallet. Agora é uma tabela (`wallets`) por casa.
-- Racional e regras em docs/developer-guide/incomes-and-wallets.md.
--
-- Backfill: toda casa existente ganha "Geral" (padrão, sem aviso de saldo) e "Benefício" (com aviso de saldo);
-- 'free' vira Geral e 'benefit' vira Benefício. Depois as colunas de texto e os CHECKs kind/wallet são removidos.
-- Sem hard delete: carteira com uso é arquivada (archived_at).

-- +goose Up

CREATE TABLE wallets (
    id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id          uuid        NOT NULL REFERENCES households (id),
    name                  text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
    owner_user_id         uuid,                                -- só etiqueta ("carteira da Ana"); não restringe nada
    is_default            boolean     NOT NULL DEFAULT false,  -- exatamente uma por casa (índice parcial abaixo)
    warn_on_overdraft     boolean     NOT NULL DEFAULT true,   -- avisa ao pagar se o saldo realizado ficar negativo
    opening_balance_cents bigint      NOT NULL DEFAULT 0,      -- saldo inicial; pode ser negativo
    sort_order            integer     NOT NULL DEFAULT 0,
    archived_at           timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    UNIQUE (household_id, id),
    FOREIGN KEY (household_id, owner_user_id) REFERENCES household_members (household_id, user_id),
    CONSTRAINT wallets_default_active CHECK (NOT is_default OR archived_at IS NULL)
);
CREATE UNIQUE INDEX wallets_default_uq ON wallets (household_id) WHERE is_default;
CREATE UNIQUE INDEX wallets_name_uq    ON wallets (household_id, lower(name)) WHERE archived_at IS NULL;

-- Backfill: as duas carteiras de sempre, em TODAS as casas (inclusive as excluídas, para os dados antigos fecharem).
INSERT INTO wallets (household_id, name, is_default, warn_on_overdraft, sort_order)
SELECT id, 'Geral', true, false, 0 FROM households;
INSERT INTO wallets (household_id, name, is_default, warn_on_overdraft, sort_order)
SELECT id, 'Benefício', false, true, 1 FROM households;

-- Receitas e fontes: wallet_id NOT NULL; os CHECKs (kind = 'benefit') = (wallet = 'benefit') caem junto com a coluna.
ALTER TABLE incomes        ADD COLUMN wallet_id uuid;
ALTER TABLE income_sources ADD COLUMN wallet_id uuid;
UPDATE incomes t SET wallet_id = w.id FROM wallets w
 WHERE w.household_id = t.household_id AND w.name = CASE t.wallet WHEN 'benefit' THEN 'Benefício' ELSE 'Geral' END;
UPDATE income_sources t SET wallet_id = w.id FROM wallets w
 WHERE w.household_id = t.household_id AND w.name = CASE t.wallet WHEN 'benefit' THEN 'Benefício' ELSE 'Geral' END;
ALTER TABLE incomes        ALTER COLUMN wallet_id SET NOT NULL;
ALTER TABLE income_sources ALTER COLUMN wallet_id SET NOT NULL;
ALTER TABLE incomes        ADD FOREIGN KEY (household_id, wallet_id) REFERENCES wallets (household_id, id);
ALTER TABLE income_sources ADD FOREIGN KEY (household_id, wallet_id) REFERENCES wallets (household_id, id);
ALTER TABLE incomes        DROP COLUMN wallet;
ALTER TABLE income_sources DROP COLUMN wallet;
CREATE INDEX incomes_wallet_idx ON incomes (household_id, wallet_id);

-- Invoices: paid_wallet_id anda junto de paid_at (CHECK refeito).
ALTER TABLE invoices ADD COLUMN paid_wallet_id uuid;
UPDATE invoices t SET paid_wallet_id = w.id FROM wallets w
 WHERE t.paid_wallet IS NOT NULL AND w.household_id = t.household_id
   AND w.name = CASE t.paid_wallet WHEN 'benefit' THEN 'Benefício' ELSE 'Geral' END;
ALTER TABLE invoices DROP CONSTRAINT invoices_paid_all_or_none;
ALTER TABLE invoices DROP COLUMN paid_wallet;
ALTER TABLE invoices ADD FOREIGN KEY (household_id, paid_wallet_id) REFERENCES wallets (household_id, id);
ALTER TABLE invoices ADD CONSTRAINT invoices_paid_all_or_none CHECK (
    (paid_at IS NULL AND paid_wallet_id IS NULL AND paid_amount_cents IS NULL AND paid_by_user_id IS NULL)
    OR (paid_at IS NOT NULL AND paid_wallet_id IS NOT NULL AND paid_amount_cents IS NOT NULL)
);
CREATE INDEX invoices_paid_wallet_idx ON invoices (household_id, paid_wallet_id) WHERE deleted_at IS NULL AND paid_at IS NOT NULL;

-- Categorias: carteira sugerida (opcional).
ALTER TABLE categories ADD COLUMN default_wallet_id uuid;
UPDATE categories t SET default_wallet_id = w.id FROM wallets w
 WHERE t.default_wallet IS NOT NULL AND w.household_id = t.household_id
   AND w.name = CASE t.default_wallet WHEN 'benefit' THEN 'Benefício' ELSE 'Geral' END;
ALTER TABLE categories DROP COLUMN default_wallet;
ALTER TABLE categories ADD FOREIGN KEY (household_id, default_wallet_id) REFERENCES wallets (household_id, id);

-- +goose Down
-- Volta aos dois valores de texto. É com perda: 'benefit' = a carteira de nome "Benefício"; qualquer outra vira 'free'.
-- Receitas e fontes do tipo benefit voltam para 'benefit' e as demais para 'free' (a regra antiga kind <-> wallet).

ALTER TABLE categories ADD COLUMN default_wallet text CHECK (default_wallet IN ('free', 'benefit'));
UPDATE categories t SET default_wallet = CASE WHEN w.name = 'Benefício' THEN 'benefit' ELSE 'free' END
  FROM wallets w WHERE t.default_wallet_id IS NOT NULL AND w.household_id = t.household_id AND w.id = t.default_wallet_id;
ALTER TABLE categories DROP COLUMN default_wallet_id;

DROP INDEX invoices_paid_wallet_idx;
ALTER TABLE invoices DROP CONSTRAINT invoices_paid_all_or_none;
ALTER TABLE invoices ADD COLUMN paid_wallet text CHECK (paid_wallet IN ('free', 'benefit'));
UPDATE invoices t SET paid_wallet = CASE WHEN w.name = 'Benefício' THEN 'benefit' ELSE 'free' END
  FROM wallets w WHERE t.paid_wallet_id IS NOT NULL AND w.household_id = t.household_id AND w.id = t.paid_wallet_id;
ALTER TABLE invoices DROP COLUMN paid_wallet_id;
ALTER TABLE invoices ADD CONSTRAINT invoices_paid_all_or_none CHECK (
    (paid_at IS NULL AND paid_wallet IS NULL AND paid_amount_cents IS NULL AND paid_by_user_id IS NULL)
    OR (paid_at IS NOT NULL AND paid_wallet IS NOT NULL AND paid_amount_cents IS NOT NULL)
);

DROP INDEX incomes_wallet_idx;
ALTER TABLE incomes        ADD COLUMN wallet text;
ALTER TABLE income_sources ADD COLUMN wallet text;
UPDATE incomes        SET wallet = CASE WHEN kind = 'benefit' THEN 'benefit' ELSE 'free' END;
UPDATE income_sources SET wallet = CASE WHEN kind = 'benefit' THEN 'benefit' ELSE 'free' END;
ALTER TABLE incomes        DROP COLUMN wallet_id;
ALTER TABLE income_sources DROP COLUMN wallet_id;
ALTER TABLE incomes        ALTER COLUMN wallet SET NOT NULL;
ALTER TABLE income_sources ALTER COLUMN wallet SET NOT NULL;
ALTER TABLE incomes        ADD CHECK (wallet IN ('free', 'benefit'));
ALTER TABLE income_sources ADD CHECK (wallet IN ('free', 'benefit'));
ALTER TABLE incomes        ADD CHECK ((kind = 'benefit') = (wallet = 'benefit'));
ALTER TABLE income_sources ADD CHECK ((kind = 'benefit') = (wallet = 'benefit'));

DROP TABLE wallets;
