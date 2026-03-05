import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function callOnzProxy(url: string, method: string, headers: Record<string, string>, body?: any) {
  const proxyUrl = Deno.env.get('ONZ_PROXY_URL');
  const proxyApiKey = Deno.env.get('ONZ_PROXY_API_KEY');
  if (!proxyUrl || !proxyApiKey) throw new Error('ONZ proxy not configured (ONZ_PROXY_URL / ONZ_PROXY_API_KEY)');

  const proxyPayload: any = { url, method, headers };
  if (body !== undefined) proxyPayload.body = body;

  const fullUrl = `${proxyUrl}/proxy`;
  console.log(`[callOnzProxy] POST ${fullUrl} -> ${url}`);

  const resp = await fetch(fullUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-proxy-api-key': proxyApiKey },
    body: JSON.stringify(proxyPayload),
  });

  const contentType = resp.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await resp.text();
    console.error(`[callOnzProxy] Non-JSON response (${resp.status}): ${text.substring(0, 300)}`);
    throw new Error(`Proxy retornou resposta não-JSON (HTTP ${resp.status}). Verifique se a URL do proxy está correta e o serviço está rodando.`);
  }

  const result = await resp.json();
  return { ok: result.status >= 200 && result.status < 300, status: result.status, data: result.data };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { company_id, purpose, force_new } = await req.json();
    if (!company_id) {
      return new Response(JSON.stringify({ error: 'company_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`[pix-auth] Getting ONZ token for company: ${company_id}, purpose: ${purpose || 'any'}`);

    // Get Pix config with purpose-aware lookup
    let config: any = null;
    if (purpose) {
      const { data: specificConfig } = await supabase
        .from('pix_configs').select('*')
        .eq('company_id', company_id).eq('is_active', true).eq('purpose', purpose).single();
      config = specificConfig;
    }
    if (!config) {
      const { data: bothConfig } = await supabase
        .from('pix_configs').select('*')
        .eq('company_id', company_id).eq('is_active', true).eq('purpose', 'both').single();
      config = bothConfig;
    }
    if (!config) {
      const { data: anyConfig } = await supabase
        .from('pix_configs').select('*')
        .eq('company_id', company_id).eq('is_active', true).limit(1).single();
      config = anyConfig;
    }

    if (!config) {
      return new Response(JSON.stringify({ error: 'Pix configuration not found for this company' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`[pix-auth] Provider: onz, base_url: ${config.base_url}`);

    // Check cached token (skip if force_new)
    if (!force_new) {
      let cachedTokenQuery = supabase
        .from('pix_tokens').select('*')
        .eq('company_id', company_id)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false }).limit(1);
      if (config.id) cachedTokenQuery = cachedTokenQuery.eq('pix_config_id', config.id);
      const { data: cachedToken } = await cachedTokenQuery.single();

      if (cachedToken) {
        console.log('[pix-auth] Using cached ONZ token');
        return new Response(JSON.stringify({
          access_token: cachedToken.access_token,
          token_type: cachedToken.token_type,
          provider: 'onz',
          cached: true,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    } else {
      console.log('[pix-auth] force_new=true, skipping cache');
    }

    // ========== ONZ AUTH via mTLS Proxy ==========
    const baseUrl = config.base_url.replace(/\/$/, '');
    const authUrl = `${baseUrl}/oauth/token`;

    console.log(`[pix-auth] ONZ: requesting token from ${authUrl}`);

    let accessToken: string;
    let expiresInSeconds = 1800; // default 30 min

    try {
      const result = await callOnzProxy(authUrl, 'POST', {
        'Content-Type': 'application/json',
      }, {
        clientId: config.client_id,
        clientSecret: config.client_secret_encrypted,
        grantType: 'client_credentials',
      });

      if (!result.ok) {
        console.error('[pix-auth] ONZ auth error:', JSON.stringify(result.data));
        return new Response(
          JSON.stringify({ error: 'Falha ao autenticar com ONZ', details: result.data }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const tokenData = result.data;
      console.log('[pix-auth] ONZ token received successfully');
      accessToken = tokenData.accessToken || tokenData.access_token;

      // ONZ expiresAt is seconds (epoch or duration)
      if (tokenData.expiresAt) {
        const exp = Number(tokenData.expiresAt);
        // If it's a large number, it's epoch seconds; otherwise duration
        if (exp > 1_000_000_000) {
          expiresInSeconds = exp - Math.floor(Date.now() / 1000);
        } else {
          expiresInSeconds = exp;
        }
      }
    } catch (e) {
      console.error('[pix-auth] ONZ fetch error:', e);
      return new Response(
        JSON.stringify({ error: 'Falha na conexão com ONZ', details: e.message }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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

    return new Response(JSON.stringify({
      access_token: accessToken!,
      token_type: 'Bearer',
      expires_at: expiresAt.toISOString(),
      provider: 'onz',
      cached: false,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[pix-auth] Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
