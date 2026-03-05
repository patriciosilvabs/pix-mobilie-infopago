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
    const { company_id, codigo_barras, descricao, valor } = body;

    if (!company_id || !codigo_barras) {
      return new Response(JSON.stringify({ error: 'company_id and codigo_barras are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Get config
    const { data: config } = await supabase
      .from('pix_configs').select('*')
      .eq('company_id', company_id).eq('is_active', true)
      .in('purpose', ['cash_out', 'both']).limit(1).maybeSingle();

    if (!config) {
      return new Response(JSON.stringify({ error: 'Configuração Pix não encontrada para pagamento de boletos.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Get auth token
    const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id, purpose: 'cash_out' }),
    });
    if (!authResponse.ok) {
      return new Response(JSON.stringify({ error: 'Falha ao autenticar com ONZ' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { access_token } = await authResponse.json();
    const baseUrl = config.base_url.replace(/\/$/, '');
    const cleanBarcode = codigo_barras.replace(/[\s.\-]/g, '');
    const idempotencyKey = crypto.randomUUID().replace(/-/g, '').substring(0, 50);

    // ONZ: POST /billets/payments
    console.log(`[billet-pay] ONZ: paying billet ${cleanBarcode}`);

    const onzBody: any = {
      digitableCode: cleanBarcode,
      description: descricao || 'Pagamento de boleto',
    };
    if (valor) {
      onzBody.payment = { currency: 'BRL', amount: Number(Number(valor).toFixed(2)) };
    }

    let paymentData: any;
    try {
      const result = await callOnzProxy(`${baseUrl}/billets/payments`, 'POST', {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
        'x-idempotency-key': idempotencyKey,
      }, onzBody);

      if (!result.ok) {
        console.error('[billet-pay] ONZ error:', JSON.stringify(result.data));
        return new Response(JSON.stringify({ error: 'Falha ao pagar boleto via ONZ', provider_error: result.data }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      paymentData = result.data;
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Falha na conexão com ONZ', details: e.message }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log('[billet-pay] ONZ response:', JSON.stringify(paymentData));

    const onzId = String(paymentData.id || '');
    const amount = Number(paymentData.payment?.amount || valor || 0);

    // Save transaction
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: newTransaction, error: insertError } = await supabaseAdmin
      .from('transactions')
      .insert({
        company_id,
        created_by: userId,
        amount,
        status: 'pending',
        pix_type: 'boleto' as const,
        boleto_code: codigo_barras,
        description: descricao || 'Pagamento de boleto',
        external_id: onzId,
        pix_provider_response: paymentData,
      })
      .select('id').single();

    if (insertError) {
      console.error('[billet-pay] Failed to create transaction:', insertError);
      return new Response(JSON.stringify({ error: 'Failed to save transaction' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    await supabaseAdmin.from('audit_logs').insert({
      user_id: userId, company_id,
      entity_type: 'transaction', entity_id: newTransaction.id,
      action: 'billet_payment_initiated',
      new_data: { provider: 'onz', onzId, amount, status: 'pending' },
    });

    return new Response(JSON.stringify({
      success: true,
      transaction_id: newTransaction.id,
      external_id: onzId,
      billet_id: onzId,
      status: paymentData.status || 'PROCESSING',
      billet_info: paymentData,
      provider_response: paymentData,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[billet-pay] Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
