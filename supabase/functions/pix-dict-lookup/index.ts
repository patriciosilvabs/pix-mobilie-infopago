import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function detectPixKeyType(key: string): string {
  const cleaned = key.replace(/[\s\-\.\/]/g, '');
  if (/^\d{11}$/.test(cleaned)) return 'CPF';
  if (/^\d{14}$/.test(cleaned)) return 'CNPJ';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key.trim())) return 'EMAIL';
  if (/^\+?\d{10,13}$/.test(cleaned)) return 'TELEFONE';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key.trim())) return 'CHAVE_ALEATORIA';
  return 'CHAVE_ALEATORIA';
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

    const { company_id, pix_key } = await req.json();

    if (!company_id || !pix_key) {
      return new Response(
        JSON.stringify({ error: 'company_id and pix_key are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[pix-dict-lookup] Looking up key: ${pix_key} for company: ${company_id}`);

    // Get Pix config (cash_out or both)
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
        JSON.stringify({ error: 'Configuração Pix não encontrada' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get fresh auth token
    const tokenResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id, purpose: 'cash_out' }),
    });

    if (!tokenResponse.ok) {
      return new Response(
        JSON.stringify({ error: 'Falha ao autenticar com provedor' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { access_token } = await tokenResponse.json();

    // Call Transfeera DICT lookup: GET /pix/dict_key/{key}
    const apiBase = config.is_sandbox
      ? 'https://api-sandbox.transfeera.com'
      : 'https://api.transfeera.com';

    const encodedKey = encodeURIComponent(pix_key.trim());
    const keyType = detectPixKeyType(pix_key);
    const dictUrl = `${apiBase}/pix/dict_key/${encodedKey}?key_type=${encodeURIComponent(keyType)}`;

    console.log(`[pix-dict-lookup] Calling: ${dictUrl}`);

    const dictResponse = await fetch(dictUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'PixContabil (contato@pixcontabil.com.br)',
      },
    });

    const dictData = await dictResponse.json();

    if (!dictResponse.ok) {
      console.error('[pix-dict-lookup] DICT error:', JSON.stringify(dictData));

      // Provide user-friendly error messages
      const errorMessage = dictData?.message || dictData?.error || 'Chave não encontrada no DICT';
      return new Response(
        JSON.stringify({
          success: false,
          error: errorMessage,
          details: dictData,
        }),
        { status: dictResponse.status === 404 ? 404 : 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[pix-dict-lookup] DICT response:', JSON.stringify(dictData));

    // Parse Transfeera DICT response
    // Expected fields: name, cpf_cnpj, key_type, key, bank_name, agency, account, account_type, end2end_id
    return new Response(
      JSON.stringify({
        success: true,
        name: dictData.name || dictData.owner_name || '',
        cpf_cnpj: dictData.cpf_cnpj || dictData.tax_id || '',
        key_type: dictData.key_type || '',
        key: dictData.key || pix_key,
        bank_name: dictData.bank_name || dictData.ispb_name || '',
        agency: dictData.agency || '',
        account: dictData.account || '',
        account_type: dictData.account_type || '',
        end2end_id: dictData.end2end_id || dictData.end_to_end_id || '',
        ispb: dictData.ispb || '',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[pix-dict-lookup] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Erro interno', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
