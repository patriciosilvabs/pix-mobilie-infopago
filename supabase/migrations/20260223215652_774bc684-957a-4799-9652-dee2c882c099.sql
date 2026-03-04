
-- Fix 1: Restrict pix_configs SELECT to admin-only (remove member access to secrets)
DROP POLICY IF EXISTS "Members can view pix config" ON public.pix_configs;

-- Create a safe view for members (no secrets exposed)
CREATE OR REPLACE VIEW public.pix_configs_safe AS
SELECT 
  id, company_id, provider, pix_key, pix_key_type, is_active, is_sandbox, 
  base_url, purpose, webhook_url, provider_company_id, created_at, updated_at
FROM public.pix_configs;

-- Fix 2: Tighten receipts storage policies
DROP POLICY IF EXISTS "Authenticated users can upload receipts" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view receipts" ON storage.objects;

CREATE POLICY "Company members can view receipts"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'receipts'
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM public.companies
    WHERE id IN (SELECT public.get_user_companies(auth.uid()))
  )
);

CREATE POLICY "Company members can upload receipts"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'receipts'
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM public.companies
    WHERE id IN (SELECT public.get_user_companies(auth.uid()))
  )
);
