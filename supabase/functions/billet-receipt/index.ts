import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function callOnzProxy(url: string, method: string, headers: Record<string, string>, body?: any) {
  const proxyUrl = Deno.env.get('ONZ_PROXY_URL');
  const proxyApiKey = Deno.env.get('ONZ_PROXY_API_KEY');
  if (!proxyUrl || !proxyApiKey) throw new Error('ONZ proxy not configured');
  const proxyPayload: any = { url, method, headers };
  if (body !== undefined) proxyPayload.body = body;
  const resp = await fetch(`${proxyUrl}/proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-proxy-api-key': proxyApiKey },
    body: JSON.stringify(proxyPayload),
  });
  const result = await resp.json();
  return { ok: result.status >= 200 && result.status < 300, status: result.status, data: result.data };
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

    const body = await req.json();
    const { company_id, billet_id, transaction_id } = body;

    let billetExternalId = billet_id;
    let companyId = company_id;

    if (transaction_id && (!billetExternalId || !companyId)) {
      const { data: txData } = await supabase
        .from('transactions').select('company_id, external_id')
        .eq('id', transaction_id).single();
      if (txData) {
        companyId = companyId || txData.company_id;
        billetExternalId = billetExternalId || txData.external_id;
      }
    }

    if (!companyId || !billetExternalId) {
      return new Response(JSON.stringify({ error: 'company_id and billet_id (or transaction_id) are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Get config
    let config: any = null;
    for (const p of ['cash_out', 'both']) {
      const { data: c } = await supabase
        .from('pix_configs').select('*')
        .eq('company_id', companyId).eq('is_active', true).eq('purpose', p).single();
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
      body: JSON.stringify({ company_id: companyId, purpose: 'cash_out' }),
    });
    if (!authResponse.ok) {
      return new Response(JSON.stringify({ error: 'Failed to authenticate with ONZ' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const { access_token } = await authResponse.json();
    const baseUrl = config.base_url.replace(/\/$/, '');

    // ONZ: GET /billets/payments/receipt/{id}
    try {
      const result = await callOnzProxy(
        `${baseUrl}/billets/payments/receipt/${encodeURIComponent(billetExternalId)}`, 'GET',
        { 'Authorization': `Bearer ${access_token}` }
      );

      if (!result.ok) {
        return new Response(JSON.stringify({ error: 'Comprovante ainda não disponível', details: result.data }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const pdfBase64 = result.data?.data?.pdf || result.data?.pdf;
      if (!pdfBase64) {
        return new Response(JSON.stringify({ error: 'Comprovante não disponível na resposta' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({
        success: true, billet_id: billetExternalId, provider: 'onz',
        pdf_base64: pdfBase64, content_type: 'application/pdf',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Falha na conexão com ONZ', details: e.message }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

  } catch (error) {
    console.error('[billet-receipt] Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
