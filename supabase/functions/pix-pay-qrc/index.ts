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

    const userId = user.id;
    const body = await req.json();
    const { company_id, qr_code: rawQrCode, valor, descricao, idempotency_key } = body;

    if (!company_id || !rawQrCode) {
      return new Response(JSON.stringify({ error: 'company_id and qr_code are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const qr_code = rawQrCode.trim().replace(/[\r\n\t]/g, '').replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '');

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
      return new Response(JSON.stringify({ error: 'Pix configuration not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // First get QR code info from ONZ
    const qrcInfoResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-qrc-info`, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id, qr_code }),
    });

    let qrcInfo: any = {};
    if (qrcInfoResponse.ok) {
      qrcInfo = await qrcInfoResponse.json();
    }

    const qrEmbeddedAmount = Number(qrcInfo.amount || qrcInfo.transactionAmount || 0);
    const hasEmbeddedAmount = Number.isFinite(qrEmbeddedAmount) && qrEmbeddedAmount > 0;
    const paymentAmount = hasEmbeddedAmount ? qrEmbeddedAmount : (valor || 0);

    const MAX_PAYMENT_VALUE = 1_000_000;
    if (paymentAmount <= 0 || paymentAmount > MAX_PAYMENT_VALUE) {
      return new Response(JSON.stringify({ error: 'Valor inválido.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Idempotency check
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    if (idempotency_key) {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: existing } = await supabaseAdmin.from('transactions')
        .select('id, status').eq('company_id', company_id).eq('pix_copia_cola', qr_code)
        .eq('created_by', userId).gte('created_at', fiveMinAgo)
        .in('status', ['pending', 'completed']).limit(1).maybeSingle();
      if (existing) {
        return new Response(JSON.stringify({ success: true, transaction_id: existing.id, duplicate: true, status: existing.status }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // Get auth token
    const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id, purpose: 'cash_out' }),
    });
    if (!authResponse.ok) {
      return new Response(JSON.stringify({ error: 'Failed to authenticate with ONZ' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const { access_token } = await authResponse.json();

    const baseUrl = config.base_url.replace(/\/$/, '');
    const idempotencyKey = idempotency_key || crypto.randomUUID().replace(/-/g, '').substring(0, 50);

    // ONZ: POST /pix/payments/qrc
    console.log(`[pix-pay-qrc] ONZ: amount=${paymentAmount}`);

    let paymentData: any;
    try {
      const result = await callOnzProxy(`${baseUrl}/pix/payments/qrc`, 'POST', {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
        'x-idempotency-key': idempotencyKey,
      }, {
        qrCode: qr_code,
        description: descricao || 'Pagamento via QR Code',
        payment: { currency: 'BRL', amount: Number(paymentAmount.toFixed(2)) },
      });

      if (!result.ok) {
        console.error('[pix-pay-qrc] ONZ error:', JSON.stringify(result.data));

        // Fallback: if QR has a pix key, try dict payment
        const destKey = qrcInfo.pix_key || qrcInfo.chave;
        if (destKey) {
          console.log('[pix-pay-qrc] Falling back to pix-pay-dict with key:', destKey);
          const dictResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-pay-dict`, {
            method: 'POST',
            headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ company_id, pix_key: destKey, valor: paymentAmount, descricao: descricao || 'Pagamento via QR Code' }),
          });
          const dictResult = await dictResponse.json();
          if (dictResult.transaction_id) {
            await supabaseAdmin.from('transactions').update({ pix_type: 'qrcode', pix_copia_cola: qr_code }).eq('id', dictResult.transaction_id);
          }
          return new Response(JSON.stringify({ ...dictResult, amount: paymentAmount, qr_info: qrcInfo, fallback: 'dict' }),
            { status: dictResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        return new Response(JSON.stringify({ error: 'Falha no pagamento via QR Code', details: result.data }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      paymentData = result.data;
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Falha na conexão com ONZ', details: e.message }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log('[pix-pay-qrc] ONZ response:', JSON.stringify(paymentData));

    const onzId = String(paymentData.id || '');
    const endToEndId = paymentData.endToEndId || '';

    // Save transaction
    const { data: transaction, error: txError } = await supabaseAdmin.from('transactions').insert({
      company_id,
      created_by: userId,
      amount: paymentAmount,
      description: descricao || 'Pagamento via QR Code',
      pix_type: 'qrcode',
      pix_copia_cola: qr_code,
      pix_txid: qrcInfo.txid || null,
      pix_e2eid: endToEndId,
      external_id: onzId,
      beneficiary_name: qrcInfo.merchant_name || qrcInfo.merchantName || null,
      status: 'pending',
      pix_provider_response: paymentData,
    }).select('id').single();

    if (txError) console.error('[pix-pay-qrc] Transaction insert error:', txError);

    return new Response(JSON.stringify({
      success: true,
      transaction_id: transaction?.id || null,
      onz_id: onzId,
      end_to_end_id: endToEndId,
      amount: paymentAmount,
      qr_info: qrcInfo,
      provider_response: paymentData,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[pix-pay-qrc] Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
