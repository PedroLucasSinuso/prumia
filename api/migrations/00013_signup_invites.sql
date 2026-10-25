-- Convite de cadastro: um link de uso único, com validade, para alguém criar a PRÓPRIA conta e a própria casa (o cadastro
-- sem convite vale só para o primeiro usuário). Quem gera é o "dono do sistema": a primeira conta criada.
-- Regras em docs/developer-guide/authentication.md.

-- +goose Up

-- Dono do sistema: no máximo um (índice único parcial). Backfill: a conta mais antiga não excluída.
ALTER TABLE users ADD COLUMN is_system_owner boolean NOT NULL DEFAULT false;
UPDATE users SET is_system_owner = true
 WHERE id = (SELECT id FROM users WHERE deleted_at IS NULL ORDER BY created_at, id LIMIT 1);
CREATE UNIQUE INDEX users_one_system_owner ON users ((true)) WHERE is_system_owner;

-- Mesmo desenho dos convites de casa: só o hash SHA-256 do token, uso único, validade e revogação.
CREATE TABLE signup_invites (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash bytea       NOT NULL UNIQUE,
    created_by uuid        NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    used_at    timestamptz,
    used_by    uuid        REFERENCES users (id),
    revoked_at timestamptz,
    CHECK ((used_at IS NULL) = (used_by IS NULL)),
    CHECK (expires_at > created_at)
);
CREATE INDEX signup_invites_pending_idx ON signup_invites (created_by) WHERE used_at IS NULL AND revoked_at IS NULL;

-- +goose Down
-- Com perda: os convites de cadastro e a marca de dono do sistema somem (o cadastro volta a valer só para o primeiro usuário).
DROP TABLE signup_invites;
DROP INDEX users_one_system_owner;
ALTER TABLE users DROP COLUMN is_system_owner;
