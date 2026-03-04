ALTER TABLE pix_configs DROP CONSTRAINT pix_configs_provider_check;
ALTER TABLE pix_configs ADD CONSTRAINT pix_configs_provider_check 
  CHECK (provider = ANY (ARRAY['efi', 'onz', 'inter', 'gerencianet', 'itau', 'bradesco', 'santander', 'sicredi', 'sicoob', 'outros']));