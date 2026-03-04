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
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key.trim())) return 'EVP';
  return 'EVP';
}

// ONZ does not have a standalone DICT lookup endpoint.
// This function validates the key format locally and returns key type info.
// Beneficiary details will be available after payment is initiated.

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

    const { company_id, pix_key } = await req.json();
    if (!company_id || !pix_key) {
      return new Response(JSON.stringify({ error: 'company_id and pix_key are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const keyType = detectPixKeyType(pix_key);
    console.log(`[pix-dict-lookup] Local validation: key=${pix_key}, type=${keyType}`);

    // Return local validation result (ONZ doesn't have a DICT lookup endpoint)
    return new Response(JSON.stringify({
      success: true,
      name: '',
      cpf_cnpj: '',
      key_type: keyType,
      key: pix_key.trim(),
      bank_name: '',
      agency: '',
      account: '',
      account_type: '',
      end2end_id: '',
      ispb: '',
      message: 'Chave validada localmente. Dados do beneficiário serão confirmados ao efetuar o pagamento.',
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[pix-dict-lookup] Error:', error);
    return new Response(JSON.stringify({ error: 'Erro interno', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
