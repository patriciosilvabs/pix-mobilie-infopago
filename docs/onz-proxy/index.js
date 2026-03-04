const express = require('express');
const https = require('https');
const http = require('http');

const app = express();
app.use(express.json());
app.use(express.raw({ type: '*/*', limit: '10mb' }));

const PORT = process.env.PORT || 3000;
const PROXY_API_KEY = process.env.PROXY_API_KEY;

// ONZ client certificates (PEM, base64-encoded in env vars)
const ONZ_CLIENT_CERT_B64 = process.env.ONZ_CLIENT_CERT_B64;
const ONZ_CLIENT_KEY_B64 = process.env.ONZ_CLIENT_KEY_B64;
const ONZ_CA_CERT_B64 = process.env.ONZ_CA_CERT_B64;

if (!PROXY_API_KEY) {
  console.error('FATAL: PROXY_API_KEY env var is required');
  process.exit(1);
}

if (!ONZ_CLIENT_CERT_B64 || !ONZ_CLIENT_KEY_B64) {
  console.error('FATAL: ONZ_CLIENT_CERT_B64 and ONZ_CLIENT_KEY_B64 are required');
  process.exit(1);
}

// Decode certs once at startup
const clientCert = Buffer.from(ONZ_CLIENT_CERT_B64, 'base64');
const clientKey = Buffer.from(ONZ_CLIENT_KEY_B64, 'base64');
const caCert = ONZ_CA_CERT_B64 ? Buffer.from(ONZ_CA_CERT_B64, 'base64') : undefined;

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Proxy endpoint: POST /proxy
// Body: { url, method, headers, body }
app.post('/proxy', async (req, res) => {
  // Authenticate
  const apiKey = req.headers['x-proxy-api-key'];
  if (apiKey !== PROXY_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { url, method = 'POST', headers = {}, body, body_raw } = req.body;
  console.log(`[proxy] typeof body_raw: ${typeof body_raw}`);

  if (!url || !url.startsWith('https://')) {
    return res.status(400).json({ error: 'Valid HTTPS url is required' });
  }

  // Only allow ONZ domains
  const parsedUrl = new URL(url);
  const allowed = ['cashout.infopago.com.br', 'sandbox.infopago.com.br', 'secureapi.bancodigital.onz.software'];
  if (!allowed.includes(parsedUrl.hostname)) {
    return res.status(403).json({ error: `Domain ${parsedUrl.hostname} not allowed` });
  }

  console.log(`[proxy] ${method} ${url}`);
  if (body_raw) {
    // Mask secrets in form-urlencoded string for logging
    const sanitizedRaw = body_raw.replace(/client_secret=[^&]+/, 'client_secret=***');
    console.log(`[proxy] Raw body: ${sanitizedRaw}`);
  } else if (body) {
    const sanitized = { ...body };
    if (sanitized.client_secret) sanitized.client_secret = '***';
    if (sanitized.clientSecret) sanitized.clientSecret = '***';
    console.log(`[proxy] Request body keys:`, Object.keys(body), `body (sanitized):`, JSON.stringify(sanitized));
  }

  const agentOptions = {
    cert: clientCert,
    key: clientKey,
    rejectUnauthorized: false, // ONZ cert lacks SAN extension
  };
  if (caCert) {
    agentOptions.ca = caCert;
  }

  const agent = new https.Agent(agentOptions);

  try {
    // Support raw string body (e.g. form-urlencoded) or JSON object body
    const requestBody = body_raw ? body_raw : (body ? JSON.stringify(body) : undefined);

    // === DIAGNOSTIC LOGS: compare body_raw vs requestBody ===
    if (body_raw) {
      try {
        const parsed = JSON.parse(body_raw);
        if (parsed.qrCode) {
          console.log(`[proxy] qrCode length: ${parsed.qrCode.length}`);
          console.log(`[proxy] qrCode has spaces: ${parsed.qrCode.includes(' ')}`);
          console.log(`[proxy] qrCode first 80: ${parsed.qrCode.substring(0, 80)}`);
          console.log(`[proxy] qrCode last 20: ${parsed.qrCode.substring(parsed.qrCode.length - 20)}`);
        }
      } catch(e) { /* not JSON */ }
      console.log(`[proxy] requestBody === body_raw: ${requestBody === body_raw}`);
      console.log(`[proxy] requestBody length: ${requestBody.length}`);
      console.log(`[proxy] body_raw length: ${body_raw.length}`);
    }
    // === END DIAGNOSTIC LOGS ===

    const fetchOptions = {
      method,
      headers: {
        ...headers,
        ...(requestBody ? { 'Content-Length': Buffer.byteLength(requestBody).toString() } : {}),
      },
      agent,
    };

    const response = await new Promise((resolve, reject) => {
      const reqObj = https.request(url, fetchOptions, (resp) => {
        let data = '';
        resp.on('data', chunk => data += chunk);
        resp.on('end', () => resolve({ status: resp.statusCode, headers: resp.headers, body: data }));
      });
      reqObj.on('error', reject);
      if (requestBody) reqObj.write(requestBody);
      reqObj.end();
    });

    // Try to parse JSON, fallback to text
    let responseBody;
    try {
      responseBody = JSON.parse(response.body);
    } catch {
      responseBody = response.body;
    }

    console.log(`[proxy] Response: ${response.status}`);
    res.status(response.status).json({
      status: response.status,
      data: responseBody,
    });
  } catch (error) {
    console.error(`[proxy] Error:`, error.message);
    res.status(502).json({
      error: 'Proxy connection failed',
      details: error.message,
    });
  } finally {
    agent.destroy();
  }
});

app.listen(PORT, () => {
  console.log(`ONZ mTLS Proxy running on port ${PORT}`);
});
