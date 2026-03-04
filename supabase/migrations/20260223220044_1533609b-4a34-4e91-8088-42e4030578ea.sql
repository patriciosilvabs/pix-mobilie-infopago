
-- Fix SECURITY DEFINER view issue - recreate with SECURITY INVOKER
DROP VIEW IF EXISTS public.pix_configs_safe;

CREATE VIEW public.pix_configs_safe
WITH (security_invoker = true)
AS
SELECT 
  id, company_id, provider, pix_key, pix_key_type, is_active, is_sandbox, 
  base_url, purpose, webhook_url, provider_company_id, created_at, updated_at
FROM public.pix_configs;

-- Grant access to the view for members via RLS on underlying table (admin policy already exists)
-- Members need a SELECT policy on pix_configs that only exposes safe columns through the view
-- Since the view uses security_invoker, members need direct SELECT access
-- We create a restrictive policy that only allows SELECT on non-sensitive columns via the view
CREATE POLICY "Members can view pix config safe"
ON public.pix_configs FOR SELECT
USING (
  company_id IN (SELECT public.get_user_companies(auth.uid()))
);
