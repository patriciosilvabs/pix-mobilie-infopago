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

    const userId = claims.claims.sub as string;
    const body = await req.json();
    const { transaction_id, valor, motivo } = body;

    if (!transaction_id) {
      return new Response(
        JSON.stringify({ error: 'transaction_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: transaction } = await supabase
      .from('transactions').select('*').eq('id', transaction_id).single();

    if (!transaction) {
      return new Response(
        JSON.stringify({ error: 'Transaction not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (transaction.status !== 'completed') {
      return new Response(
        JSON.stringify({ error: 'Only completed transactions can be refunded' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!transaction.pix_e2eid) {
      return new Response(
        JSON.stringify({ error: 'Transaction does not have e2eId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const refundValue = valor || transaction.amount;
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: existingRefunds } = await supabaseAdmin
      .from('pix_refunds').select('valor, status')
      .eq('transaction_id', transaction_id).neq('status', 'NAO_REALIZADO');

    const totalRefunded = existingRefunds?.reduce((sum, r) => sum + Number(r.valor), 0) || 0;
    const availableForRefund = Number(transaction.amount) - totalRefunded;

    if (refundValue > availableForRefund) {
      return new Response(
        JSON.stringify({ error: 'Refund value exceeds available amount', available: availableForRefund }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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
      return new Response(
        JSON.stringify({ error: 'Pix configuration not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get auth token
    const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: transaction.company_id }),
    });

    if (!authResponse.ok) {
      return new Response(
        JSON.stringify({ error: 'Failed to authenticate with provider' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { access_token } = await authResponse.json();
    const apiBase = getApiBaseUrl(config);
    const integrationId = crypto.randomUUID();

    // Transfeera: POST /pix/cashin/{end2endId}/refund
    let refundData: any;
    try {
      const refundResponse = await fetch(`${apiBase}/pix/cashin/${transaction.pix_e2eid}/refund`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'PixContabil (contato@pixcontabil.com.br)',
        },
        body: JSON.stringify({
          value: refundValue,
          integration_id: integrationId,
        }),
      });

      refundData = await refundResponse.json();

      if (!refundResponse.ok) {
        return new Response(
          JSON.stringify({ error: 'Failed to request refund', provider_error: JSON.stringify(refundData) }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } catch (e) {
      return new Response(
        JSON.stringify({ error: 'Falha na conexão com Transfeera', details: e.message }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[pix-refund] Refund response:', JSON.stringify(refundData));

    const refundId = refundData.id || integrationId;

    const { data: savedRefund } = await supabaseAdmin
      .from('pix_refunds')
      .insert({
        transaction_id,
        e2eid: transaction.pix_e2eid,
        refund_id: refundId,
        valor: refundValue,
        motivo,
        status: refundData.status || 'EM_PROCESSAMENTO',
        refunded_at: refundData.refunded_at || null,
        created_by: userId,
      })
      .select()
      .single();

    await supabaseAdmin.from('audit_logs').insert({
      user_id: userId,
      company_id: transaction.company_id,
      entity_type: 'pix_refund',
      entity_id: savedRefund?.id,
      action: 'pix_refund_requested',
      new_data: { provider: 'transfeera', refund_id: refundId, valor: refundValue, status: refundData.status },
    });

    return new Response(
      JSON.stringify({
        success: true,
        refund_id: refundId,
        status: refundData.status,
        valor: refundValue,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[pix-refund] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
