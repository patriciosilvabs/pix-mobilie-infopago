import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    const { company_id } = await req.json();
    if (!company_id) {
      return new Response(
        JSON.stringify({ error: 'company_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[register-webhook] Starting for company: ${company_id}`);

    // Get pix_configs for this company
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: configs } = await supabaseAdmin
      .from('pix_configs')
      .select('*')
      .eq('company_id', company_id)
      .eq('is_active', true)
      .limit(1);

    const config = configs?.[0];
    if (!config) {
      return new Response(
        JSON.stringify({ error: 'Configuração Pix não encontrada para esta empresa' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. Authenticate DIRECTLY with Transfeera (always fresh token, never cached)
    const isSandbox = config.is_sandbox;
    const authUrl = isSandbox
      ? 'https://login-api-sandbox.transfeera.com/authorization'
      : 'https://login-api.transfeera.com/authorization';

    console.log(`[register-webhook] Authenticating at ${authUrl} (sandbox: ${isSandbox})`);

    const tokenResponse = await fetch(authUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'PixContabil (contato@pixcontabil.com.br)',
      },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: config.client_id,
        client_secret: config.client_secret_encrypted,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[register-webhook] Auth failed:', errorText);
      return new Response(
        JSON.stringify({ error: 'Falha ao autenticar com Transfeera', details: errorText }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { access_token } = await tokenResponse.json();
    console.log('[register-webhook] Auth successful');

    // 2. Build webhook URLs for this project
    const publicWebhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-webhook`;
    const webhookSecret = config.webhook_secret;
    const webhookUrl = webhookSecret
      ? `${publicWebhookUrl}?whs=${encodeURIComponent(webhookSecret)}`
      : publicWebhookUrl;
    const apiBaseUrl = isSandbox
      ? 'https://api-sandbox.transfeera.com'
      : 'https://api.transfeera.com';

    const apiHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${access_token}`,
      'User-Agent': 'PixContabil (contato@pixcontabil.com.br)',
    };

    // 3. Check existing webhooks
    console.log('[register-webhook] Checking existing webhooks...');
    const listResponse = await fetch(`${apiBaseUrl}/webhook`, {
      method: 'GET',
      headers: apiHeaders,
    });

    let existingWebhooks: any[] = [];
    if (listResponse.ok) {
      const listData = await listResponse.json();
      existingWebhooks = Array.isArray(listData) ? listData : (listData?.data || []);
      console.log(`[register-webhook] Found ${existingWebhooks.length} existing webhook(s)`);
    } else {
      console.log('[register-webhook] Could not list webhooks, will try to create');
    }

    const objectTypes = ['Transfer', 'TransferRefund', 'CashIn', 'CashInRefund'];
    // Match by URL first, or fall back to ANY existing webhook (to handle "1 per object_types" constraint)
    const existingMatch = existingWebhooks.find((w: any) => w.url === webhookUrl) || existingWebhooks[0];

    let result: any;

    if (existingMatch) {
      // 4a. Update existing webhook (same URL or different — Transfeera only allows 1 per object_types)
      console.log(`[register-webhook] Updating existing webhook ID: ${existingMatch.id} (current URL: ${existingMatch.url})`);
      const updateResponse = await fetch(`${apiBaseUrl}/webhook/${existingMatch.id}`, {
        method: 'PUT',
        headers: apiHeaders,
        body: JSON.stringify({
          url: webhookUrl,
          object_types: objectTypes,
        }),
      });

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        console.error('[register-webhook] Update failed:', errorText);
        return new Response(
          JSON.stringify({ error: 'Falha ao atualizar webhook', details: errorText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      result = { action: 'updated', webhook_id: existingMatch.id };
    } else {
      // 4b. Create new webhook (no existing webhooks at all)
      console.log('[register-webhook] Creating new webhook...');
      const createResponse = await fetch(`${apiBaseUrl}/webhook`, {
        method: 'POST',
        headers: apiHeaders,
        body: JSON.stringify({
          url: webhookUrl,
          object_types: objectTypes,
        }),
      });

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        console.error('[register-webhook] Create failed:', errorText);
        return new Response(
          JSON.stringify({ error: 'Falha ao registrar webhook', details: errorText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const createData = await createResponse.json();
      result = { action: 'created', webhook_id: createData.id };
    }

    // 5. Save canonical webhook_url in pix_configs (without secret in query string)
    await supabaseAdmin
      .from('pix_configs')
      .update({ webhook_url: publicWebhookUrl })
      .eq('id', config.id);

    console.log(`[register-webhook] Success: ${result.action} webhook ${result.webhook_id}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: result.action === 'updated'
          ? 'Webhook atualizado com sucesso na Transfeera'
          : 'Webhook registrado com sucesso na Transfeera',
        ...result,
        url: publicWebhookUrl,
        object_types: objectTypes,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[register-webhook] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Erro interno', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
