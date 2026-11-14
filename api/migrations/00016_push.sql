-- Avisos de vencimento por Web Push. Cada linha de push_subscriptions é um aparelho/navegador em que a pessoa ligou os
-- avisos. A assinatura fica presa à SESSÃO que a criou: sair da conta (ou a sessão ser apagada) desliga os avisos daquele
-- aparelho, sem depender de o navegador avisar. push_digests garante no máximo um aviso por pessoa, casa e dia.
-- Regras em docs/developer-guide/push-notifications.md.

-- +goose Up
CREATE TABLE push_subscriptions (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    session_hash bytea       NOT NULL REFERENCES sessions (token_hash) ON DELETE CASCADE,
    -- URL do serviço de push do navegador (Chrome/FCM, Firefox, Safari, Edge); o serviço valida o host antes de gravar.
    endpoint     text        NOT NULL CHECK (endpoint LIKE 'https://%' AND length(endpoint) <= 2000),
    -- Chaves do aparelho (base64url) usadas para cifrar o aviso de ponta a ponta. Nunca vão para log.
    p256dh       text        NOT NULL,
    auth         text        NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (endpoint)
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);
CREATE INDEX push_subscriptions_session_idx ON push_subscriptions (session_hash);

CREATE TABLE push_digests (
    user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    household_id uuid        NOT NULL REFERENCES households (id) ON DELETE CASCADE,
    day          date        NOT NULL,
    sent_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, household_id, day)
);

-- +goose Down
-- Com perda: os aparelhos deixam de receber avisos até a pessoa ligar de novo (nada das contas é afetado).
DROP TABLE push_digests;
DROP TABLE push_subscriptions;
