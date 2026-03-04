import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const { transaction_id, company_id } = await req.json();

    if (!transaction_id || !company_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'transaction_id and company_id are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[generate-pix-receipt] Starting for transaction ${transaction_id}`);

    // Idempotency: check if receipt already exists
    const { data: existingReceipt } = await supabaseAdmin
      .from('receipts')
      .select('id')
      .eq('transaction_id', transaction_id)
      .limit(1)
      .maybeSingle();

    if (existingReceipt) {
      console.log(`[generate-pix-receipt] Receipt already exists for transaction ${transaction_id}`);
      return new Response(
        JSON.stringify({ success: true, already_exists: true, receipt_id: existingReceipt.id }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch transaction data
    const { data: transaction, error: txError } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('id', transaction_id)
      .eq('company_id', company_id)
      .single();

    if (txError || !transaction) {
      console.error('[generate-pix-receipt] Transaction not found:', txError);
      return new Response(
        JSON.stringify({ success: false, error: 'Transaction not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Format values for the receipt
    const now = new Date();
    const paymentDate = transaction.paid_at ? new Date(transaction.paid_at) : now;
    const formattedDate = paymentDate.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const formattedAmount = Number(transaction.amount).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
    const pixKey = transaction.pix_key || transaction.pix_copy_paste || '-';
    const beneficiary = transaction.beneficiary_name || '-';
    const e2eId = transaction.pix_e2eid || '-';
    const statusText = transaction.status === 'completed' ? 'Confirmado' :
                       transaction.status === 'failed' ? 'Falhou' : 'Pendente';

    // Generate SVG receipt
    const svgWidth = 400;
    const svgHeight = 480;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">
  <defs>
    <linearGradient id="headerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:#1a7f5a;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#22c55e;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="${svgWidth}" height="${svgHeight}" rx="12" fill="#ffffff" stroke="#e2e8f0" stroke-width="1"/>
  
  <!-- Header -->
  <rect width="${svgWidth}" height="80" rx="12" fill="url(#headerGrad)"/>
  <rect y="68" width="${svgWidth}" height="12" fill="url(#headerGrad)"/>
  <text x="${svgWidth / 2}" y="38" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="18" font-weight="bold">COMPROVANTE PIX</text>
  <text x="${svgWidth / 2}" y="60" text-anchor="middle" fill="#d1fae5" font-family="Arial, sans-serif" font-size="11">Transferência realizada</text>
  
  <!-- Content -->
  ${receiptRow('Data/Hora', formattedDate, 110)}
  ${receiptRow('Valor', formattedAmount, 155, true)}
  ${receiptRow('Chave Pix', truncate(pixKey, 40), 200)}
  ${receiptRow('Beneficiário', truncate(beneficiary, 35), 245)}
  ${receiptRow('E2E ID', truncate(e2eId, 35), 290)}
  ${receiptRow('Status', statusText, 335)}
  
  <!-- Divider -->
  <line x1="24" y1="370" x2="${svgWidth - 24}" y2="370" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="4,4"/>
  
  <!-- Footer -->
  <text x="${svgWidth / 2}" y="400" text-anchor="middle" fill="#94a3b8" font-family="Arial, sans-serif" font-size="10">Comprovante gerado automaticamente</text>
  <text x="${svgWidth / 2}" y="418" text-anchor="middle" fill="#94a3b8" font-family="Arial, sans-serif" font-size="10">${now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</text>
  <text x="${svgWidth / 2}" y="450" text-anchor="middle" fill="#cbd5e1" font-family="Arial, sans-serif" font-size="9">ID: ${transaction_id.substring(0, 8)}</text>
</svg>`;

    // Convert SVG to PNG using resvg-wasm
    let pngData: Uint8Array;
    try {
      const { Resvg } = await import("npm:@resvg/resvg-js@2.6.0");
      const resvg = new Resvg(svg, {
        fitTo: { mode: 'width', value: svgWidth * 2 }, // 2x for retina
      });
      const rendered = resvg.render();
      pngData = rendered.asPng();
    } catch (resvgError) {
      console.error('[generate-pix-receipt] resvg error, falling back to SVG:', resvgError);
      // Fallback: store as SVG if resvg fails
      pngData = new TextEncoder().encode(svg);
    }

    // Upload to storage
    const timestamp = Date.now();
    const isPng = pngData[0] === 0x89; // PNG magic byte check
    const ext = isPng ? 'png' : 'svg';
    const contentType = isPng ? 'image/png' : 'image/svg+xml';
    const filePath = `${company_id}/${transaction_id}/${timestamp}_comprovante_pix.${ext}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from('receipts')
      .upload(filePath, pngData, {
        contentType,
        upsert: false,
      });

    if (uploadError) {
      console.error('[generate-pix-receipt] Upload error:', uploadError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to upload receipt' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create receipt record (uploaded_by = system user for auto-generated)
    const { data: receipt, error: receiptError } = await supabaseAdmin
      .from('receipts')
      .insert({
        transaction_id,
        file_url: filePath,
        file_name: `comprovante_pix.${ext}`,
        file_type: contentType,
        uploaded_by: transaction.created_by,
        ocr_status: 'completed',
        ocr_data: {
          auto_generated: true,
          pix_key: pixKey,
          beneficiary,
          e2e_id: e2eId,
          amount: transaction.amount,
          status: transaction.status,
        },
        extracted_value: transaction.amount,
        extracted_date: paymentDate.toISOString().split('T')[0],
      })
      .select('id')
      .single();

    if (receiptError) {
      console.error('[generate-pix-receipt] Insert receipt error:', receiptError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to create receipt record' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[generate-pix-receipt] Receipt created: ${receipt.id} at ${filePath}`);

    return new Response(
      JSON.stringify({ success: true, receipt_id: receipt.id, file_path: filePath }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[generate-pix-receipt] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function receiptRow(label: string, value: string, y: number, highlight = false): string {
  const valueColor = highlight ? '#1a7f5a' : '#1e293b';
  const valueFontSize = highlight ? '16' : '13';
  const valueWeight = highlight ? 'bold' : 'normal';
  return `
  <text x="24" y="${y}" fill="#64748b" font-family="Arial, sans-serif" font-size="11" font-weight="bold">${escapeXml(label)}</text>
  <text x="24" y="${y + 20}" fill="${valueColor}" font-family="Arial, sans-serif" font-size="${valueFontSize}" font-weight="${valueWeight}">${escapeXml(value)}</text>`;
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.substring(0, max - 3) + '...';
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
