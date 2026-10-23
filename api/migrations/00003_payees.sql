-- Favorecidos: quem recebe o pagamento (empresa ou pessoa), com o NOME QUE A CASA ESCOLHE ("Gás" para a distribuidora).
-- O CNPJ é opcional e serve para reconhecer o favorecido num boleto. Aditiva: nada existente muda de significado,
-- invoices.payee_id é nullable e dispensa backfill.

-- +goose Up

CREATE TABLE payees (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id        uuid        NOT NULL REFERENCES households (id),
    name                text        NOT NULL,                 -- apelido escolhido pela casa
    cnpj                text        CHECK (cnpj ~ '^[0-9]{14}$'), -- só dígitos; validado (DVs) no serviço
    legal_name          text,                                 -- razão social, informativa
    default_category_id uuid,                                 -- sugestão ao lançar uma conta deste favorecido
    archived_at         timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    deleted_at          timestamptz,
    UNIQUE (household_id, id),
    FOREIGN KEY (household_id, default_category_id) REFERENCES categories (household_id, id)
);
CREATE UNIQUE INDEX payees_name_uq ON payees (household_id, lower(name)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX payees_cnpj_uq ON payees (household_id, cnpj) WHERE cnpj IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE invoices ADD COLUMN payee_id uuid;
ALTER TABLE invoices ADD FOREIGN KEY (household_id, payee_id) REFERENCES payees (household_id, id);
CREATE INDEX invoices_payee_idx ON invoices (household_id, payee_id) WHERE payee_id IS NOT NULL;

-- +goose Down

DROP INDEX invoices_payee_idx;
ALTER TABLE invoices DROP COLUMN payee_id;
DROP TABLE payees;
