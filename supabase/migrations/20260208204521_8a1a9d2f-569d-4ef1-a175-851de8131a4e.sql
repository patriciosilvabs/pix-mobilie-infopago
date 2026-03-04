ALTER TYPE pix_type ADD VALUE 'boleto';
ALTER TABLE transactions ADD COLUMN boleto_code text;