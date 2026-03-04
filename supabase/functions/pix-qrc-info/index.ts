import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Parse EMV QR Code TLV (Tag-Length-Value) format
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

// Extract URL from tag 26 (Merchant Account Information)
function extractPixUrl(emv: string): string | null {
  const tags = parseEmv(emv);
  const tag26 = tags['26'];
  if (!tag26) return null;
  const innerTags = parseEmv(tag26);
  // Tag 25 contains the URL for dynamic QR codes
  return innerTags['25'] || null;
}

// Extract Pix key from tag 26
function extractPixKey(emv: string): string | null {
  const tags = parseEmv(emv);
  const tag26 = tags['26'];
  if (!tag26) return null;
  const innerTags = parseEmv(tag26);
  // Tag 01 inside tag 26 is the Pix key for static QR codes
  return innerTags['01'] || null;
}

// Decode JWS payload (base64url)
function decodeJwsPayload(jws: string): any {
  const parts = jws.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
    const decoded = atob(padded);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
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
    const { company_id, qr_code: rawQrCode } = body;

    if (!company_id || !rawQrCode) {
      return new Response(
        JSON.stringify({ error: 'company_id and qr_code are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Sanitizar QR Code - remover apenas caracteres de controle e zero-width (NÃO espaços!)
    // EMV contém espaços legítimos no nome do comerciante (tag 59)
    const qr_code = rawQrCode.trim().replace(/[\r\n\t]/g, '').replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '');
    if (rawQrCode !== qr_code) {
      console.warn('[pix-qrc-info] QR Code was cleaned. Original length:', rawQrCode.length, 'Clean length:', qr_code.length);
    }

    // Parse EMV locally
    const emvTags = parseEmv(qr_code);
    console.log('[pix-qrc-info] EMV tags:', JSON.stringify(emvTags));

    const pointOfInitiation = emvTags['01']; // "11" = static, "12" = dynamic
    const isDynamic = pointOfInitiation === '12';
    const merchantName = emvTags['59'] || null;
    const merchantCity = emvTags['60'] || null;

    // Extract amount from tag 54 (Transaction Amount)
    let amount: number | null = emvTags['54'] ? parseFloat(emvTags['54']) : null;

    // Extract pix key (static QR) or URL (dynamic QR) from tag 26
    const pixUrl = extractPixUrl(qr_code);
    const pixKey = extractPixKey(qr_code);

    let txid: string | null = null;
    let cobPayload: any = null;

    // For dynamic QR codes, fetch the COBV payload URL to get amount and details
    if (isDynamic && pixUrl) {
      const fullUrl = pixUrl.startsWith('http') ? pixUrl : `https://${pixUrl}`;
      console.log('[pix-qrc-info] Fetching dynamic payload from:', fullUrl);

      try {
        const cobResponse = await fetch(fullUrl, {
          headers: { 'Accept': 'application/json, application/jose' },
        });

        if (cobResponse.ok) {
          const contentType = cobResponse.headers.get('content-type') || '';
          const responseText = await cobResponse.text();
          console.log('[pix-qrc-info] Dynamic payload response (first 500 chars):', responseText.substring(0, 500));

          if (contentType.includes('jose') || responseText.startsWith('eyJ')) {
            // JWS (signed JWT) response - decode payload
            cobPayload = decodeJwsPayload(responseText);
            console.log('[pix-qrc-info] Decoded JWS payload:', JSON.stringify(cobPayload));
          } else {
            try {
              cobPayload = JSON.parse(responseText);
            } catch {
              console.log('[pix-qrc-info] Could not parse dynamic payload as JSON');
            }
          }

          if (cobPayload) {
            // Extract amount from COBV payload
            if (cobPayload.valor?.original) {
              amount = parseFloat(cobPayload.valor.original);
            } else if (cobPayload.valor && typeof cobPayload.valor === 'string') {
              amount = parseFloat(cobPayload.valor);
            } else if (cobPayload.valor && typeof cobPayload.valor === 'number') {
              amount = cobPayload.valor;
            }

            txid = cobPayload.txid || null;
          }
        } else {
          console.log('[pix-qrc-info] Dynamic payload fetch failed:', cobResponse.status);
        }
      } catch (e) {
        console.log('[pix-qrc-info] Error fetching dynamic payload:', e.message);
      }
    }

    // Parse txid from tag 62 if not already set
    if (!txid && emvTags['62']) {
      const tag62 = parseEmv(emvTags['62']);
      txid = tag62['05'] || null;
    }

    const qrType = isDynamic ? 'dynamic' : 'static';
    console.log('[pix-qrc-info] Result - type:', qrType, 'amount:', amount, 'merchant:', merchantName);

    // Build payload URL for dynamic QR codes (needed for ONZ retry with payload_url)
    const payloadUrl = isDynamic && pixUrl
      ? (pixUrl.startsWith('http') ? pixUrl : `https://${pixUrl}`)
      : null;

    return new Response(
      JSON.stringify({
        success: true,
        provider: 'local',
        type: qrType,
        merchant_name: cobPayload?.devedor?.nome || merchantName,
        merchant_city: merchantCity,
        amount: amount,
        pix_key: cobPayload?.chave || pixKey,
        txid: txid,
        end_to_end_id: null,
        payload_url: payloadUrl,
        payload: cobPayload || emvTags,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[pix-qrc-info] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
