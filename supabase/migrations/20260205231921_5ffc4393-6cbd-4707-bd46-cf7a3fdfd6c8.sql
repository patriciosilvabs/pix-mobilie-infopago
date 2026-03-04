-- ==============================================
-- SISTEMA DE GESTÃO DE PAGAMENTOS COM LASTRO CONTÁBIL
-- Schema completo com RBAC, multi-empresa e auditoria
-- ==============================================

-- 1. ENUM TYPES
-- ==============================================

-- Roles do sistema
CREATE TYPE public.app_role AS ENUM ('admin', 'operator');

-- Tipos de classificação contábil
CREATE TYPE public.classification_type AS ENUM ('cost', 'expense');

-- Status da transação
CREATE TYPE public.transaction_status AS ENUM ('pending', 'completed', 'failed', 'cancelled');

-- Tipo de Pix
CREATE TYPE public.pix_type AS ENUM ('key', 'copy_paste', 'qrcode');

-- Tipo de chave Pix
CREATE TYPE public.pix_key_type AS ENUM ('cpf', 'cnpj', 'email', 'phone', 'random');

-- Status do comprovante
CREATE TYPE public.receipt_status AS ENUM ('pending', 'processing', 'completed', 'failed');


-- 2. PROFILES TABLE (user data)
-- ==============================================
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    avatar_url TEXT,
    phone TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;


-- 3. USER ROLES TABLE (RBAC)
-- ==============================================
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL DEFAULT 'operator',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;


-- 4. COMPANIES TABLE (multi-empresa)
-- ==============================================
CREATE TABLE public.companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    cnpj TEXT,
    logo_url TEXT,
    address TEXT,
    phone TEXT,
    email TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;


-- 5. COMPANY MEMBERS TABLE (relação user-company)
-- ==============================================
CREATE TABLE public.company_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    payment_limit DECIMAL(15, 2) DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, user_id)
);

ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;


-- 6. BANK ACCOUNTS TABLE (contas bancárias)
-- ==============================================
CREATE TABLE public.bank_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    bank_name TEXT NOT NULL,
    agency TEXT,
    account_number TEXT,
    pix_key TEXT,
    pix_key_type pix_key_type,
    balance DECIMAL(15, 2) NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;


-- 7. CATEGORIES TABLE (plano de contas)
-- ==============================================
CREATE TABLE public.categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    classification classification_type NOT NULL,
    parent_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    keywords TEXT[] DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;


-- 8. TRANSACTIONS TABLE (pagamentos Pix)
-- ==============================================
CREATE TABLE public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
    bank_account_id UUID REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL NOT NULL,
    classified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    
    -- Dados do Pix
    pix_type pix_type NOT NULL,
    pix_key TEXT,
    pix_key_type pix_key_type,
    pix_copy_paste TEXT,
    
    -- Dados do pagamento
    amount DECIMAL(15, 2) NOT NULL,
    description TEXT,
    beneficiary_name TEXT,
    beneficiary_document TEXT,
    
    -- Status
    status transaction_status NOT NULL DEFAULT 'pending',
    external_id TEXT,
    
    -- Timestamps
    paid_at TIMESTAMPTZ,
    classified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;


-- 9. RECEIPTS TABLE (comprovantes)
-- ==============================================
CREATE TABLE public.receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID REFERENCES public.transactions(id) ON DELETE CASCADE NOT NULL,
    uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL NOT NULL,
    
    -- Arquivo
    file_url TEXT NOT NULL,
    file_type TEXT,
    file_name TEXT,
    
    -- Dados extraídos por OCR
    ocr_status receipt_status NOT NULL DEFAULT 'pending',
    ocr_data JSONB DEFAULT '{}',
    extracted_cnpj TEXT,
    extracted_date DATE,
    extracted_value DECIMAL(15, 2),
    extracted_access_key TEXT,
    
    -- Metadados de auditoria
    capture_latitude DECIMAL(10, 8),
    capture_longitude DECIMAL(11, 8),
    capture_timestamp TIMESTAMPTZ,
    device_info JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;


-- 10. AUDIT LOGS TABLE (logs de auditoria)
-- ==============================================
CREATE TABLE public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    old_data JSONB,
    new_data JSONB,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;


-- ==============================================
-- 11. SECURITY DEFINER FUNCTIONS (para evitar recursão RLS)
-- ==============================================

-- Função para verificar se usuário tem uma role
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_roles
        WHERE user_id = _user_id
          AND role = _role
    )
$$;

-- Função para verificar se usuário é admin
CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.has_role(_user_id, 'admin')
$$;

-- Função para verificar se usuário pertence a uma empresa
CREATE OR REPLACE FUNCTION public.is_company_member(_user_id UUID, _company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.company_members
        WHERE user_id = _user_id
          AND company_id = _company_id
          AND is_active = true
    )
$$;

-- Função para obter empresas do usuário
CREATE OR REPLACE FUNCTION public.get_user_companies(_user_id UUID)
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT company_id
    FROM public.company_members
    WHERE user_id = _user_id
      AND is_active = true
$$;


-- ==============================================
-- 12. RLS POLICIES
-- ==============================================

-- Profiles: usuários podem ver e editar seu próprio perfil, admins veem todos
CREATE POLICY "Users can view own profile"
ON public.profiles FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Users can insert own profile"
ON public.profiles FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- User Roles: apenas admins podem gerenciar roles
CREATE POLICY "Admins can view all roles"
ON public.user_roles FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()) OR user_id = auth.uid());

CREATE POLICY "Admins can manage roles"
ON public.user_roles FOR ALL
TO authenticated
USING (public.is_admin(auth.uid()));

