

## Problema

Ao clicar em "Confirmar Pagamento", aparece o erro "Você precisa estar logado e ter uma empresa selecionada" porque o `resolvePaymentContext` exige que tanto a sessão quanto o `companyId` estejam disponíveis. A sessão vem do Firebase (`auth.currentUser`), que pode estar `null` em determinados momentos de timing, mesmo com o usuário autenticado.

No entanto, a função `supabase.functions.invoke()` já obtém o token Firebase diretamente via `getIdToken(auth.currentUser)` no momento da chamada — tornando a verificação de sessão no `resolvePaymentContext` redundante e causa do erro.

## Plano

### 1. Simplificar `resolvePaymentContext` em `usePixPayment.ts`

Remover a verificação de sessão. Manter apenas a verificação de `companyId` (do contexto React ou localStorage). A autenticação já é tratada automaticamente pelo `supabase.functions.invoke()` que injeta o token Bearer.

```typescript
const resolvePaymentContext = useCallback(async (showToast = true) => {
  const companyId = currentCompany?.id ?? localStorage.getItem("currentCompanyId");

  if (!companyId) {
    if (showToast) {
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Nenhuma empresa selecionada.",
      });
    }
    return null;
  }

  return { companyId };
}, [currentCompany?.id, toast]);
```

### 2. Aplicar a mesma correção em `useBilletPayment.ts`

Mesma simplificação — remover a verificação de sessão do `resolvePaymentContext`, manter apenas a verificação de `companyId`.

### Arquivos modificados
- `src/hooks/usePixPayment.ts` — simplificar `resolvePaymentContext`
- `src/hooks/useBilletPayment.ts` — simplificar `resolvePaymentContext`

