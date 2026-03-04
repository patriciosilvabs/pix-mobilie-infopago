
-- Add provider_company_id column to pix_configs for providers that need a separate company identifier (e.g. Paggue X-Company-ID)
ALTER TABLE public.pix_configs ADD COLUMN IF NOT EXISTS provider_company_id text;

-- Update the provider check constraint to include 'paggue'
ALTER TABLE public.pix_configs DROP CONSTRAINT IF EXISTS pix_configs_provider_check;
ALTER TABLE public.pix_configs ADD CONSTRAINT pix_configs_provider_check CHECK (provider IN ('woovi', 'onz', 'transfeera', 'efi', 'paggue'));