-- Companies: membros podem ver suas empresas
CREATE POLICY "Members can view their companies"
ON public.companies FOR SELECT
TO authenticated
USING (id IN (SELECT public.get_user_companies(auth.uid())));

CREATE POLICY "Admins can manage companies"
ON public.companies FOR ALL
TO authenticated
USING (public.is_admin(auth.uid()));

-- Company Members: admins podem gerenciar, membros podem ver
CREATE POLICY "Members can view company members"
ON public.company_members FOR SELECT
TO authenticated
USING (company_id IN (SELECT public.get_user_companies(auth.uid())));

CREATE POLICY "Admins can manage company members"
ON public.company_members FOR ALL
TO authenticated
USING (public.is_admin(auth.uid()));

-- Bank Accounts: membros podem ver, admins podem gerenciar
CREATE POLICY "Members can view bank accounts"
ON public.bank_accounts FOR SELECT
TO authenticated
USING (company_id IN (SELECT public.get_user_companies(auth.uid())));

CREATE POLICY "Admins can manage bank accounts"
ON public.bank_accounts FOR ALL
TO authenticated
USING (public.is_admin(auth.uid()));

-- Categories: membros podem ver, admins podem gerenciar
CREATE POLICY "Members can view categories"
ON public.categories FOR SELECT
TO authenticated
USING (company_id IN (SELECT public.get_user_companies(auth.uid())));

CREATE POLICY "Admins can manage categories"
ON public.categories FOR ALL
TO authenticated
USING (public.is_admin(auth.uid()));

-- Transactions: membros podem ver/criar, admins podem gerenciar tudo
CREATE POLICY "Members can view transactions"
ON public.transactions FOR SELECT
TO authenticated
USING (company_id IN (SELECT public.get_user_companies(auth.uid())));

CREATE POLICY "Members can create transactions"
ON public.transactions FOR INSERT
TO authenticated
WITH CHECK (
    company_id IN (SELECT public.get_user_companies(auth.uid()))
    AND created_by = auth.uid()
);

CREATE POLICY "Users can update own transactions"
ON public.transactions FOR UPDATE
TO authenticated
USING (
    company_id IN (SELECT public.get_user_companies(auth.uid()))
    AND (created_by = auth.uid() OR public.is_admin(auth.uid()))
);

-- Receipts: membros podem ver/criar
CREATE POLICY "Members can view receipts"
ON public.receipts FOR SELECT
TO authenticated
USING (
    transaction_id IN (
        SELECT id FROM public.transactions
        WHERE company_id IN (SELECT public.get_user_companies(auth.uid()))
    )
);

CREATE POLICY "Members can create receipts"
ON public.receipts FOR INSERT
TO authenticated
WITH CHECK (
    uploaded_by = auth.uid()
    AND transaction_id IN (
        SELECT id FROM public.transactions
        WHERE company_id IN (SELECT public.get_user_companies(auth.uid()))
    )
);

CREATE POLICY "Members can update receipts"
ON public.receipts FOR UPDATE
TO authenticated
USING (
    transaction_id IN (
        SELECT id FROM public.transactions
        WHERE company_id IN (SELECT public.get_user_companies(auth.uid()))
    )
);

-- Audit Logs: apenas admins podem ver
CREATE POLICY "Admins can view audit logs"
ON public.audit_logs FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

CREATE POLICY "System can insert audit logs"
ON public.audit_logs FOR INSERT
TO authenticated
WITH CHECK (true);


-- ==============================================
-- 13. TRIGGERS PARA UPDATED_AT
-- ==============================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_companies_updated_at
    BEFORE UPDATE ON public.companies
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_company_members_updated_at
    BEFORE UPDATE ON public.company_members
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_bank_accounts_updated_at
    BEFORE UPDATE ON public.bank_accounts
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_categories_updated_at
    BEFORE UPDATE ON public.categories
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_transactions_updated_at
    BEFORE UPDATE ON public.transactions
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_receipts_updated_at
    BEFORE UPDATE ON public.receipts
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- ==============================================
-- 14. TRIGGER PARA CRIAR PERFIL AUTOMATICAMENTE
-- ==============================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (user_id, full_name, email)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
        NEW.email
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ==============================================
-- 15. STORAGE BUCKET PARA COMPROVANTES
-- ==============================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('receipts', 'receipts', false)
ON CONFLICT (id) DO NOTHING;

-- Políticas de storage
CREATE POLICY "Authenticated users can upload receipts"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'receipts');

CREATE POLICY "Authenticated users can view receipts"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'receipts');

CREATE POLICY "Authenticated users can update own receipts"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'receipts');


-- ==============================================
-- 16. INDEXES PARA PERFORMANCE
-- ==============================================

CREATE INDEX idx_transactions_company_id ON public.transactions(company_id);
CREATE INDEX idx_transactions_created_by ON public.transactions(created_by);
CREATE INDEX idx_transactions_status ON public.transactions(status);
CREATE INDEX idx_transactions_created_at ON public.transactions(created_at DESC);
CREATE INDEX idx_receipts_transaction_id ON public.receipts(transaction_id);
CREATE INDEX idx_receipts_ocr_status ON public.receipts(ocr_status);
CREATE INDEX idx_company_members_user_id ON public.company_members(user_id);
CREATE INDEX idx_company_members_company_id ON public.company_members(company_id);
CREATE INDEX idx_categories_company_id ON public.categories(company_id);
CREATE INDEX idx_audit_logs_company_id ON public.audit_logs(company_id);
CREATE INDEX idx_audit_logs_created_at ON public.audit_logs(created_at DESC);