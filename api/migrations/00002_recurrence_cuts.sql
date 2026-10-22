-- Registro dos cortes de recorrência feitos por "excluir esta e as seguintes", para o "Desfazer" devolver o fim anterior.
--
-- O lote de invoices excluídas já é identificado pelo deleted_at (o mesmo valor em todas as linhas do lote). O que
-- se perde ao encerrar a recorrência é o end_month de antes (pode ser NULL ou um mês posterior), e é só isso que guardamos.
-- Racional em docs/developer-guide/series-generation.md.

-- +goose Up

CREATE TABLE recurrence_cuts (
    household_id        uuid        NOT NULL,
    recurrence_id       uuid        NOT NULL,
    batch_deleted_at    timestamptz NOT NULL, -- = invoices.deleted_at das ocorrências excluídas no lote
    previous_end_month  date,                 -- fim antes do corte (NULL = sem fim)
    cut_end_month       date,                 -- fim gravado pelo corte (NULL = o corte excluiu a recorrência inteira)
    PRIMARY KEY (recurrence_id, batch_deleted_at),
    FOREIGN KEY (household_id, recurrence_id) REFERENCES recurrences (household_id, id) ON DELETE CASCADE
);

-- +goose Down

DROP TABLE recurrence_cuts;
