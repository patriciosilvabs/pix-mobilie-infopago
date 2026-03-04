import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getApiBaseUrl(config: any): string {
  return config.is_sandbox
    ? 'https://api-sandbox.transfeera.com'
    : 'https://api.transfeera.com';
}

function isValidCpf(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1+$/.test(cpf)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(cpf[i]) * (10 - i);
  let checkDigit = (sum * 10) % 11;
  if (checkDigit === 10) checkDigit = 0;
  if (checkDigit !== Number(cpf[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(cpf[i]) * (11 - i);
  checkDigit = (sum * 10) % 11;
  if (checkDigit === 10) checkDigit = 0;
  return checkDigit === Number(cpf[10]);
}

function isValidCnpj(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1+$/.test(cnpj)) return false;

  const calculateDigit = (base: string, weights: number[]) => {
    const sum = base
      .split('')
      .reduce((acc, digit, index) => acc + Number(digit) * weights[index], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const firstDigit = calculateDigit(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const secondDigit = calculateDigit(cnpj.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);

  return firstDigit === Number(cnpj[12]) && secondDigit === Number(cnpj[13]);
}

function normalizePhonePixKey(rawKey: string): string {
  const trimmed = rawKey.trim();
  const digits = trimmed.replace(/\D/g, '');

  if (trimmed.startsWith('+')) return `+${digits}`;
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return `+${digits}`;

  return digits.length > 0 ? `+${digits}` : trimmed;
}

function detectPixKeyType(key: string): string {
  const trimmed = key.trim();
  const digitsOnly = trimmed.replace(/\D/g, '');
  const phoneCandidate = trimmed.replace(/[^\d+]/g, '');

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return 'EMAIL';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return 'CHAVE_ALEATORIA';

  if (/^\d{11}$/.test(digitsOnly) && isValidCpf(digitsOnly)) return 'CPF';
  if (/^\d{14}$/.test(digitsOnly) && isValidCnpj(digitsOnly)) return 'CNPJ';

  if (/^\+?\d{10,13}$/.test(phoneCandidate)) return 'TELEFONE';

  // Fallback para chaves numéricas sem dígitos verificadores válidos
  if (/^\d{11}$/.test(digitsOnly) || /^\d{14}$/.test(digitsOnly)) return 'TELEFONE';

  return 'CHAVE_ALEATORIA';
}

function mapPixKeyType(type: string | undefined, key: string): string {
  if (type) {
    const map: Record<string, string> = {
      cpf: 'CPF', cnpj: 'CNPJ', email: 'EMAIL', phone: 'TELEFONE', random: 'CHAVE_ALEATORIA',
    };
    const mapped = map[type.toLowerCase()];
    if (mapped) return mapped;
  }
  return detectPixKeyType(key);
}

function normalizePixKeyByType(key: string, keyType: string): string {
  if (keyType === 'TELEFONE') return normalizePhonePixKey(key);
  return key.trim();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = user.id;
    const body = await req.json();
    const { company_id, pix_key, pix_key_type, valor, descricao, idempotency_key } = body;

    if (!company_id || !pix_key || !valor) {
      return new Response(
        JSON.stringify({ error: 'company_id, pix_key and valor are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const MAX_PAYMENT_VALUE = 1_000_000;
    if (valor <= 0 || valor > MAX_PAYMENT_VALUE) {
      return new Response(
        JSON.stringify({ error: `Valor inválido. O valor deve estar entre R$ 0,01 e R$ ${MAX_PAYMENT_VALUE.toLocaleString('pt-BR')}.` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get Pix config for cash-out
    let config: any = null;
    const { data: cashOutConfig } = await supabase
      .from('pix_configs').select('*')
      .eq('company_id', company_id).eq('is_active', true).eq('purpose', 'cash_out').single();
    config = cashOutConfig;
    if (!config) {
      const { data: bothConfig } = await supabase
        .from('pix_configs').select('*')
        .eq('company_id', company_id).eq('is_active', true).eq('purpose', 'both').single();
      config = bothConfig;
    }

    if (!config) {
      return new Response(
        JSON.stringify({ error: 'Pix configuration not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ===== IDEMPOTENCY CHECK =====
    if (idempotency_key) {
      const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: existing } = await supabaseAdmin.from('transactions')
        .select('id, status')
        .eq('company_id', company_id)
        .eq('pix_key', pix_key)
        .eq('amount', valor)
        .eq('created_by', userId)
        .gte('created_at', fiveMinAgo)
        .in('status', ['pending', 'completed'])
        .limit(1)
        .maybeSingle();

      if (existing) {
        console.log(`[pix-pay-dict] Duplicate blocked. Existing tx: ${existing.id}, status: ${existing.status}`);
        return new Response(
          JSON.stringify({ success: true, transaction_id: existing.id, duplicate: true, status: existing.status }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Get auth token
    const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id, purpose: 'cash_out' }),
    });

    if (!authResponse.ok) {
      return new Response(
        JSON.stringify({ error: 'Failed to authenticate with provider' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { access_token } = await authResponse.json();
    const apiBase = getApiBaseUrl(config);
    const idempotencyKey = crypto.randomUUID();
    const resolvedPixKeyType = mapPixKeyType(pix_key_type, pix_key);
    const normalizedPixKey = normalizePixKeyByType(pix_key, resolvedPixKeyType);

    // Transfeera: create batch with auto_close and single transfer
    const batchPayload = {
      name: `PIX_${Date.now()}`,
      type: 'TRANSFERENCIA',
      auto_close: true,
      transfers: [{
        value: Number(valor.toFixed(2)),
        idempotency_key: idempotencyKey,
        pix_description: descricao || 'Pagamento Pix',
        destination_bank_account: {
          pix_key_type: resolvedPixKeyType,
          pix_key: normalizedPixKey,
        },
      }],
    };

    console.log(`[pix-pay-dict] Transfeera: key_type=${resolvedPixKeyType}, key=${normalizedPixKey}, valor=${valor}`);

    let paymentData: any;
    try {
      const batchResponse = await fetch(`${apiBase}/batch`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'PixContabil (contato@pixcontabil.com.br)',
        },
        body: JSON.stringify(batchPayload),
      });

      const data = await batchResponse.json();

      if (!batchResponse.ok) {
        console.error('[pix-pay-dict] Transfeera error:', JSON.stringify(data));
        return new Response(
          JSON.stringify({
            error: data?.message || 'Failed to initiate Pix payment',
            provider_error: data,
          }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      paymentData = data;
    } catch (e) {
      return new Response(
        JSON.stringify({ error: 'Falha na conexão com Transfeera', details: e.message }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[pix-pay-dict] Batch created:', JSON.stringify(paymentData));

    // Extract batch and transfer IDs
    const batchId = paymentData.id;
    const transferId = paymentData.transfers?.[0]?.id || '';
    const externalId = `${batchId}:${transferId}`;

    // Save transaction
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: newTransaction, error: insertError } = await supabaseAdmin
      .from('transactions')
      .insert({
        company_id,
        created_by: userId,
        amount: valor,
        status: 'pending',
        pix_type: 'key' as const,
        pix_key,
        description: descricao,
        external_id: externalId,
        pix_provider_response: paymentData,
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('[pix-pay-dict] Failed to create transaction:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to save transaction' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    await supabaseAdmin.from('audit_logs').insert({
      user_id: userId,
      company_id,
      entity_type: 'transaction',
      entity_id: newTransaction.id,
      action: 'pix_payment_initiated',
      new_data: { provider: 'transfeera', externalId, batchId, transferId, valor, pix_key, status: 'pending' },
    });

    return new Response(
      JSON.stringify({
        success: true,
        transaction_id: newTransaction.id,
        batch_id: batchId,
        transfer_id: transferId,
        id_envio: externalId,
        status: paymentData.status || 'PROCESSING',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[pix-pay-dict] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
