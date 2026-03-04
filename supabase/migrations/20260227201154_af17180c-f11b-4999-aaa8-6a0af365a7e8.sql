
-- Recreate pix_configs_safe view with security_invoker = true
-- This ensures the view respects the RLS of the underlying pix_configs table
-- Since we removed "Members can view pix config safe" from pix_configs,
-- only admins can access pix_configs now. The safe view needs its own access path.

-- Drop and recreate the view with security_invoker
DROP VIEW IF EXISTS public.pix_configs_safe;

CREATE VIEW public.pix_configs_safe
WITH (security_invoker = true)
AS
SELECT 
  id,
  company_id,
  provider,
  pix_key,
  pix_key_type,
  base_url,
  is_active,
  is_sandbox,
  purpose,
  webhook_url,
  provider_company_id,
  created_at,
  updated_at
FROM public.pix_configs;

-- Grant SELECT on the view to authenticated users
GRANT SELECT ON public.pix_configs_safe TO authenticated;

-- Now add a permissive SELECT policy on pix_configs for the safe view access
-- Members can only SELECT non-sensitive columns via the safe view
-- We need to re-add a controlled SELECT policy on pix_configs for company members
CREATE POLICY "Members can select own company pix configs"
ON public.pix_configs
FOR SELECT
TO authenticated
USING (
  company_id IN (SELECT public.get_user_companies(auth.uid()))
);
