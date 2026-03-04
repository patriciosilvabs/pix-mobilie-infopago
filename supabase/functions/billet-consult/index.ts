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

function toNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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

    const body = await req.json();
    const { company_id, codigo_barras } = body;

    if (!company_id || !codigo_barras) {
      return new Response(
        JSON.stringify({ error: 'company_id and codigo_barras are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get config
    const { data: config } = await supabase
      .from('pix_configs').select('*')
      .eq('company_id', company_id).eq('is_active', true)
      .in('purpose', ['cash_out', 'both']).limit(1).maybeSingle();

    if (!config) {
      return new Response(
        JSON.stringify({ error: 'Configuração Pix não encontrada.' }),
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
    const cleanBarcode = codigo_barras.replace(/[\s.\-]/g, '');

    console.log(`[billet-consult] Consulting billet: ${cleanBarcode}`);

    const consultResponse = await fetch(`${apiBase}/billet/consult?code=${encodeURIComponent(cleanBarcode)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'User-Agent': 'PixContabil (contato@pixcontabil.com.br)',
      },
    });

    if (!consultResponse.ok) {
      const errText = await consultResponse.text();
      console.error('[billet-consult] Consult failed:', errText);
      return new Response(
        JSON.stringify({ error: 'Falha ao consultar boleto', details: errText }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const billetInfo = await consultResponse.json();
    console.log('[billet-consult] Result:', JSON.stringify(billetInfo));

    const paymentInfo = billetInfo?.payment_info ?? {};
    const barcodeDetails = billetInfo?.barcode_details ?? {};

    const originalValue = toNumber(
      paymentInfo.original_value ?? barcodeDetails.value ?? billetInfo?.value
    );

    const updatedValue = toNumber(
      paymentInfo.total_updated_value ?? billetInfo?.total_updated_value ?? originalValue
    );

    const fineValue = toNumber(paymentInfo.fine_value ?? billetInfo?.fine_value);
    const interestValue = toNumber(paymentInfo.interest_value ?? billetInfo?.interest_value);
    const discountValue = toNumber(
      paymentInfo.total_discount_value ?? paymentInfo.discount_value ?? billetInfo?.discount_value
    );

    const dueDate = paymentInfo.due_date ?? barcodeDetails.due_date ?? billetInfo?.due_date;
    const recipientName = paymentInfo.recipient_name ?? billetInfo?.recipient_name;
    const recipientDocument = paymentInfo.recipient_document ?? billetInfo?.recipient_document;

    // Transfeera can return nested fields in payment_info/barcode_details.
    // Normalize the payload for frontend compatibility.
    return new Response(
      JSON.stringify({
        success: true,
        value: originalValue,
        total_updated_value: updatedValue,
        due_date: dueDate,
        fine_value: fineValue,
        interest_value: interestValue,
        discount_value: discountValue,
        recipient_name: recipientName,
        recipient_document: recipientDocument,
        type: barcodeDetails.type ?? billetInfo?.type,
        status: billetInfo?.status,
        digitable_line: barcodeDetails.digitable_line ?? billetInfo?.digitable_line,
        barcode: barcodeDetails.barcode ?? billetInfo?.barcode ?? cleanBarcode,
        raw: billetInfo,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[billet-consult] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
