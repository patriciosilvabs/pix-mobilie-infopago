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
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Use service role key for internal DB queries (auth token is from Firebase)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { company_id } = await req.json();
    if (!company_id) {
      return new Response(JSON.stringify({ error: 'company_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`[pix-balance] Fetching ONZ balance for company: ${company_id}`);

    // Get Pix config
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
      return new Response(JSON.stringify({ success: true, balance: null, available: false, provider: null, message: 'Nenhuma configuração Pix ativa encontrada' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const fetchBalance = async (forceNewToken = false): Promise<Response> => {
      const authBody: any = { company_id, purpose: 'cash_out' };
      if (forceNewToken) authBody.force_new = true;

      const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')!}/functions/v1/pix-auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
        body: JSON.stringify(authBody),
      });

      if (!authResponse.ok) {
        const authError = await authResponse.text();
        return new Response(JSON.stringify({ error: 'Falha ao autenticar com ONZ', details: authError }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const { access_token } = await authResponse.json();
      const baseUrl = config.base_url.replace(/\/$/, '');

      // ONZ: GET /accounts/balances/
      const result = await callOnzProxy(`${baseUrl}/accounts/balances/`, 'GET', {
        'Authorization': `Bearer ${access_token}`,
      });

      if (!result.ok) {
        if (!forceNewToken && result.status === 401) {
          console.log('[pix-balance] Token rejected, retrying with fresh token...');
          return fetchBalance(true);
        }
        return new Response(JSON.stringify({ error: 'Falha ao consultar saldo ONZ', details: result.data }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      console.log('[pix-balance] ONZ response:', JSON.stringify(result.data));

      // ONZ response: { data: [{ eventDate, balanceAmount: { currency, available, blocked, overdraft } }] }
      const balanceData = result.data?.data?.[0]?.balanceAmount || result.data?.data?.[0] || {};
      const balance = parseFloat(balanceData.available ?? balanceData.balance ?? '0');

      return new Response(JSON.stringify({ success: true, balance, available: true, provider: 'onz' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    };

    try {
      return await fetchBalance();
    } catch (fetchError) {
      return new Response(JSON.stringify({ error: 'Falha na conexão com ONZ', details: fetchError.message }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

  } catch (error) {
    console.error('[pix-balance] Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
