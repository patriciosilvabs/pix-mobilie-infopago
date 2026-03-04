-- Corrigir política de audit_logs para ser mais restritiva
-- Remove política permissiva e cria uma mais segura

DROP POLICY IF EXISTS "System can insert audit logs" ON public.audit_logs;

-- Criar política mais restritiva: usuários podem inserir logs para suas empresas
CREATE POLICY "Users can insert audit logs for their companies"
ON public.audit_logs FOR INSERT
TO authenticated
WITH CHECK (
    company_id IS NULL 
    OR company_id IN (SELECT public.get_user_companies(auth.uid()))
);