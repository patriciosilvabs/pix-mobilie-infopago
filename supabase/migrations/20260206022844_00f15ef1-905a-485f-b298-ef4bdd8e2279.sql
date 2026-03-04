-- =============================================
-- PIX INTEGRATION TABLES
-- Tabelas para integração com API Pix (Padrão BCB)
-- =============================================

-- Tabela para armazenar tokens OAuth2 do provedor Pix
CREATE TABLE public.pix_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    access_token TEXT NOT NULL,
    token_type TEXT DEFAULT 'bearer',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index para busca rápida por empresa
CREATE INDEX idx_pix_tokens_company ON public.pix_tokens(company_id);

-- RLS para pix_tokens
ALTER TABLE public.pix_tokens ENABLE ROW LEVEL SECURITY;

-- Apenas admins podem gerenciar tokens
CREATE POLICY "Admins can manage pix tokens"
ON public.pix_tokens FOR ALL
USING (public.is_admin(auth.uid()));

-- =============================================
-- Tabela de configuração do provedor Pix por empresa
-- =============================================
CREATE TABLE public.pix_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID UNIQUE NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('inter', 'gerencianet', 'itau', 'bradesco', 'santander', 'sicredi', 'sicoob', 'outros')),
    client_id TEXT NOT NULL,
    client_secret_encrypted TEXT NOT NULL,
    base_url TEXT NOT NULL,
    pix_key TEXT NOT NULL,
    pix_key_type pix_key_type NOT NULL,
    certificate_encrypted TEXT,
    certificate_key_encrypted TEXT,
    webhook_url TEXT,
    webhook_secret TEXT,
    is_sandbox BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS para pix_configs
ALTER TABLE public.pix_configs ENABLE ROW LEVEL SECURITY;

-- Apenas admins podem gerenciar configurações
CREATE POLICY "Admins can manage pix configs"
ON public.pix_configs FOR ALL
USING (public.is_admin(auth.uid()));

-- Membros podem visualizar config da empresa (sem secrets)
CREATE POLICY "Members can view pix config"
ON public.pix_configs FOR SELECT
USING (company_id IN (SELECT public.get_user_companies(auth.uid())));

-- Trigger para updated_at
CREATE TRIGGER update_pix_configs_updated_at
BEFORE UPDATE ON public.pix_configs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- Tabela de devoluções Pix
-- =============================================
CREATE TABLE public.pix_refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
    e2eid TEXT NOT NULL,
    refund_id TEXT NOT NULL,
    valor NUMERIC NOT NULL CHECK (valor > 0),
    motivo TEXT,
    status TEXT NOT NULL DEFAULT 'EM_PROCESSAMENTO' CHECK (status IN ('EM_PROCESSAMENTO', 'DEVOLVIDO', 'NAO_REALIZADO')),
    refunded_at TIMESTAMPTZ,
    error_code TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES auth.users(id)
);

-- Index para busca por transação
CREATE INDEX idx_pix_refunds_transaction ON public.pix_refunds(transaction_id);
CREATE INDEX idx_pix_refunds_e2eid ON public.pix_refunds(e2eid);

-- RLS para pix_refunds
ALTER TABLE public.pix_refunds ENABLE ROW LEVEL SECURITY;

-- Admins podem gerenciar devoluções
CREATE POLICY "Admins can manage refunds"
ON public.pix_refunds FOR ALL
USING (public.is_admin(auth.uid()));

-- Membros podem visualizar devoluções de suas empresas
CREATE POLICY "Members can view refunds"
ON public.pix_refunds FOR SELECT
USING (
    transaction_id IN (
        SELECT id FROM public.transactions 
        WHERE company_id IN (SELECT public.get_user_companies(auth.uid()))
    )
);

-- =============================================
-- Adicionar colunas Pix na tabela transactions
-- =============================================
ALTER TABLE public.transactions
ADD COLUMN IF NOT EXISTS pix_txid TEXT,
ADD COLUMN IF NOT EXISTS pix_e2eid TEXT,
ADD COLUMN IF NOT EXISTS pix_location TEXT,
ADD COLUMN IF NOT EXISTS pix_qrcode TEXT,
ADD COLUMN IF NOT EXISTS pix_copia_cola TEXT,
ADD COLUMN IF NOT EXISTS pix_expiration TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS pix_provider_response JSONB DEFAULT '{}'::jsonb;

-- Index para busca por txid
CREATE INDEX IF NOT EXISTS idx_transactions_pix_txid ON public.transactions(pix_txid);
CREATE INDEX IF NOT EXISTS idx_transactions_pix_e2eid ON public.transactions(pix_e2eid);

-- =============================================
-- Tabela de log de webhooks Pix
-- =============================================
CREATE TABLE public.pix_webhook_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES public.companies(id),
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    ip_address TEXT,
    processed BOOLEAN DEFAULT false,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index para logs
CREATE INDEX idx_pix_webhook_logs_company ON public.pix_webhook_logs(company_id);
CREATE INDEX idx_pix_webhook_logs_created ON public.pix_webhook_logs(created_at DESC);

-- RLS para webhook logs
ALTER TABLE public.pix_webhook_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view webhook logs"
ON public.pix_webhook_logs FOR SELECT
USING (public.is_admin(auth.uid()));