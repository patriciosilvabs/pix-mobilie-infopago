import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
};

// Rate limiting
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = 100;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

async function verifyWebhookSecret(req: Request, supabaseAdmin: any): Promise<boolean> {
  const headerSecret = req.headers.get('x-webhook-secret');
  const urlSecret = new URL(req.url).searchParams.get('whs');
  const webhookSecret = headerSecret || urlSecret;
  if (!webhookSecret) return false;

  const { data: matchingConfigs } = await supabaseAdmin
    .from('pix_configs').select('id').eq('webhook_secret', webhookSecret).eq('is_active', true).limit(1);
  return matchingConfigs && matchingConfigs.length > 0;
}

// ONZ status mapping
const ONZ_STATUS_MAP: Record<string, string> = {
  'PROCESSING': 'pending',
  'LIQUIDATED': 'completed',
  'CANCELED': 'failed',
  'REFUNDED': 'completed',
  'PARTIALLY_REFUNDED': 'completed',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (req.method === 'GET') {
    return new Response(JSON.stringify({ status: 'ok', message: 'Webhook endpoint active' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const ip_address = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';

  if (isRateLimited(ip_address)) {
    return new Response(JSON.stringify({ error: 'Too many requests' }),
      { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const isAuthorized = await verifyWebhookSecret(req.clone(), supabaseAdmin);
    if (!isAuthorized) {
      await supabaseAdmin.from('pix_webhook_logs').insert({
        event_type: 'UNAUTHORIZED', payload: { message: 'Invalid webhook secret' },
        ip_address, processed: false, error_message: 'Webhook secret verification failed',
      });
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let payload: any;
    try {
      const body = await req.text();
      if (body.length > 1_000_000) {
        return new Response(JSON.stringify({ error: 'Payload too large' }),
          { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      payload = JSON.parse(body);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log('[pix-webhook] ONZ webhook received from IP:', ip_address);

    // ONZ webhook format: { data: { ... }, type: "TRANSFER" | "RECEIVE" | "REFUND" | "CASHOUT" | "INFRACTION" }
    const eventType = payload.type || 'UNKNOWN';
    const eventData = payload.data || payload;

    await supabaseAdmin.from('pix_webhook_logs').insert({
      event_type: eventType, payload, ip_address, processed: false,
    });

    if (eventType === 'TRANSFER' || eventType === 'CASHOUT') {
      return await handleTransferWebhook(supabaseAdmin, eventType, eventData);
    }

    if (eventType === 'RECEIVE') {
      return await handleReceiveWebhook(supabaseAdmin, eventData);
    }

    if (eventType === 'REFUND') {
      return await handleRefundWebhook(supabaseAdmin, eventData);
    }

    return new Response(JSON.stringify({ success: true, message: `Event type: ${eventType}` }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[pix-webhook] Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

async function handleTransferWebhook(supabaseAdmin: any, eventType: string, data: any) {
  const endToEndId = data.endToEndId || '';
  const onzId = String(data.id || '');
  const rawStatus = String(data.status || '').replace(/,/g, '').toUpperCase();
  const internalStatus = ONZ_STATUS_MAP[rawStatus] || 'pending';

  let transaction: any = null;

  // Find by endToEndId
  if (endToEndId) {
    const { data: txByE2e } = await supabaseAdmin
      .from('transactions').select('id, company_id, status')
      .eq('pix_e2eid', endToEndId).limit(1);
    transaction = txByE2e?.[0] || null;
  }

  // Find by ONZ id
  if (!transaction && onzId) {
    const { data: txById } = await supabaseAdmin
      .from('transactions').select('id, company_id, status')
      .eq('external_id', onzId).limit(1);
    transaction = txById?.[0] || null;
  }

  // Find by idempotencyKey
  if (!transaction && data.idempotencyKey) {
    const { data: txByKey } = await supabaseAdmin
      .from('transactions').select('id, company_id, status')
      .eq('pix_provider_response->>idempotencyKey', data.idempotencyKey).limit(1);
    transaction = txByKey?.[0] || null;
  }

  if (transaction) {
    const updateData: any = {
      status: internalStatus,
      pix_provider_response: data,
      pix_e2eid: endToEndId || undefined,
    };
    if (internalStatus === 'completed') updateData.paid_at = new Date().toISOString();
    await supabaseAdmin.from('transactions').update(updateData).eq('id', transaction.id);

    // Auto-generate receipt
    if (internalStatus === 'completed') {
      fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-pix-receipt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
        body: JSON.stringify({ transaction_id: transaction.id, company_id: transaction.company_id }),
      }).catch(e => console.error('[pix-webhook] Auto-receipt failed:', e));
    }

    await supabaseAdmin.from('audit_logs').insert({
      company_id: transaction.company_id,
      entity_type: 'transaction', entity_id: transaction.id,
      action: 'pix_webhook_received',
      old_data: { status: transaction.status },
      new_data: { status: internalStatus, endToEndId, onzId, provider: 'onz', eventType },
    });
  } else {
    console.warn('[pix-webhook] Transfer not matched to local transaction', { endToEndId, onzId, rawStatus });
  }

  return new Response(JSON.stringify({ success: true }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function handleReceiveWebhook(supabaseAdmin: any, data: any) {
  const e2eId = data.endToEndId || '';
  const pixKey = data.pixKey || data.chave || '';

  if (pixKey) {
    const { data: configs } = await supabaseAdmin
      .from('pix_configs').select('company_id')
      .eq('pix_key', pixKey).eq('is_active', true).limit(1);

    if (configs && configs.length > 0) {
      await supabaseAdmin.from('transactions').insert({
        company_id: configs[0].company_id,
        created_by: '00000000-0000-0000-0000-000000000000',
        amount: parseFloat(data.payment?.amount || 0),
        status: 'completed',
        pix_type: 'key',
        pix_key: pixKey,
        pix_e2eid: e2eId,
        description: data.remittanceInformation || 'Recebimento Pix',
        paid_at: new Date().toISOString(),
        pix_provider_response: data,
      });
    }
  }

  return new Response(JSON.stringify({ success: true }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function handleRefundWebhook(supabaseAdmin: any, data: any) {
  const endToEndId = data.endToEndId || '';

  if (endToEndId) {
    const { data: refunds } = await supabaseAdmin
      .from('pix_refunds').select('id')
      .eq('e2eid', endToEndId).limit(1);

    if (refunds?.[0]) {
      await supabaseAdmin.from('pix_refunds').update({
        status: data.status || 'DEVOLVIDO',
        refunded_at: new Date().toISOString(),
      }).eq('id', refunds[0].id);
    }
  }

  return new Response(JSON.stringify({ success: true }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
