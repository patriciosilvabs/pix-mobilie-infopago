# Integração ONZ Infopago — Documentação Técnica Completa

> **Última atualização:** 2026-02-26  
> **Provedor exclusivo:** ONZ Infopago (Banco Digital)  
> **Protocolo:** API REST v2 com autenticação OAuth2 + mTLS via proxy  

---

## Índice

1. [Arquitetura Geral](#1-arquitetura-geral)
2. [Proxy mTLS (Node.js)](#2-proxy-mtls-nodejs)
3. [Secrets / Variáveis de Ambiente](#3-secrets--variáveis-de-ambiente)
4. [Banco de Dados — Tabelas Principais](#4-banco-de-dados--tabelas-principais)
5. [Autenticação OAuth2 (pix-auth)](#5-autenticação-oauth2-pix-auth)
6. [Consulta de Saldo (pix-balance)](#6-consulta-de-saldo-pix-balance)
7. [Pagamento Pix por Chave (pix-pay-dict)](#7-pagamento-pix-por-chave-pix-pay-dict)
8. [Pagamento Pix por QR Code (pix-pay-qrc)](#8-pagamento-pix-por-qr-code-pix-pay-qrc)
9. [Decodificação de QR Code (pix-qrc-info)](#9-decodificação-de-qr-code-pix-qrc-info)
10. [Consulta de Status Pix (pix-check-status)](#10-consulta-de-status-pix-pix-check-status)
11. [Comprovante Pix (pix-receipt)](#11-comprovante-pix-pix-receipt)
12. [Reembolso Pix (pix-refund)](#12-reembolso-pix-pix-refund)
13. [Pagamento de Boleto (billet-pay)](#13-pagamento-de-boleto-billet-pay)
14. [Status de Boleto (billet-check-status)](#14-status-de-boleto-billet-check-status)
15. [Comprovante de Boleto (billet-receipt)](#15-comprovante-de-boleto-billet-receipt)
16. [Geração Automática de Comprovante (generate-pix-receipt)](#16-geração-automática-de-comprovante-generate-pix-receipt)
17. [Webhook (pix-webhook)](#17-webhook-pix-webhook)
18. [Padrões e Convenções Críticas](#18-padrões-e-convenções-críticas)
19. [Mapeamento de Status](#19-mapeamento-de-status)
20. [Troubleshooting](#20-troubleshooting)

---

## 1. Arquitetura Geral

```
┌─────────────┐     ┌──────────────────────┐     ┌────────────────────┐     ┌──────────────────┐
│  Frontend   │────▶│  Edge Functions       │────▶│  Proxy mTLS        │────▶│  ONZ Infopago    │
│  (React)    │     │  (Deno/Supabase)      │     │  (Node.js/Express) │     │  API REST v2     │
└─────────────┘     └──────────────────────┘     └────────────────────┘     └──────────────────┘
                           │                            │
                           ▼                            │
                    ┌──────────────┐              Certificados mTLS
                    │  PostgreSQL  │              decodificados em
                    │  (Supabase)  │              runtime (Base64)
                    └──────────────┘
```

### Por que o Proxy?

O runtime Deno (rustls) do Supabase **rejeita** certificados TLS que não possuem `SubjectAltName (SAN)`. Os certificados da ONZ Infopago usam apenas `Common Name (CN)`, o que gera o erro `NotValidForName`. O Node.js (OpenSSL) aceita CN sem problemas, então um proxy intermediário resolve a incompatibilidade.

---

## 2. Proxy mTLS (Node.js)

### Arquivos

```
docs/onz-proxy/
├── index.js         # Servidor Express
├── package.json     # Dependência: express ^4.21.0
├── Dockerfile       # Node 18 Alpine
└── README.md        # Instruções de deploy
```

### Endpoint único: `POST /proxy`

| Header | Valor |
|--------|-------|
| `Content-Type` | `application/json` |
| `X-Proxy-API-Key` | Chave compartilhada com Edge Functions |

**Body:**
```json
{
  "url": "https://cashout.infopago.com.br/api/v2/pix/payments/dict",
  "method": "POST",
  "headers": {
    "Authorization": "Bearer <token>",
    "Content-Type": "application/json",
    "x-idempotency-key": "abc123..."
  },
  "body": { ... },       // Objeto JSON (serializado pelo proxy)
  "body_raw": "string"   // OU string crua (enviada sem re-serialização)
}
```

> **CRÍTICO:** Use `body_raw` (não `body`) quando o payload contém strings EMV (QR Code Pix). O `body` passa por `JSON.stringify()` duplo, o que corrompe caracteres especiais da estrutura TLV do EMV.

### Domínios permitidos (whitelist)
- `cashout.infopago.com.br` (produção cash-out)
- `sandbox.infopago.com.br` (sandbox)
- `secureapi.bancodigital.onz.software` (legacy)

### Variáveis de Ambiente do Proxy

| Variável | Descrição |
|----------|-----------|
| `PROXY_API_KEY` | Chave para autenticar Edge Functions |
| `ONZ_CLIENT_CERT_B64` | Certificado .crt em Base64 |
| `ONZ_CLIENT_KEY_B64` | Chave privada .key em Base64 |
| `ONZ_CA_CERT_B64` | (Opcional) CA cert em Base64 |

### Deploy recomendado

Google Cloud Run com `--allow-unauthenticated` e Ingress `All`. Também suporta Railway ou Render.

### Extração de certificados do .pfx

```bash
# Certificado + cadeia completa
openssl pkcs12 -in INFOPAGO_70.pfx -clcerts -nokeys -chain -out client-full.pem

# Chave privada
openssl pkcs12 -in INFOPAGO_70.pfx -nocerts -nodes -out client-key.pem

# Converter para Base64
base64 -i client-full.pem -o cert.b64
base64 -i client-key.pem -o key.b64
```

> **Dica:** Em Bash, use aspas simples na senha do .pfx por causa do caractere `!`.

---

## 3. Secrets / Variáveis de Ambiente

### Edge Functions (Supabase Secrets)

| Secret | Descrição |
|--------|-----------|
| `ONZ_PROXY_URL` | URL do proxy (ex: `https://onz-proxy.run.app`) |
| `ONZ_PROXY_API_KEY` | Chave de autenticação do proxy |
| `SUPABASE_URL` | Auto-provido pelo Supabase |
| `SUPABASE_ANON_KEY` | Auto-provido |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-provido (usado para operações admin) |

---

## 4. Banco de Dados — Tabelas Principais

### `pix_configs`

Armazena credenciais e configurações por empresa.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `company_id` | uuid | FK para companies |
| `provider` | text | Sempre `"onz"` |
| `client_id` | text | CNPJ numérico (produção) ou UUID (sandbox) |
| `client_secret_encrypted` | text | Secret OAuth2 |
| `base_url` | text | `https://cashout.infopago.com.br/api/v2` |
| `purpose` | enum | `cash_in`, `cash_out`, `both` |
| `pix_key` | text | Chave Pix da empresa |
| `pix_key_type` | enum | `cpf`, `cnpj`, `email`, `phone`, `random` |
| `provider_company_id` | text | Header `X-Company-ID` (multi-empresa) |
| `webhook_secret` | text | Segredo para validação de webhooks |
| `webhook_url` | text | URL do endpoint de webhook |
| `certificate_cash_in` | text | PEM Base64 (cash-in) |
| `certificate_key_cash_in` | text | Chave PEM Base64 (cash-in) |
| `certificate_cash_out` | text | PEM Base64 (cash-out) |
| `certificate_key_cash_out` | text | Chave PEM Base64 (cash-out) |

**RLS:** Apenas admins gerenciam. Operadores acessam via view `pix_configs_safe` (sem segredos).

### `pix_tokens`

Cache de tokens OAuth2 para evitar requisições desnecessárias.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `company_id` | uuid | FK para companies |
| `pix_config_id` | uuid | FK para pix_configs |
| `access_token` | text | Token JWT |
| `token_type` | text | `"Bearer"` |
| `expires_at` | timestamptz | Expiração (com margem de 60s) |

### `transactions`

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `pix_type` | enum | `key`, `copy_paste`, `qrcode`, `boleto` |
| `status` | enum | `pending`, `completed`, `failed`, `cancelled` |
| `pix_e2eid` | text | End-to-End ID (Pix) |
| `external_id` | text | ID externo ONZ (para boletos e polling) |
| `pix_provider_response` | jsonb | Resposta completa da ONZ |
| `boleto_code` | text | Código de barras/linha digitável |

### `pix_refunds`

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `e2eid` | text | End-to-End ID da transação original |
| `refund_id` | text | ID aleatório alfanumérico (10 chars) |
| `valor` | numeric | Valor do reembolso |
| `status` | text | `EM_PROCESSAMENTO`, `DEVOLVIDO`, `NAO_REALIZADO` |

### `pix_webhook_logs`

Log de todas as notificações recebidas para auditoria.

---

## 5. Autenticação OAuth2 (pix-auth)

**Edge Function:** `supabase/functions/pix-auth/index.ts`

### Fluxo

1. Recebe `company_id`, `purpose` (opcional), `force_new` (opcional)
2. Busca `pix_configs` com fallback: purpose específico → `both` → qualquer ativo
3. Se `force_new !== true`, verifica cache em `pix_tokens`
4. Se sem cache, faz requisição OAuth2 via proxy

### Requisição OAuth2 (ONZ)

```
POST {base_url}/oauth/token
Content-Type: application/x-www-form-urlencoded

client_id={CNPJ_numerico}&client_secret={secret}&grant_type=client_credentials
```

> **CRÍTICO:** Deve ser `application/x-www-form-urlencoded` com campos em **snake_case**. Enviar como JSON ou camelCase resulta em `404 Application not found`.

### Resposta ONZ

```json
{
  "accessToken": "eyJ...",
  "expiresAt": 1740000000
}
```

### Cache

- Token salvo em `pix_tokens` com `expires_at = expiresAt - 60s` (margem de segurança)
- Tokens antigos da mesma config são deletados antes de inserir o novo
- `force_new: true` ignora o cache (usado no retry automático)

---

## 6. Consulta de Saldo (pix-balance)

**Edge Function:** `supabase/functions/pix-balance/index.ts`

```
GET {base_url}/accounts/balances/
Authorization: Bearer {token}
X-Company-ID: {provider_company_id}  (se configurado)
```

### Resposta esperada

```json
[{ "balanceAmount": { "available": "12345.67" } }]
```

### Token Retry automático

Se a resposta contiver `"Not Authorized"` ou `"access token"`, re-autentica com `force_new: true` e tenta novamente (1 retry).

---

## 7. Pagamento Pix por Chave (pix-pay-dict)

**Edge Function:** `supabase/functions/pix-pay-dict/index.ts`

### Payload ONZ

```
POST {base_url}/pix/payments/dict
Authorization: Bearer {token}
Content-Type: application/json
x-idempotency-key: {35 chars alfanuméricos}
X-Company-ID: {provider_company_id}

{
  "pixKey": "email@example.com",
  "payment": { "amount": 150.00, "currency": "BRL" },
  "description": "Pagamento Pix"
}
```

### Campos opcionais

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `creditorDocument` | string | CPF/CNPJ do recebedor |
| `priority` | string | Prioridade do pagamento |
| `paymentFlow` | string | Fluxo de pagamento |

### Resposta

```json
{
  "e2eId": "E123...",
  "endToEndId": "E123...",
  "correlationID": "...",
  "status": "PROCESSING"
}
```

Grava em `transactions` com `status: 'pending'`, `pix_type: 'key'`.

---

## 8. Pagamento Pix por QR Code (pix-pay-qrc)

**Edge Function:** `supabase/functions/pix-pay-qrc/index.ts`  
**Mais complexa** — fluxo de tripla tentativa com fallbacks.

### Fluxo completo

```
                    ┌─────────────────┐
                    │ Sanitizar QR    │  Remove \r\n\t e zero-width
                    │ (NÃO espaços!) │  Preserva espaços EMV!
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │ pix-qrc-info    │  Decodifica EMV local
                    │ (local parsing) │  Extrai tipo, valor, chave
                    └────────┬────────┘
                             │
                 ┌───────────┴───────────┐
                 │                       │
          ┌──────▼──────┐         ┌──────▼──────┐
          │ QR Estático │         │ QR Dinâmico │
          │ (tag01=11)  │         │ (tag01=12)  │
          └──────┬──────┘         └──────┬──────┘
                 │                       │
         ┌───────▼───────┐       ┌───────▼───────┐
         │ Delega para   │       │ Step 1:       │
         │ pix-pay-dict  │       │ /qrc/info     │  Consulta ONZ
         │ (via chave)   │       │ (com retry    │
         └───────────────┘       │  payload_url) │
                                 └───────┬───────┘
                                         │
                                 ┌───────▼───────┐
                                 │ Step 2:       │
                                 │ /qrc (pay)    │  Tentativa 1: EMV original
                                 │               │  Tentativa 2: payload_url
                                 └───────┬───────┘
                                         │
                                  ┌──────┴───────┐
                                  │ Rejeitado?   │
                                  │ onz-0010?    │
                                  └──────┬───────┘
                                         │ Sim
                                 ┌───────▼───────┐
                                 │ Fallback:     │
                                 │ pix-pay-dict  │  Usa chave extraída
                                 │ (P2P)         │
                                 └───────────────┘
```

### Sanitização de QR Code (CRÍTICO)

```typescript
// CORRETO: Remove apenas controle e zero-width
const cleanQrCode = rawQrCode.trim()
  .replace(/[\r\n\t]/g, '')
  .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '');

// ERRADO: NÃO fazer isso! Corrompe EMV
// rawQrCode.replace(/\s/g, '')  ← NUNCA remover espaços
```

> Espaços são **legítimos** no EMV BR Code (tags 59 e 60 — nome e cidade do comerciante). Removê-los altera o campo `Length` da estrutura TLV e invalida o CRC16 (tag 63), resultando em `onz-0010 Invalid QrCode`.

### Idempotency Key

```typescript
// ONZ exige estritamente [a-zA-Z0-9]{1,50} — sem hífens!
function generateIdempotencyKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 35; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
```

### Token Retry automático (callOnzWithTokenRetry)

```typescript
const callOnzWithTokenRetry = async (url, payload, idempKey, currentToken) => {
  let { proxyResponse, proxyData } = await callOnzViaProxy(url, payload, idempKey, currentToken);
  let result = proxyData.data || proxyData;

  // Se token rejeitado (401 ou onz-0018), gera novo e tenta de novo
  if (proxyResponse.status === 401 || result?.type === 'onz-0018') {
    const newToken = await getAccessToken(true); // force_new
    ({ proxyResponse, proxyData } = await callOnzViaProxy(url, payload, idempKey, newToken));
    result = proxyData.data || proxyData;
  }
  return { proxyResponse, proxyData, result };
};
```

### Envio via body_raw (evita dupla serialização)

```typescript
const rawBody = JSON.stringify(payload);
const proxyBody = JSON.stringify({
  url: qrcPaymentUrl,
  method: 'POST',
  headers: onzHeaders,
  body_raw: rawBody,  // ← NÃO usar "body" para QR codes!
});
```

---

## 9. Decodificação de QR Code (pix-qrc-info)

**Edge Function:** `supabase/functions/pix-qrc-info/index.ts`  
**Processamento 100% local** — não chama a ONZ.

### Parser EMV TLV

```typescript
function parseEmv(emv: string): Record<string, string> {
  const result: Record<string, string> = {};
  let i = 0;
  while (i + 4 <= emv.length) {
    const tag = emv.substring(i, i + 2);        // 2 dígitos = ID do tag
    const len = parseInt(emv.substring(i + 2, i + 4), 10);  // 2 dígitos = length
    if (isNaN(len) || i + 4 + len > emv.length) break;
    result[tag] = emv.substring(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return result;
}
```

### Tags EMV relevantes

| Tag | Descrição |
|-----|-----------|
| `01` | Point of Initiation: `11` = estático, `12` = dinâmico |
| `26` | Merchant Account (contém URL Pix na sub-tag 25, ou chave na sub-tag 01) |
| `54` | Valor da transação |
| `59` | Nome do comerciante |
| `60` | Cidade do comerciante |
| `62` | Additional Data (sub-tag 05 = txid) |
| `63` | CRC16 |

### QR Dinâmico — Fetch do payload COBV

Para QR dinâmicos, a função faz `fetch(pixUrl)` na URL extraída da tag 26.25 para obter o payload COBV/JWS com valor, txid e dados do devedor.

Suporta respostas em:
- **JSON** direto
- **JWS (application/jose)** — decodifica o payload Base64url do JWT

---

## 10. Consulta de Status Pix (pix-check-status)

**Edge Function:** `supabase/functions/pix-check-status/index.ts`

```
GET {base_url}/pix/payments/{end_to_end_id}
Authorization: Bearer {token}
```

Aceita `transaction_id` como parâmetro — resolve automaticamente `company_id` e `pix_e2eid` da transação.

Atualiza o status da transação no banco conforme o [mapeamento de status](#19-mapeamento-de-status).

---

## 11. Comprovante Pix (pix-receipt)

**Edge Function:** `supabase/functions/pix-receipt/index.ts`

```
GET {base_url}/pix/payments/receipt/{end_to_end_id}
Authorization: Bearer {token}
```

Retorna `{ pdf_base64: "...", content_type: "application/pdf" }`.

O PDF em Base64 vem do campo `data.data.pdf` na resposta da ONZ.

---

## 12. Reembolso Pix (pix-refund)

**Edge Function:** `supabase/functions/pix-refund/index.ts`

```
PUT {base_url}/pix/payments/refund/{e2eid}/{refund_id}
Authorization: Bearer {token}
Content-Type: application/json

{ "amount": 50.00 }
```

### Validações

1. Transação deve ter `status: 'completed'`
2. Transação deve ter `pix_e2eid`
3. Valor do reembolso não pode exceder `amount - total_já_reembolsado`
4. Refunds com status `NAO_REALIZADO` são ignorados no cálculo

### Refund ID

Alfanumérico de 10 caracteres (mesma lógica sem hífens).

---

## 13. Pagamento de Boleto (billet-pay)

**Edge Function:** `supabase/functions/billet-pay/index.ts`

### Conversão Código de Barras → Linha Digitável

ONZ exige `digitableCode` (47 dígitos). O scanner captura o código de barras (44 dígitos). A função `convertToLinhaDigitavel()` faz a conversão automática:

```typescript
function convertToLinhaDigitavel(code: string): string {
  const clean = code.replace(/[\s.\-]/g, '');
  if (clean.length !== 44 || clean[0] === '8') return clean; // Já é LD ou convênio

  const bankCurrency = clean.substring(0, 4);
  const checkDigit = clean[4];
  const dueFactor = clean.substring(5, 9);
  const amount = clean.substring(9, 19);
  const freeField1 = clean.substring(19, 24);
  const freeField2 = clean.substring(24, 34);
  const freeField3 = clean.substring(34, 44);

  const check1 = mod10(bankCurrency + freeField1);
  const check2 = mod10(freeField2);
  const check3 = mod10(freeField3);

  return bankCurrency + freeField1 + check1
       + freeField2 + check2
       + freeField3 + check3
       + checkDigit + dueFactor + amount;
}
```

### Payload ONZ

```json
POST {base_url}/billets/payments

{
  "digitableCode": "23793.38128 60000.000003 00000.000408 1 84340000019990",
  "description": "Pagamento de boleto",
  "paymentFlow": "INSTANT"
}
```

Salva em `transactions` com `pix_type: 'boleto'`, rastreamento via `external_id`.

---

## 14. Status de Boleto (billet-check-status)

**Edge Function:** `supabase/functions/billet-check-status/index.ts`

```
GET {base_url}/billets/{external_id}
Authorization: Bearer {token}
```

Mesmo padrão de resolução via `transaction_id`.

---

## 15. Comprovante de Boleto (billet-receipt)

**Edge Function:** `supabase/functions/billet-receipt/index.ts`

```
GET {base_url}/billets/payments/receipt/{external_id}
Authorization: Bearer {token}
```

PDF em `data.data.pdf` ou `data.receipt`.

---

## 16. Geração Automática de Comprovante (generate-pix-receipt)

**Edge Function:** `supabase/functions/generate-pix-receipt/index.ts`

Gera um comprovante visual (SVG → PNG via `@resvg/resvg-js`) e armazena no bucket `receipts` do Supabase Storage.

### Gatilho

Chamada automaticamente pelo `pix-webhook` quando um pagamento é confirmado como `completed`.

### Idempotência

Verifica se já existe um receipt para o `transaction_id` antes de gerar.

### Caminho do arquivo

```
{company_id}/{transaction_id}/{timestamp}_comprovante_pix.png
```

---

## 17. Webhook (pix-webhook)

**Edge Function:** `supabase/functions/pix-webhook/index.ts`

### Segurança

1. **Header obrigatório:** `x-webhook-secret` — validado contra `pix_configs.webhook_secret`
2. **Rate limiting:** 100 req/min por IP (in-memory Map)
3. **Payload máximo:** 1MB
4. **Sem fallback:** Requisições sem secret são rejeitadas com 401

### Formatos suportados

| Formato | Detecção | Handler |
|---------|----------|---------|
| BCB padrão | `payload.pix` (array) | `handleBcbPixWebhook()` |
| ONZ específico | `payload.evento` ou `payload.endToEndId` | `handleOnzWebhook()` |

### Handler BCB (array)

Para cada evento em `payload.pix[]`:
1. Busca transação por `pix_e2eid`
2. Atualiza status (`completed` ou `failed`)
3. Dispara geração automática de comprovante
4. Registra em `audit_logs`
5. Processa devoluções em `pix_refunds`
6. Se não encontra transação mas tem `chave`, cria recebimento automático

### Handler ONZ (evento)

Busca transação por `pix_e2eid` OU `external_id`, atualiza status.

### Configuração no painel ONZ

1. Evento: `Transferência` (Pix) e `Fila de Saída de Pagamentos` (Boletos)
2. Método: `POST`
3. URL: `https://<supabase-url>/functions/v1/pix-webhook`
4. Header: `x-webhook-secret: <valor_de_pix_configs.webhook_secret>`
5. Desativar pausa no envio

### Política de retry ONZ

| Falhas | Intervalo |
|--------|-----------|
| 1-5 | 2 minutos |
| 6-10 | 15 minutos |
| 11-15 | 60 minutos |
| >15 | Webhook desativado |

---

## 18. Padrões e Convenções Críticas

### 1. Formato da requisição OAuth2

```
Content-Type: application/x-www-form-urlencoded
client_id=CNPJ&client_secret=SECRET&grant_type=client_credentials
```

**NUNCA** enviar como JSON. **NUNCA** usar camelCase nos campos.

### 2. Client ID em produção

É o **CNPJ numérico** da empresa (não UUID).

### 3. Base URL por ambiente

| Ambiente | URL |
|----------|-----|
| Produção (cash-out) | `https://cashout.infopago.com.br/api/v2` |
| Sandbox | `https://sandbox.infopago.com.br/api/v2` |

### 4. Idempotency Key

- **Formato:** `[a-zA-Z0-9]{1,50}` — **SEM hífens, underscores ou caracteres especiais**
- **Tamanho padrão:** 35 caracteres
- **Obrigatório** em: pagamentos Pix e boletos
- Uma nova key deve ser gerada para cada tentativa/retry

### 5. Header X-Company-ID

Quando `pix_configs.provider_company_id` está configurado, enviar como header em todas as requisições de pagamento e consulta. Usado em cenários multi-empresa na mesma conta ONZ.

### 6. body_raw vs body no proxy

| Caso | Campo | Motivo |
|------|-------|--------|
| Pagamento DICT | `body` | JSON simples |
| Pagamento QRC | `body_raw` | Evita dupla serialização do EMV |
| Token OAuth2 | `body_raw` | String form-urlencoded |

### 7. Busca de pix_configs (padrão de fallback)

```typescript
// 1. Busca config com purpose específico (ex: 'cash_out')
// 2. Se não encontra, busca purpose = 'both'
// 3. Se não encontra, busca qualquer config ativa
```

### 8. Padrão de Token Retry

Toda função que chama a ONZ deve implementar retry automático:

```typescript
if (status === 401 || result?.type === 'onz-0018') {
  token = await getAccessToken(true); // force_new
  // Repetir requisição com novo token
}
```

---

## 19. Mapeamento de Status

### Pix

| Status ONZ | Status interno |
|-----------|---------------|
| `LIQUIDATED` | `completed` |
| `REALIZADO` | `completed` |
| `CONFIRMED` | `completed` |
| `PROCESSING` | `pending` |
| `EM_PROCESSAMENTO` | `pending` |
| `ACTIVE` | `pending` |
| `CANCELED` | `failed` |
| `NAO_REALIZADO` | `failed` |
| `REFUNDED` | `refunded` |
| `PARTIALLY_REFUNDED` | `refunded` |

### Boleto

| Status ONZ | Status interno |
|-----------|---------------|
| `LIQUIDATED` | `completed` |
| `PROCESSING` | `pending` |
| `CANCELED` | `failed` |

---

## 20. Troubleshooting

| Erro | Causa | Solução |
|------|-------|---------|
| `404 Application not found` | Credenciais OAuth em formato errado | Usar `x-www-form-urlencoded` com `snake_case` |
| `503 Service Unavailable` (proxy) | Certificados inválidos | Verificar Base64 e extrair cadeia completa |
| `403 Forbidden` (proxy) | IAM restritivo no Cloud Run | Habilitar `--allow-unauthenticated` |
| `onz-0010 Invalid QrCode` | Espaços removidos do EMV ou dupla serialização | Usar sanitização correta e `body_raw` |
| `onz-0018` | Token expirado | Retry automático com `force_new: true` |
| `onz-0002 Invalid params` | Payload malformado | Verificar campos obrigatórios |
| `NotValidForName` (Deno) | Cert sem SAN | Usar proxy mTLS (é a raiz do problema) |
| `UnknownIssuer` (Deno) | CA não reconhecido | Usar proxy com `rejectUnauthorized: false` |

---

## Resumo das Edge Functions

| Função | Endpoint ONZ | Método | Tipo |
|--------|-------------|--------|------|
| `pix-auth` | `/oauth/token` | POST | form-urlencoded |
| `pix-balance` | `/accounts/balances/` | GET | — |
| `pix-pay-dict` | `/pix/payments/dict` | POST | JSON |
| `pix-pay-qrc` | `/pix/payments/qrc` | POST | JSON (body_raw) |
| `pix-qrc-info` | — (local) | — | — |
| `pix-check-status` | `/pix/payments/{e2eid}` | GET | — |
| `pix-receipt` | `/pix/payments/receipt/{e2eid}` | GET | — |
| `pix-refund` | `/pix/payments/refund/{e2eid}/{id}` | PUT | JSON |
| `billet-pay` | `/billets/payments` | POST | JSON |
| `billet-check-status` | `/billets/{id}` | GET | — |
| `billet-receipt` | `/billets/payments/receipt/{id}` | GET | — |
| `pix-webhook` | — (recebe) | POST | JSON |
| `generate-pix-receipt` | — (interno) | — | SVG→PNG |
