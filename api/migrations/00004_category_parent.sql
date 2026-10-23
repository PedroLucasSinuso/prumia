-- Subcategorias: uma categoria pode ficar dentro de outra (ex.: Gás dentro de Moradia). Só DOIS níveis (regra no serviço:
-- a mãe é sempre de topo). Aditiva: o que existe continua no topo, sem backfill. A conta continua ligada a UMA categoria
-- (a mais específica); a soma da mãe é feita na leitura.

-- +goose Up

ALTER TABLE categories ADD COLUMN parent_id uuid;
ALTER TABLE categories ADD FOREIGN KEY (household_id, parent_id) REFERENCES categories (household_id, id);
ALTER TABLE categories ADD CONSTRAINT categories_parent_not_self CHECK (parent_id IS NULL OR parent_id <> id);

-- O nome passa a ser único DENTRO da mãe (várias mães podem ter um "Outros"); no topo, único como antes.
DROP INDEX categories_name_uq;
CREATE UNIQUE INDEX categories_name_uq ON categories (household_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX categories_parent_idx ON categories (household_id, parent_id) WHERE parent_id IS NOT NULL;

-- +goose Down

DROP INDEX categories_parent_idx;
DROP INDEX categories_name_uq;
ALTER TABLE categories DROP COLUMN parent_id; -- as filhas voltam ao topo
CREATE UNIQUE INDEX categories_name_uq ON categories (household_id, lower(name)) WHERE deleted_at IS NULL;
