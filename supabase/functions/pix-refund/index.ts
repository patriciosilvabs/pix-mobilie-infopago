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
    const { transaction_id, valor, motivo } = body;

    if (!transaction_id) {
      return new Response(JSON.stringify({ error: 'transaction_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: transaction } = await supabase
      .from('transactions').select('*').eq('id', transaction_id).single();

    if (!transaction) {
      return new Response(JSON.stringify({ error: 'Transaction not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (transaction.status !== 'completed') {
      return new Response(JSON.stringify({ error: 'Only completed transactions can be refunded' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!transaction.pix_e2eid) {
      return new Response(JSON.stringify({ error: 'Transaction does not have e2eId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const refundValue = valor || transaction.amount;
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: existingRefunds } = await supabaseAdmin
      .from('pix_refunds').select('valor, status')
      .eq('transaction_id', transaction_id).neq('status', 'NAO_REALIZADO');

    const totalRefunded = existingRefunds?.reduce((sum, r) => sum + Number(r.valor), 0) || 0;
    const availableForRefund = Number(transaction.amount) - totalRefunded;

    if (refundValue > availableForRefund) {
      return new Response(JSON.stringify({ error: 'Refund value exceeds available amount', available: availableForRefund }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Get config
    let config: any = null;
    for (const p of ['cash_in', 'both', 'cash_out']) {
      const { data: c } = await supabase
        .from('pix_configs').select('*')
        .eq('company_id', transaction.company_id).eq('is_active', true).eq('purpose', p).single();
      if (c) { config = c; break; }
    }
    if (!config) {
      return new Response(JSON.stringify({ error: 'Pix configuration not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Get auth token
    const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: transaction.company_id }),
    });
    if (!authResponse.ok) {
      return new Response(JSON.stringify({ error: 'Failed to authenticate with ONZ' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const { access_token } = await authResponse.json();
    const baseUrl = config.base_url.replace(/\/$/, '');

    // ONZ BACEN API: PUT /pix/{e2eid}/devolucao/{id}
    const refundId = crypto.randomUUID().replace(/-/g, '').substring(0, 35);

    let refundData: any;
    try {
      const result = await callOnzProxy(
        `${baseUrl}/pix/${encodeURIComponent(transaction.pix_e2eid)}/devolucao/${refundId}`, 'PUT',
        {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json',
        },
        { valor: { original: refundValue.toFixed(2) } }
      );

      if (!result.ok) {
        return new Response(JSON.stringify({ error: 'Falha ao solicitar devolução', provider_error: result.data }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      refundData = result.data;
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Falha na conexão com ONZ', details: e.message }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log('[pix-refund] ONZ refund response:', JSON.stringify(refundData));

    const { data: savedRefund } = await supabaseAdmin
      .from('pix_refunds')
      .insert({
        transaction_id,
        e2eid: transaction.pix_e2eid,
        refund_id: refundId,
        valor: refundValue,
        motivo,
        status: refundData?.status || 'EM_PROCESSAMENTO',
        refunded_at: refundData?.horario?.solicitacao || null,
        created_by: userId,
      })
      .select().single();

    await supabaseAdmin.from('audit_logs').insert({
      user_id: userId, company_id: transaction.company_id,
      entity_type: 'pix_refund', entity_id: savedRefund?.id,
      action: 'pix_refund_requested',
      new_data: { provider: 'onz', refund_id: refundId, valor: refundValue, status: refundData?.status },
    });

    return new Response(JSON.stringify({
      success: true, refund_id: refundId, status: refundData?.status, valor: refundValue,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[pix-refund] Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
