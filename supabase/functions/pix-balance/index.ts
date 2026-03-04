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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
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

    const { company_id } = await req.json();

    if (!company_id) {
      return new Response(
        JSON.stringify({ error: 'company_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[pix-balance] Fetching balance for company: ${company_id}`);

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
      return new Response(
        JSON.stringify({ success: true, balance: null, available: false, provider: null, message: 'Nenhuma configuração Pix ativa encontrada' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch balance with token retry
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
        return new Response(
          JSON.stringify({ error: 'Falha ao autenticar com o provedor', details: authError }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { access_token } = await authResponse.json();
      const apiBase = getApiBaseUrl(config);

      const balanceResponse = await fetch(`${apiBase}/statement/balance`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'User-Agent': 'PixContabil (contato@pixcontabil.com.br)',
        },
      });

      if (!balanceResponse.ok) {
        const errText = await balanceResponse.text();
        if (!forceNewToken && balanceResponse.status === 401) {
          console.log('[pix-balance] Token rejected, retrying with fresh token...');
          return fetchBalance(true);
        }
        return new Response(
          JSON.stringify({ error: 'Falha ao consultar saldo', details: errText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const data = await balanceResponse.json();
      console.log('[pix-balance] Transfeera response:', JSON.stringify(data));

      const balance = parseFloat(data.value ?? data.balance ?? '0');

      return new Response(
        JSON.stringify({ success: true, balance, available: true, provider: 'transfeera' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    };

    try {
      return await fetchBalance();
    } catch (fetchError) {
      return new Response(
        JSON.stringify({ error: 'Falha na conexão com Transfeera', details: fetchError.message }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error) {
    console.error('[pix-balance] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
