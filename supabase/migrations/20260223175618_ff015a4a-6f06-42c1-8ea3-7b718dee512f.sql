-- Add separate certificate fields for cash-in and cash-out purposes
ALTER TABLE public.pix_configs
  ADD COLUMN IF NOT EXISTS certificate_cash_in TEXT,
  ADD COLUMN IF NOT EXISTS certificate_key_cash_in TEXT,
  ADD COLUMN IF NOT EXISTS certificate_cash_out TEXT,
  ADD COLUMN IF NOT EXISTS certificate_key_cash_out TEXT;

COMMENT ON COLUMN public.pix_configs.certificate_cash_in IS 'Certificado mTLS PEM para operações de recebimento (cash-in)';
COMMENT ON COLUMN public.pix_configs.certificate_key_cash_in IS 'Chave privada PEM para operações de recebimento (cash-in)';
COMMENT ON COLUMN public.pix_configs.certificate_cash_out IS 'Certificado mTLS PEM para operações de pagamento (cash-out)';
COMMENT ON COLUMN public.pix_configs.certificate_key_cash_out IS 'Chave privada PEM para operações de pagamento (cash-out)';