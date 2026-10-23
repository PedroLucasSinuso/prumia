-- Tema de cor da conta (Ajustes > Aparência): vale em todos os aparelhos da pessoa. O navegador guarda uma cópia
-- (cache) para aplicar antes do app carregar. Aditiva: quem já existe fica em 'sistema' (segue o modo claro/escuro
-- do aparelho), sem backfill.

-- +goose Up

ALTER TABLE users ADD COLUMN theme text NOT NULL DEFAULT 'sistema'
    CONSTRAINT users_theme_valid CHECK (theme IN ('sistema', 'marfim', 'grafite', 'contraste'));

-- +goose Down

ALTER TABLE users DROP COLUMN theme;
