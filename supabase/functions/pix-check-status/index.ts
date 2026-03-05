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

// ONZ status mapping
const ONZ_STATUS_MAP: Record<string, string> = {
  'PROCESSING': 'pending',
  'LIQUIDATED': 'completed',
  'CANCELED': 'failed',
  'REFUNDED': 'completed', // transaction itself is completed, refund tracked separately
  'PARTIALLY_REFUNDED': 'completed',
};

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

    const url = new URL(req.url);
    let transaction_id = url.searchParams.get('transaction_id');
    let company_id = url.searchParams.get('company_id');
    let end_to_end_id = url.searchParams.get('end_to_end_id');
    let onz_id = url.searchParams.get('onz_id');

    if (req.method === 'POST') {
      const body = await req.json();
      transaction_id = transaction_id || body.transaction_id;
      company_id = company_id || body.company_id;
      end_to_end_id = end_to_end_id || body.end_to_end_id || body.transfer_id;
      onz_id = onz_id || body.onz_id || body.batch_id;
    }

    // Get identifiers from transaction if not provided
    if (transaction_id && (!company_id || !end_to_end_id)) {
      const { data: txData } = await supabase
        .from('transactions')
        .select('company_id, external_id, pix_e2eid')
        .eq('id', transaction_id).single();
      if (txData) {
        company_id = company_id || txData.company_id;
        end_to_end_id = end_to_end_id || txData.pix_e2eid;
        onz_id = onz_id || txData.external_id;
      }
    }

    if (!company_id || (!end_to_end_id && !onz_id)) {
      return new Response(JSON.stringify({ error: 'company_id and end_to_end_id (or transaction_id) are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Get config
    let config: any = null;
    for (const p of ['cash_out', 'both', 'cash_in']) {
      const { data: c } = await supabase
        .from('pix_configs').select('*')
        .eq('company_id', company_id).eq('is_active', true).eq('purpose', p).single();
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
      body: JSON.stringify({ company_id }),
    });
    if (!authResponse.ok) {
      return new Response(JSON.stringify({ error: 'Failed to authenticate with ONZ' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const { access_token } = await authResponse.json();
    const baseUrl = config.base_url.replace(/\/$/, '');

    let statusData: any = null;

    try {
      // ONZ: GET /pix/payments/{endToEndId}
      if (end_to_end_id) {
        const result = await callOnzProxy(`${baseUrl}/pix/payments/${encodeURIComponent(end_to_end_id)}`, 'GET', {
          'Authorization': `Bearer ${access_token}`,
        });
        if (result.ok && result.data) {
          statusData = result.data?.data || result.data;
        }
      }

      // Fallback: try by ONZ transaction ID via accounts/transactions/{id}/details
      if (!statusData && onz_id) {
        const result = await callOnzProxy(`${baseUrl}/accounts/transactions/${encodeURIComponent(onz_id)}/details`, 'GET', {
          'Authorization': `Bearer ${access_token}`,
        });
        if (result.ok && result.data) {
          const details = Array.isArray(result.data) ? result.data[0] : result.data;
          statusData = details;
        }
      }
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Falha na conexão com ONZ', details: e.message }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!statusData) {
      return new Response(JSON.stringify({ error: 'Não foi possível obter status da transferência' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log('[pix-check-status] ONZ status received:', JSON.stringify(statusData));

    const rawStatus = String(statusData.status || '').replace(/,/g, '').toUpperCase();
    const internalStatus = ONZ_STATUS_MAP[rawStatus] || 'pending';
    const isCompleted = internalStatus === 'completed';

    if (transaction_id) {
      const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const updateData: any = {
        status: internalStatus,
        pix_provider_response: statusData,
        pix_e2eid: statusData.endToEndId || end_to_end_id || null,
      };
      if (isCompleted) updateData.paid_at = new Date().toISOString();
      await supabaseAdmin.from('transactions').update(updateData).eq('id', transaction_id);
    }

    return new Response(JSON.stringify({
      success: true,
      end_to_end_id: statusData.endToEndId || end_to_end_id,
      onz_id: statusData.id || onz_id,
      status: statusData.status,
      internal_status: internalStatus,
      is_completed: isCompleted,
      provider: 'onz',
      payload: statusData,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[pix-check-status] Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
