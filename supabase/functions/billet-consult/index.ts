import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ONZ does not have a billet consult endpoint.
// This function parses the barcode locally to extract basic info.

function parseBoletoBarcode(code: string): any {
  const clean = code.replace(/[\s.\-]/g, '');
  const isBoleto = clean.length === 47 || clean.length === 48;
  const isConvenio = clean.length === 48 && ['8', '9'].includes(clean[0]);

  if (!isBoleto && !isConvenio) {
    return { valid: false, error: 'Código de barras inválido' };
  }

  if (isConvenio) {
    // Convênio (concessionárias, IPTU, etc.)
    const segmentId = clean[1];
    const segmentMap: Record<string, string> = {
      '1': 'Prefeituras', '2': 'Saneamento', '3': 'Energia/Gás',
      '4': 'Telecomunicações', '5': 'Órgãos governamentais',
      '6': 'Taxas e tributos', '7': 'Multas de trânsito',
      '9': 'Outros',
    };
    // Value is embedded in positions 4-14 (with 2 decimal places)
    const rawValue = clean.substring(4, 15);
    const value = parseInt(rawValue, 10) / 100;

    return {
      valid: true,
      type: 'convenio',
      segment: segmentMap[segmentId] || 'Outros',
      value: value > 0 ? value : null,
      barcode: clean,
    };
  }

  // Boleto bancário
  const bankCode = clean.substring(0, 3);
  // Factor date (from position 33-36 in barcode, or 5-9 in linha digitável)
  // Value in cents (positions 37-46 in barcode)
  // For linha digitável (47 digits), the factor and value positions differ
  let value: number | null = null;
  if (clean.length === 47) {
    const rawValue = clean.substring(37, 47);
    value = parseInt(rawValue, 10) / 100;
  }

  const bankNames: Record<string, string> = {
    '001': 'Banco do Brasil', '033': 'Santander', '104': 'Caixa Econômica',
    '237': 'Bradesco', '341': 'Itaú', '356': 'ABN AMRO', '389': 'Mercantil',
    '399': 'HSBC', '422': 'Safra', '453': 'Rural', '633': 'Rendimento',
    '652': 'Itaú BBA', '745': 'Citibank', '756': 'Sicoob',
  };

  return {
    valid: true,
    type: 'boleto',
    bank_code: bankCode,
    bank_name: bankNames[bankCode] || `Banco ${bankCode}`,
    value: value && value > 0 ? value : null,
    barcode: clean,
  };
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
    const { company_id, codigo_barras } = body;

    if (!company_id || !codigo_barras) {
      return new Response(JSON.stringify({ error: 'company_id and codigo_barras are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const cleanBarcode = codigo_barras.replace(/[\s.\-]/g, '');
    console.log(`[billet-consult] Local parsing: ${cleanBarcode}`);

    const parsed = parseBoletoBarcode(cleanBarcode);

    if (!parsed.valid) {
      return new Response(JSON.stringify({ error: parsed.error || 'Código inválido' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({
      success: true,
      value: parsed.value,
      total_updated_value: parsed.value,
      due_date: null,
      fine_value: null,
      interest_value: null,
      discount_value: null,
      recipient_name: parsed.bank_name || parsed.segment || null,
      recipient_document: null,
      type: parsed.type,
      status: null,
      digitable_line: cleanBarcode,
      barcode: cleanBarcode,
      raw: parsed,
      message: 'Dados extraídos localmente do código de barras. Valor atualizado será confirmado ao efetuar o pagamento.',
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[billet-consult] Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
