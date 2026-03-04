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

    const { company_id, purpose, force_new } = await req.json();

    if (!company_id) {
      return new Response(
        JSON.stringify({ error: 'company_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[pix-auth] Getting token for company: ${company_id}, purpose: ${purpose || 'any'}`);

    // Get Pix config with purpose-aware lookup
    let config: any = null;
    if (purpose) {
      const { data: specificConfig } = await supabase
        .from('pix_configs')
        .select('*')
        .eq('company_id', company_id)
        .eq('is_active', true)
        .eq('purpose', purpose)
        .single();
      config = specificConfig;
    }
    if (!config) {
      const { data: bothConfig } = await supabase
        .from('pix_configs')
        .select('*')
        .eq('company_id', company_id)
        .eq('is_active', true)
        .eq('purpose', 'both')
        .single();
      config = bothConfig;
    }
    if (!config) {
      const { data: anyConfig } = await supabase
        .from('pix_configs')
        .select('*')
        .eq('company_id', company_id)
        .eq('is_active', true)
        .limit(1)
        .single();
      config = anyConfig;
    }

    if (!config) {
      return new Response(
        JSON.stringify({ error: 'Pix configuration not found for this company' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[pix-auth] Provider: transfeera`);

    // Check cached token (skip if force_new)
    if (!force_new) {
      let cachedTokenQuery = supabase
        .from('pix_tokens')
        .select('*')
        .eq('company_id', company_id)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1);
      if (config.id) {
        cachedTokenQuery = cachedTokenQuery.eq('pix_config_id', config.id);
      }
      const { data: cachedToken } = await cachedTokenQuery.single();

      if (cachedToken) {
        console.log('[pix-auth] Using cached token');
        return new Response(
          JSON.stringify({
            access_token: cachedToken.access_token,
            token_type: cachedToken.token_type,
            provider: 'transfeera',
            cached: true,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else {
      console.log('[pix-auth] force_new=true, skipping cache');
    }

    // ========== TRANSFEERA AUTH ==========
    // Determine auth URL based on sandbox vs production
    const isSandbox = config.is_sandbox;
    const authUrl = isSandbox
      ? 'https://login-api-sandbox.transfeera.com/authorization'
      : 'https://login-api.transfeera.com/authorization';

    console.log(`[pix-auth] Transfeera: requesting token from ${authUrl} (sandbox: ${isSandbox})`);

    let accessToken: string;
    const expiresInSeconds = 1800; // 30 minutes

    try {
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
        console.error('[pix-auth] Transfeera auth error:', errorText);
        return new Response(
          JSON.stringify({ error: 'Falha ao autenticar com Transfeera', details: errorText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const tokenData = await tokenResponse.json();
      console.log('[pix-auth] Transfeera token received successfully');
      accessToken = tokenData.access_token;
    } catch (e) {
      console.error('[pix-auth] Transfeera fetch error:', e);
      return new Response(
        JSON.stringify({ error: 'Falha na conexão com Transfeera', details: e.message }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Cache token (with 2 min margin)
    const expiresAt = new Date(Date.now() + (expiresInSeconds - 120) * 1000);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    if (config.id) {
      await supabaseAdmin.from('pix_tokens').delete().eq('pix_config_id', config.id);
    } else {
      await supabaseAdmin.from('pix_tokens').delete().eq('company_id', company_id);
    }

    await supabaseAdmin.from('pix_tokens').insert({
      company_id,
      pix_config_id: config.id,
      access_token: accessToken!,
      token_type: 'Bearer',
      expires_at: expiresAt.toISOString(),
    });

    return new Response(
      JSON.stringify({
        access_token: accessToken!,
        token_type: 'Bearer',
        expires_at: expiresAt.toISOString(),
        provider: 'transfeera',
        cached: false,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[pix-auth] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
