
-- 1. Create enum for purpose
DO $$ BEGIN
  CREATE TYPE pix_config_purpose AS ENUM ('cash_in', 'cash_out', 'both');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Add purpose column to pix_configs
ALTER TABLE public.pix_configs 
ADD COLUMN IF NOT EXISTS purpose pix_config_purpose NOT NULL DEFAULT 'both';

-- 3. Drop the existing unique constraint on company_id
ALTER TABLE public.pix_configs DROP CONSTRAINT IF EXISTS pix_configs_company_id_key;

-- 4. Create new composite unique constraint
ALTER TABLE public.pix_configs 
ADD CONSTRAINT pix_configs_company_id_purpose_key UNIQUE (company_id, purpose);

-- 5. Add pix_config_id to pix_tokens
ALTER TABLE public.pix_tokens 
ADD COLUMN IF NOT EXISTS pix_config_id uuid REFERENCES public.pix_configs(id) ON DELETE CASCADE;

-- 6. Link existing tokens to their configs
UPDATE public.pix_tokens pt
SET pix_config_id = (
  SELECT pc.id FROM public.pix_configs pc 
  WHERE pc.company_id = pt.company_id 
  LIMIT 1
)
WHERE pt.pix_config_id IS NULL;
