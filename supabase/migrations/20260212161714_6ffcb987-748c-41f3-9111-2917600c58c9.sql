
-- Drop existing constraint if it exists and re-add with new providers
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pix_configs_provider_check') THEN
    ALTER TABLE pix_configs DROP CONSTRAINT pix_configs_provider_check;
  END IF;
END $$;

ALTER TABLE pix_configs ADD CONSTRAINT pix_configs_provider_check 
  CHECK (provider = ANY (ARRAY[
    'woovi', 'transfeera', 'onz', 'efi', 
    'inter', 'gerencianet', 'itau', 'bradesco', 
    'santander', 'sicredi', 'sicoob', 'outros'
  ]));
