-- Como o Bling controla o estoque de cada kit (produto com composição):
--  kit_stock_type: 'F' = o kit tem estoque físico próprio | 'V' = estoque virtual (calculado pelos componentes)
--  kit_stock_posting: 'P' = baixa só do kit | 'M' = baixa só dos componentes | 'A' = baixa de ambos
ALTER TABLE products ADD COLUMN kit_stock_type text;
ALTER TABLE products ADD COLUMN kit_stock_posting text;
