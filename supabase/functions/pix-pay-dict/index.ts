import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function callOnzProxy(url: string, method: string, headers: Record<string, string>, body?: any) {
  const proxyUrl = (Deno.env.get('ONZ_PROXY_URL') || '').replace(/\/$/, '');
  if (!proxyUrl) throw new Error('ONZ_PROXY_URL not configured');
  const target = new URL(url);
  let path = target.pathname.replace(/^\/api\/v2/, '');
  const routePrefix = (target.hostname.includes('pix.infopago') && !target.hostname.includes('cashout')) ? '/pix' : '/cashout';
  const fullProxyUrl = `${proxyUrl}${routePrefix}${path}${target.search || ''}`;
  console.log(`[callOnzProxy] ${method} ${fullProxyUrl} (target: ${url})`);
  const resp = await fetch(fullProxyUrl, { method, headers: { ...headers }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  const ct = resp.headers.get('content-type') || '';
  const text = await resp.text();
  let data: any = text;
  if (ct.includes('application/json')) { try { data = JSON.parse(text); } catch { /* keep text */ } }
  return { ok: resp.status >= 200 && resp.status < 300, status: resp.status, data };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const userId = user.id;
    const body = await req.json();
    const { company_id, pix_key, valor, descricao, idempotency_key } = body;

    if (!company_id || !pix_key || !valor) {
      return new Response(JSON.stringify({ error: 'company_id, pix_key and valor are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const MAX_PAYMENT_VALUE = 1_000_000;
    if (valor <= 0 || valor > MAX_PAYMENT_VALUE) {
      return new Response(JSON.stringify({ error: `Valor inválido. Deve estar entre R$ 0,01 e R$ ${MAX_PAYMENT_VALUE.toLocaleString('pt-BR')}.` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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
      return new Response(JSON.stringify({ error: 'Pix configuration not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Idempotency check
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    if (idempotency_key) {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: existing } = await supabaseAdmin.from('transactions')
        .select('id, status').eq('company_id', company_id).eq('pix_key', pix_key)
        .eq('amount', valor).eq('created_by', userId).gte('created_at', fiveMinAgo)
        .in('status', ['pending', 'completed']).limit(1).maybeSingle();
      if (existing) {
        console.log(`[pix-pay-dict] Duplicate blocked. Existing tx: ${existing.id}`);
        return new Response(JSON.stringify({ success: true, transaction_id: existing.id, duplicate: true, status: existing.status }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // Get auth token
    const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id, purpose: 'cash_out' }),
    });
    if (!authResponse.ok) {
      return new Response(JSON.stringify({ error: 'Failed to authenticate with ONZ' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const { access_token } = await authResponse.json();

    const baseUrl = config.base_url.replace(/\/$/, '');
    const idempotencyKey = idempotency_key || crypto.randomUUID().replace(/-/g, '').substring(0, 50);

    // ONZ: POST /pix/payments/dict
    console.log(`[pix-pay-dict] ONZ: pixKey=${pix_key}, valor=${valor}`);

    let paymentData: any;
    try {
      const result = await callOnzProxy(`${baseUrl}/pix/payments/dict`, 'POST', {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
        'x-idempotency-key': idempotencyKey,
      }, {
        pixKey: pix_key,
        description: descricao || 'Pagamento Pix',
        payment: { currency: 'BRL', amount: Number(valor.toFixed(2)) },
      });

      if (!result.ok) {
        console.error('[pix-pay-dict] ONZ error:', JSON.stringify(result.data));
        return new Response(JSON.stringify({ error: result.data?.detail || result.data?.title || 'Falha no pagamento Pix', provider_error: result.data }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      paymentData = result.data;
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Falha na conexão com ONZ', details: e.message }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log('[pix-pay-dict] ONZ response:', JSON.stringify(paymentData));

    const onzId = String(paymentData.id || '');
    const endToEndId = paymentData.endToEndId || '';

    // Save transaction
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
        external_id: onzId,
        pix_e2eid: endToEndId,
        pix_provider_response: paymentData,
      })
      .select('id').single();

    if (insertError) {
      console.error('[pix-pay-dict] Failed to create transaction:', insertError);
      return new Response(JSON.stringify({ error: 'Failed to save transaction' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    await supabaseAdmin.from('audit_logs').insert({
      user_id: userId, company_id,
      entity_type: 'transaction', entity_id: newTransaction.id,
      action: 'pix_payment_initiated',
      new_data: { provider: 'onz', onzId, endToEndId, valor, pix_key, status: 'pending' },
    });

    return new Response(JSON.stringify({
      success: true,
      transaction_id: newTransaction.id,
      onz_id: onzId,
      end_to_end_id: endToEndId,
      id_envio: onzId,
      status: paymentData.status || 'PROCESSING',
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[pix-pay-dict] Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
