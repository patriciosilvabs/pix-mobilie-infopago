import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function callOnzProxy(url: string, method: string, headers: Record<string, string>, body?: any) {
  const proxyUrl = (Deno.env.get('ONZ_PROXY_URL') || '').replace(/\/$/, '');
  if (!proxyUrl) throw new Error('ONZ_PROXY_URL not configured');
  const target = new URL(url);
  let path = target.pathname.replace(/^\/api\/v2/, '');
  const routePrefix = (target.hostname.includes('pix.infopago') && !target.hostname.includes('cashout')) ? '/pix' : '/cashout';
  const fullProxyUrl = `${proxyUrl}${routePrefix}${path}${target.search || ''}`;
  console.log(`[callOnzProxy] ${method} ${fullProxyUrl} (target: ${url})`);
  const resp = await fetch(fullProxyUrl, { method, headers: { ...headers }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  const ct = resp.headers.get('content-type') || '';
  const text = await resp.text();
  let data: any = text;
  if (ct.includes('application/json')) { try { data = JSON.parse(text); } catch { /* keep text */ } }
  return { ok: resp.status >= 200 && resp.status < 300, status: resp.status, data };
}

// Parse EMV QR Code TLV format (local fallback)
function parseEmv(emv: string): Record<string, string> {
  const result: Record<string, string> = {};
  let i = 0;
  while (i + 4 <= emv.length) {
    const tag = emv.substring(i, i + 2);
    const len = parseInt(emv.substring(i + 2, i + 4), 10);
    if (isNaN(len) || i + 4 + len > emv.length) break;
    result[tag] = emv.substring(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return result;
}

function extractPixKey(emv: string): string | null {
  const tags = parseEmv(emv);
  const tag26 = tags['26'];
  if (!tag26) return null;
  const innerTags = parseEmv(tag26);
  return innerTags['01'] || null;
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

    const body = await req.json();
    const { company_id, qr_code: rawQrCode } = body;

    if (!company_id || !rawQrCode) {
      return new Response(JSON.stringify({ error: 'company_id and qr_code are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const qr_code = rawQrCode.trim().replace(/[\r\n\t]/g, '').replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '');

    // Get config
    let config: any = null;
    const { data: cashOutConfig } = await supabase
      .from('pix_configs').select('*')
      .eq('company_id', company_id).eq('is_active', true)
      .in('purpose', ['cash_out', 'both']).limit(1).maybeSingle();
    config = cashOutConfig;

    // Try ONZ API: POST /pix/payments/qrc/info
    if (config) {
      try {
        const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
          method: 'POST',
          headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
          body: JSON.stringify({ company_id, purpose: 'cash_out' }),
        });

        if (authResponse.ok) {
          const { access_token } = await authResponse.json();
          const baseUrl = config.base_url.replace(/\/$/, '');
          const idempotencyKey = crypto.randomUUID().replace(/-/g, '').substring(0, 50);

          const result = await callOnzProxy(`${baseUrl}/pix/payments/qrc/info`, 'POST', {
            'Authorization': `Bearer ${access_token}`,
            'Content-Type': 'application/json',
            'x-idempotency-key': idempotencyKey,
          }, { qrCode: qr_code });

          if (result.ok && result.data) {
            const d = result.data;
            console.log('[pix-qrc-info] ONZ response:', JSON.stringify(d));

            return new Response(JSON.stringify({
              success: true,
              provider: 'onz',
              type: d.type || (d.url ? 'dynamic' : 'static'),
              merchant_name: d.merchantName || null,
              merchant_city: d.merchantCity || null,
              amount: d.transactionAmount || null,
              pix_key: d.chave || extractPixKey(qr_code),
              txid: d.txid || null,
              end_to_end_id: d.endToEndId || null,
              payload: d.payload || d,
            }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }
          console.warn('[pix-qrc-info] ONZ qrc/info failed, falling back to local parse:', result.data);
        }
      } catch (e) {
        console.warn('[pix-qrc-info] ONZ API error, falling back to local parse:', e.message);
      }
    }

    // Fallback: local EMV parsing
    const emvTags = parseEmv(qr_code);
    const pointOfInitiation = emvTags['01'];
    const isDynamic = pointOfInitiation === '12';
    const merchantName = emvTags['59'] || null;
    const merchantCity = emvTags['60'] || null;
    let amount: number | null = emvTags['54'] ? parseFloat(emvTags['54']) : null;
    const pixKey = extractPixKey(qr_code);

    let txid: string | null = null;
    if (emvTags['62']) {
      const tag62 = parseEmv(emvTags['62']);
      txid = tag62['05'] || null;
    }

    return new Response(JSON.stringify({
      success: true,
      provider: 'local',
      type: isDynamic ? 'dynamic' : 'static',
      merchant_name: merchantName,
      merchant_city: merchantCity,
      amount,
      pix_key: pixKey,
      txid,
      end_to_end_id: null,
      payload: emvTags,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[pix-qrc-info] Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
