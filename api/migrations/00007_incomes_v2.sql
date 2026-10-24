-- Receitas v2: valor por unidade, regra de data (dia útil), recebimento automático ("não caiu") e corte de repetição.
-- Racional e regras em docs/developer-guide/incomes-and-wallets.md.
--
-- 100% aditiva: nada é removido nem renomeado. Os dados existentes migram sem ação do usuário:
--   * fontes atuais viram valor fixo + "dia N do mês" com weekend_adjust = 'none' (a data continua exatamente a de hoje);
--     fontes NOVAS nascem com 'forward' (o padrão da coluna);
--   * lançamentos gerados por uma fonte copiam a regra dela (para o detalhe mostrar "dia 5 do mês");
--   * received_at continua valendo como "recebida de propósito"; sem ele, a receita passa a contar como recebida
--     sozinha quando a data esperada chega (received_at/held_at: ver o doc).

-- +goose Up

ALTER TABLE income_sources
    ADD COLUMN amount_mode      text     NOT NULL DEFAULT 'fixed' CHECK (amount_mode IN ('fixed', 'per_unit')),
    ADD COLUMN unit_label       text,
    ADD COLUMN unit_price_cents bigint   CHECK (unit_price_cents > 0),
    ADD COLUMN date_rule        text     NOT NULL DEFAULT 'day_of_month'
        CHECK (date_rule IN ('day_of_month', 'nth_business_day', 'last_business_day')),
    ADD COLUMN date_rule_n      smallint,
    ADD COLUMN weekend_adjust   text     NOT NULL DEFAULT 'forward' CHECK (weekend_adjust IN ('forward', 'backward', 'none'));

-- Migração dos dados antigos: tudo vira "dia N do mês", sem ajuste (preserva a data de hoje).
UPDATE income_sources SET date_rule_n = day_of_month, weekend_adjust = 'none';

ALTER TABLE income_sources
    ADD CONSTRAINT income_sources_amount_mode_chk CHECK ((amount_mode = 'per_unit') = (unit_price_cents IS NOT NULL)),
    ADD CONSTRAINT income_sources_date_rule_chk CHECK (
        (date_rule = 'day_of_month'      AND date_rule_n BETWEEN 1 AND 31) OR
        (date_rule = 'nth_business_day'  AND date_rule_n BETWEEN 1 AND 23) OR
        (date_rule = 'last_business_day' AND date_rule_n IS NULL));

ALTER TABLE incomes
    ADD COLUMN held_at          timestamptz, -- "não caiu": o dinheiro previsto ainda não entrou (anula o recebimento automático)
    ADD COLUMN quantity         integer  CHECK (quantity > 0),
    ADD COLUMN unit_price_cents bigint   CHECK (unit_price_cents > 0),
    ADD COLUMN unit_label       text,
    ADD COLUMN date_rule        text     CHECK (date_rule IN ('day_of_month', 'nth_business_day', 'last_business_day')),
    ADD COLUMN date_rule_n      smallint,
    ADD COLUMN weekend_adjust   text     CHECK (weekend_adjust IN ('forward', 'backward', 'none')),
    ADD CONSTRAINT incomes_per_unit_chk CHECK ((quantity IS NULL) = (unit_price_cents IS NULL));

UPDATE incomes i
   SET date_rule = s.date_rule, date_rule_n = s.date_rule_n, weekend_adjust = s.weekend_adjust
  FROM income_sources s
 WHERE i.household_id = s.household_id AND i.source_id = s.id;

-- Registro dos cortes de repetição feitos por "excluir este e os seguintes" (igual a recurrence_cuts), para o Desfazer
-- devolver o fim anterior da fonte.
CREATE TABLE income_source_cuts (
    household_id       uuid        NOT NULL,
    source_id          uuid        NOT NULL,
    batch_deleted_at   timestamptz NOT NULL, -- = incomes.deleted_at dos lançamentos excluídos no lote
    previous_end_month date,                 -- fim antes do corte (NULL = sem fim)
    cut_end_month      date,                 -- fim gravado pelo corte (NULL = o corte excluiu a fonte inteira)
    PRIMARY KEY (source_id, batch_deleted_at),
    FOREIGN KEY (household_id, source_id) REFERENCES income_sources (household_id, id) ON DELETE CASCADE
);

-- +goose Down

DROP TABLE income_source_cuts;

ALTER TABLE incomes
    DROP CONSTRAINT incomes_per_unit_chk,
    DROP COLUMN weekend_adjust,
    DROP COLUMN date_rule_n,
    DROP COLUMN date_rule,
    DROP COLUMN unit_label,
    DROP COLUMN unit_price_cents,
    DROP COLUMN quantity,
    DROP COLUMN held_at;

ALTER TABLE income_sources
    DROP CONSTRAINT income_sources_date_rule_chk,
    DROP CONSTRAINT income_sources_amount_mode_chk,
    DROP COLUMN weekend_adjust,
    DROP COLUMN date_rule_n,
    DROP COLUMN date_rule,
    DROP COLUMN unit_price_cents,
    DROP COLUMN unit_label,
    DROP COLUMN amount_mode;
