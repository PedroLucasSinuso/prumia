-- Temas viram paletas completas (Marfim, Solarized, Latte, Dracula, Nord, Gruvbox, Rosé Pine, Alto contraste, Sistema).
-- "grafite" (o escuro antigo) deixa de existir: quem o escolheu volta ao Marfim. O padrão de quem entra agora é o Marfim
-- (a identidade da marca), e não mais "sistema". Quem escolheu "contraste" continua nele (agora um preto e branco de verdade).

-- +goose Up

ALTER TABLE users DROP CONSTRAINT users_theme_valid;
UPDATE users SET theme = 'marfim' WHERE theme = 'grafite';
ALTER TABLE users ADD CONSTRAINT users_theme_valid CHECK (theme IN
    ('marfim', 'solarized', 'latte', 'dracula', 'nord', 'gruvbox', 'rosepine', 'contraste', 'sistema'));
ALTER TABLE users ALTER COLUMN theme SET DEFAULT 'marfim';

-- +goose Down

ALTER TABLE users DROP CONSTRAINT users_theme_valid;
-- Temas novos não existem na versão anterior: voltam ao Marfim.
UPDATE users SET theme = 'marfim' WHERE theme NOT IN ('sistema', 'marfim', 'contraste');
ALTER TABLE users ADD CONSTRAINT users_theme_valid CHECK (theme IN ('sistema', 'marfim', 'grafite', 'contraste'));
ALTER TABLE users ALTER COLUMN theme SET DEFAULT 'sistema';
