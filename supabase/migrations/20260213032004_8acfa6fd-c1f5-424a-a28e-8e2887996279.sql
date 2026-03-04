
-- Create user_page_permissions table
CREATE TABLE public.user_page_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  page_key text NOT NULL,
  has_access boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, company_id, page_key)
);

-- Enable RLS
ALTER TABLE public.user_page_permissions ENABLE ROW LEVEL SECURITY;

-- Admins can manage all permissions
CREATE POLICY "Admins can manage page permissions"
ON public.user_page_permissions
FOR ALL
USING (public.is_admin(auth.uid()));

-- Users can view their own permissions
CREATE POLICY "Users can view own permissions"
ON public.user_page_permissions
FOR SELECT
USING (user_id = auth.uid());

-- Insert default permissions for existing company members
INSERT INTO public.user_page_permissions (user_id, company_id, page_key, has_access)
SELECT cm.user_id, cm.company_id, p.page_key, true
FROM public.company_members cm
CROSS JOIN (VALUES ('dashboard'), ('new_payment'), ('transactions'), ('categories'), ('reports'), ('users'), ('companies'), ('settings')) AS p(page_key)
ON CONFLICT DO NOTHING;
