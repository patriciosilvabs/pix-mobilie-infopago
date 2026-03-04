
CREATE TABLE public.user_feature_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  feature_key text NOT NULL,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, company_id, feature_key)
);

ALTER TABLE public.user_feature_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage feature permissions"
ON public.user_feature_permissions
FOR ALL
USING (public.is_admin(auth.uid()));

CREATE POLICY "Users can view own feature permissions"
ON public.user_feature_permissions
FOR SELECT
USING (user_id = auth.uid());
