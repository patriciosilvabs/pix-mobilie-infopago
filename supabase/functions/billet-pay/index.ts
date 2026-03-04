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

function parsePositiveAmount(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
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
    const { data: userData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !userData?.user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = userData.user.id;
    const body = await req.json();
    const { company_id, codigo_barras, descricao, valor } = body;

    if (!company_id || !codigo_barras) {
      return new Response(
        JSON.stringify({ error: 'company_id and codigo_barras are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get config
    let config: any = null;
    const { data: cashOutConfig } = await supabase
      .from('pix_configs').select('*')
      .eq('company_id', company_id).eq('is_active', true)
      .in('purpose', ['cash_out', 'both']).limit(1).maybeSingle();
    config = cashOutConfig;

    if (!config) {
      return new Response(
        JSON.stringify({ error: 'Configuração Pix não encontrada para pagamento de boletos.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get auth token
    const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id, purpose: 'cash_out' }),
    });

    if (!authResponse.ok) {
      return new Response(
        JSON.stringify({ error: 'Falha ao autenticar com o provedor' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { access_token } = await authResponse.json();
    const apiBase = getApiBaseUrl(config);

    // Clean barcode
    const cleanBarcode = codigo_barras.replace(/[\s.\-]/g, '');

    // Step 1: Consult billet via Transfeera
    console.log(`[billet-pay] Consulting billet: ${cleanBarcode}`);
    let billetInfo: any = null;
    try {
      const consultResponse = await fetch(`${apiBase}/billet/consult?code=${encodeURIComponent(cleanBarcode)}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'User-Agent': 'PixContabil (contato@pixcontabil.com.br)',
        },
      });
      if (consultResponse.ok) {
        billetInfo = await consultResponse.json();
        console.log('[billet-pay] Billet info:', JSON.stringify(billetInfo));
      } else {
        const errText = await consultResponse.text();
        console.warn('[billet-pay] Billet consult failed:', errText);
      }
    } catch (e) {
      console.warn('[billet-pay] Billet consult error:', e.message);
    }

    const consultPaymentInfo = billetInfo?.payment_info ?? {};
    const consultBarcodeDetails = billetInfo?.barcode_details ?? {};

    const originalConsultValue = parsePositiveAmount(
      consultPaymentInfo.original_value ?? consultBarcodeDetails.value ?? billetInfo?.value
    );

    const updatedConsultValue = parsePositiveAmount(
      consultPaymentInfo.total_updated_value ?? billetInfo?.total_updated_value ?? originalConsultValue
    );

    const informedValue = parsePositiveAmount(valor);
    const billetAmount = informedValue ?? updatedConsultValue ?? originalConsultValue;

    // Step 2: Create batch with billet
    const paymentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const batchPayload = {
      name: `BOLETO_${Date.now()}`,
      type: 'BOLETO',
      auto_close: true,
      billets: [{
        barcode: cleanBarcode,
        payment_date: paymentDate,
        description: descricao || 'Pagamento de boleto',
        value: billetAmount,
      }],
    };

    let paymentData: any;
    try {
      const batchResponse = await fetch(`${apiBase}/batch`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'PixContabil (contato@pixcontabil.com.br)',
        },
        body: JSON.stringify(batchPayload),
      });

      paymentData = await batchResponse.json();

      if (!batchResponse.ok) {
        console.error('[billet-pay] Transfeera error:', JSON.stringify(paymentData));
        return new Response(
          JSON.stringify({ error: 'Falha ao pagar boleto via Transfeera', provider_error: JSON.stringify(paymentData) }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } catch (e) {
      return new Response(
        JSON.stringify({ error: 'Falha na conexão com Transfeera', details: e.message }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[billet-pay] Batch created:', JSON.stringify(paymentData));

    const batchId = paymentData.id;
    const billetId = paymentData.billets?.[0]?.id || '';
    const externalId = `${batchId}:${billetId}`;
    const amount = billetAmount ?? parsePositiveAmount(paymentData.billets?.[0]?.value) ?? 0;

    // Save transaction
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

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
        external_id: externalId,
        pix_provider_response: paymentData,
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('[billet-pay] Failed to create transaction:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to save transaction' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    await supabaseAdmin.from('audit_logs').insert({
      user_id: userId,
      company_id,
      entity_type: 'transaction',
      entity_id: newTransaction.id,
      action: 'billet_payment_initiated',
      new_data: { provider: 'transfeera', externalId, amount, status: 'pending' },
    });

    return new Response(
      JSON.stringify({
        success: true,
        transaction_id: newTransaction.id,
        external_id: externalId,
        batch_id: batchId,
        billet_id: billetId,
        status: paymentData.status || 'PROCESSING',
        billet_info: billetInfo,
        provider_response: paymentData,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[billet-pay] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
