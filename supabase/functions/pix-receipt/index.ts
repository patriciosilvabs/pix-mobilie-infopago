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

    const token = authHeader.replace('Bearer ', '');
    const { data: claims, error: authError } = await supabase.auth.getClaims(token);
    if (authError || !claims?.claims) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const url = new URL(req.url);
    let transfer_id = url.searchParams.get('transfer_id');
    let company_id = url.searchParams.get('company_id');
    let transaction_id = url.searchParams.get('transaction_id');

    if (req.method === 'POST') {
      const body = await req.json();
      transfer_id = transfer_id || body.transfer_id;
      company_id = company_id || body.company_id;
      transaction_id = transaction_id || body.transaction_id;
      // Legacy support: end_to_end_id param
      if (!transfer_id) transfer_id = body.end_to_end_id;
    }

    if (transaction_id && (!transfer_id || !company_id)) {
      const { data: txData } = await supabase
        .from('transactions')
        .select('company_id, external_id')
        .eq('id', transaction_id)
        .single();
      if (txData) {
        company_id = company_id || txData.company_id;
        if (!transfer_id && txData.external_id) {
          const parts = txData.external_id.split(':');
          transfer_id = parts.length > 1 ? parts[1] : parts[0];
        }
      }
    }

    if (!company_id || !transfer_id) {
      return new Response(
        JSON.stringify({ error: 'company_id and transfer_id are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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
      return new Response(
        JSON.stringify({ error: 'Pix configuration not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get auth token
    const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id }),
    });

    if (!authResponse.ok) {
      return new Response(
        JSON.stringify({ error: 'Failed to authenticate with provider' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { access_token } = await authResponse.json();
    const apiBase = getApiBaseUrl(config);

    // GET /transfer/{id} to get receipt_url
    try {
      const transferResponse = await fetch(`${apiBase}/transfer/${transfer_id}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'User-Agent': 'PixContabil (contato@pixcontabil.com.br)',
        },
      });

      const transferData = await transferResponse.json();

      if (!transferResponse.ok) {
        return new Response(
          JSON.stringify({ error: 'Failed to get transfer data', provider_error: JSON.stringify(transferData) }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const receiptUrl = transferData.receipt_url || transferData.bank_receipt_url;

      if (!receiptUrl) {
        return new Response(
          JSON.stringify({ error: 'Comprovante ainda não disponível. Tente novamente em alguns minutos.', status: transferData.status }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Download receipt PDF and return as base64
      const pdfResponse = await fetch(receiptUrl);
      if (!pdfResponse.ok) {
        return new Response(
          JSON.stringify({ error: 'Failed to download receipt PDF' }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const pdfBuffer = await pdfResponse.arrayBuffer();
      const pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(pdfBuffer)));

      return new Response(
        JSON.stringify({ success: true, transfer_id, provider: 'transfeera', pdf_base64: pdfBase64, content_type: 'application/pdf' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (e) {
      return new Response(
        JSON.stringify({ error: 'Falha na conexão com Transfeera', details: e.message }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error) {
    console.error('[pix-receipt] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
