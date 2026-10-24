-- Mês de início do saldo inicial da carteira: "o saldo inicial (o dinheiro real que havia na carteira) vale a partir deste
-- mês". Quem começa a usar o app no meio da vida financeira não precisa lançar o passado para o saldo fechar.
-- NULL = comportamento de sempre (o saldo inicial entra em todos os meses); nenhuma carteira existente muda.
-- Regra em docs/developer-guide/incomes-and-wallets.md.

-- +goose Up
ALTER TABLE wallets ADD COLUMN opening_balance_month date;
ALTER TABLE wallets ADD CONSTRAINT wallets_opening_month_day1
    CHECK (opening_balance_month IS NULL OR EXTRACT(day FROM opening_balance_month) = 1);

-- +goose Down
-- Com perda: o mês de início é descartado e o saldo inicial volta a valer em todos os meses.
ALTER TABLE wallets DROP CONSTRAINT wallets_opening_month_day1;
ALTER TABLE wallets DROP COLUMN opening_balance_month;
