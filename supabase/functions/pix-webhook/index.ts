import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
};

function sanitizeString(str: unknown, maxLength = 255): string {
  if (typeof str !== 'string') return '';
  return str.replace(/[^\w\s\-.:@/]/g, '').substring(0, maxLength);
}

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

  if (!webhookSecret) {
    console.warn(`[pix-webhook] Webhook secret header/query missing (method: ${req.method})`);
    return false;
  }

  const { data: matchingConfigs } = await supabaseAdmin
    .from('pix_configs').select('id').eq('webhook_secret', webhookSecret).eq('is_active', true).limit(1);
  return matchingConfigs && matchingConfigs.length > 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Transfeera tests the webhook URL with a GET request during registration
  if (req.method === 'GET') {
    return new Response(
      JSON.stringify({ status: 'ok', message: 'Webhook endpoint active' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const ip_address = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';

  if (isRateLimited(ip_address)) {
    return new Response(
      JSON.stringify({ error: 'Too many requests' }),
      { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const isAuthorized = await verifyWebhookSecret(req.clone(), supabaseAdmin);
    if (!isAuthorized) {
      await supabaseAdmin.from('pix_webhook_logs').insert({
        event_type: 'UNAUTHORIZED',
        payload: { message: 'Invalid or missing webhook secret' },
        ip_address,
        processed: false,
        error_message: 'Webhook secret verification failed',
      });
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let payload: any;
    try {
      const body = await req.text();
      if (body.length > 1_000_000) {
        return new Response(
          JSON.stringify({ error: 'Payload too large' }),
          { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      payload = JSON.parse(body);
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[pix-webhook] Received webhook from IP:', ip_address);

    // Transfeera webhook format: { id, object, data: { ... } }
    const objectType = payload.object || payload.type || 'UNKNOWN';
    const eventData = payload.data || payload;

    await supabaseAdmin.from('pix_webhook_logs').insert({
      event_type: objectType,
      payload,
      ip_address,
      processed: false,
    });

    if (objectType === 'Transfer' || objectType === 'TransferRefund') {
      return await handleTransferWebhook(supabaseAdmin, objectType, eventData, ip_address);
    }

    if (objectType === 'Billet') {
      return await handleBilletWebhook(supabaseAdmin, eventData, ip_address);
    }

    if (objectType === 'CashIn') {
      return await handleCashInWebhook(supabaseAdmin, eventData, ip_address);
    }

    // Unknown object type - log and return OK
    return new Response(
      JSON.stringify({ success: true, message: `Unknown object type: ${objectType}` }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[pix-webhook] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Handle Transfer and TransferRefund webhooks
async function handleTransferWebhook(supabaseAdmin: any, objectType: string, data: any, ip_address: string) {
  const transferId = String(data.transfer_id || data.id || '').trim();
  const batchId = String(data.batch_id || '').trim();
  const status = String(data.status || '').toUpperCase();

  const statusMap: Record<string, string> = {
    'FINALIZADO': 'completed',
    'TRANSFERENCIA_REALIZADA': 'completed',
    'TRANSFERENCIA_CONFIRMADA': 'completed',
    'RECEBIDO': 'pending',
    'CRIADO': 'pending',
    'FALHA': 'failed',
    'DEVOLVIDO': 'refunded',
    'ESTORNADO': 'refunded',
  };
  const internalStatus = statusMap[status] || 'pending';

  let transaction: any = null;

  if (transferId) {
    const { data: txByTransfer } = await supabaseAdmin
      .from('transactions')
      .select('id, company_id, status, external_id')
      .or(`external_id.ilike.%${transferId}%`)
      .limit(1);

    transaction = txByTransfer?.[0] || null;
  }

  if (!transaction && batchId) {
    const { data: txByBatch } = await supabaseAdmin
      .from('transactions')
      .select('id, company_id, status, external_id')
      .ilike('external_id', `${batchId}%`)
      .limit(1);

    transaction = txByBatch?.[0] || null;
  }

  if (transaction) {
    const updateData: any = {
      status: internalStatus,
      pix_provider_response: data,
      pix_e2eid: data.end_to_end_id || data.e2e_id || data.pix_end2end_id || null,
    };

    if (batchId && transferId) {
      updateData.external_id = `${batchId}:${transferId}`;
    }

    if (internalStatus === 'completed') updateData.paid_at = new Date().toISOString();

    await supabaseAdmin.from('transactions').update(updateData).eq('id', transaction.id);

    // Auto-generate receipt
    if (internalStatus === 'completed') {
      try {
        fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-pix-receipt`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          },
          body: JSON.stringify({ transaction_id: transaction.id, company_id: transaction.company_id }),
        }).catch(e => console.error('[pix-webhook] Auto-receipt failed:', e));
      } catch (e) {
        console.error('[pix-webhook] Error triggering receipt:', e);
      }
    }

    await supabaseAdmin.from('audit_logs').insert({
      company_id: transaction.company_id,
      entity_type: 'transaction',
      entity_id: transaction.id,
      action: 'pix_webhook_received',
      old_data: { status: transaction.status },
      new_data: { status: internalStatus, transferId, batchId, provider: 'transfeera', objectType },
    });
  } else {
    console.warn('[pix-webhook] Transfer not matched to local transaction', { transferId, batchId, status });
  }

  // Handle TransferRefund
  if (objectType === 'TransferRefund' && data.end_to_end_id) {
    const { data: refunds } = await supabaseAdmin
      .from('pix_refunds').select('id')
      .eq('e2eid', data.end_to_end_id).limit(1);

    if (refunds?.[0]) {
      await supabaseAdmin.from('pix_refunds').update({
        status: data.status || 'DEVOLVIDO',
        refunded_at: new Date().toISOString(),
      }).eq('id', refunds[0].id);
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Handle Billet webhooks
async function handleBilletWebhook(supabaseAdmin: any, data: any, ip_address: string) {
  const billetId = data.id;
  const status = String(data.status || '').toUpperCase();

  const statusMap: Record<string, string> = {
    'PAGO': 'completed',
    'FALHA': 'failed',
    'DEVOLVIDO': 'refunded',
    'AGENDADO': 'pending',
    'CRIADA': 'pending',
  };
  const internalStatus = statusMap[status] || 'pending';

  if (billetId) {
    const { data: transactions } = await supabaseAdmin
      .from('transactions')
      .select('id, company_id, status')
      .or(`external_id.ilike.%${billetId}%`)
      .limit(1);

    const transaction = transactions?.[0];

    if (transaction) {
      const updateData: any = { status: internalStatus, pix_provider_response: data };
      if (internalStatus === 'completed') updateData.paid_at = new Date().toISOString();
      await supabaseAdmin.from('transactions').update(updateData).eq('id', transaction.id);

      await supabaseAdmin.from('audit_logs').insert({
        company_id: transaction.company_id,
        entity_type: 'transaction',
        entity_id: transaction.id,
        action: 'billet_webhook_received',
        old_data: { status: transaction.status },
        new_data: { status: internalStatus, billetId, provider: 'transfeera' },
      });
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Handle CashIn webhooks (incoming Pix payments)
async function handleCashInWebhook(supabaseAdmin: any, data: any, ip_address: string) {
  const e2eId = data.end_to_end_id || data.e2e_id;
  const pixKey = data.pix_key || data.key;

  if (pixKey) {
    const { data: configs } = await supabaseAdmin
      .from('pix_configs').select('company_id')
      .eq('pix_key', pixKey).eq('is_active', true).limit(1);

    if (configs && configs.length > 0) {
      await supabaseAdmin.from('transactions').insert({
        company_id: configs[0].company_id,
        created_by: '00000000-0000-0000-0000-000000000000',
        amount: parseFloat(data.value || data.amount || 0),
        status: 'completed',
        pix_type: 'key',
        pix_key: pixKey,
        pix_e2eid: e2eId,
        description: data.description || 'Recebimento Pix',
        paid_at: new Date().toISOString(),
        pix_provider_response: data,
      });
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
