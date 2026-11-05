-- Tipo do item no Bling: P = produto, S = serviço, N = serviço (06/21/22). Serviços não têm estoque.
ALTER TABLE products ADD COLUMN kind text NOT NULL DEFAULT 'P';
