-- Função para auto-atribuir role no cadastro de novos usuários
-- O primeiro usuário vira admin, os demais viram operator
CREATE OR REPLACE FUNCTION public.handle_first_user_role()
RETURNS TRIGGER AS $$
DECLARE
    user_count INTEGER;
BEGIN
    -- Contar roles existentes (proxy para usuários ativos)
    SELECT COUNT(*) INTO user_count FROM public.user_roles;
    
    -- Se for o primeiro usuário, é admin
    IF user_count = 0 THEN
        INSERT INTO public.user_roles (user_id, role)
        VALUES (NEW.id, 'admin');
    ELSE
        INSERT INTO public.user_roles (user_id, role)
        VALUES (NEW.id, 'operator');
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Criar trigger no auth.users para novos cadastros
CREATE TRIGGER on_auth_user_created_assign_role
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_first_user_role();