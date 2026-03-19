

## Plano: Remover registro automático de webhook Transfeera e usar configuração manual via painel ONZ

### Contexto do problema

O botão "Registrar Webhook" e o registro automático após teste de conexão chamam a Edge Function `register-transfeera-webhook`, que autentica na API da **Transfeera** (um provedor diferente da ONZ). Como o sistema agora usa exclusivamente ONZ Infopago, essas credenciais Transfeera retornam 401 Unauthorized. A ONZ não tem API para registro de webhook -- é feito manualmente no painel.

### Mudanças

**1. Remover a Edge Function `register-transfeera-webhook`**
- Deletar `supabase/functions/register-transfeera-webhook/index.ts`

**2. Atualizar `src/pages/settings/PixIntegration.tsx`**
- Remover a função `handleRegisterWebhook` e o estado `isRegisteringWebhook`
- Remover a chamada automática `handleRegisterWebhook(true)` de dentro de `handleTestConnection` (linhas 300-304)
- Remover o botão "Registrar" do card de Webhook (linha 479-482)
- Adicionar instruções textuais orientando o usuário a configurar o webhook manualmente no painel ONZ:
  - Evento: `Transferência` e `Fila de Saída de Pagamentos`
  - Método: POST
  - URL: a URL exibida no campo (copiável)
  - Header: `x-webhook-secret: <valor configurado>`
- Simplificar a mensagem de sucesso no teste de conexão (sem mencionar webhook)

