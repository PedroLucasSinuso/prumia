-- Receita que cai no MÊS ANTERIOR à competência (ex.: o vale-refeição de outubro, calculado com os dias úteis de outubro,
-- é recebido no último dia útil de setembro). A competência continua a mesma; só a DATA esperada muda de mês.
-- 0 = no mês da competência (comportamento de sempre); -1 = no mês anterior. Quem já tem dados fica em 0.

-- +goose Up

ALTER TABLE income_sources ADD COLUMN date_rule_offset smallint NOT NULL DEFAULT 0
    CONSTRAINT income_sources_date_rule_offset_check CHECK (date_rule_offset IN (-1, 0));
ALTER TABLE incomes ADD COLUMN date_rule_offset smallint NOT NULL DEFAULT 0
    CONSTRAINT incomes_date_rule_offset_check CHECK (date_rule_offset IN (-1, 0));

-- +goose Down

ALTER TABLE incomes DROP COLUMN date_rule_offset;
ALTER TABLE income_sources DROP COLUMN date_rule_offset;
