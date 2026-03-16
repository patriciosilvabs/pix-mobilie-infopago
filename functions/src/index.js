const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const REGION = "us-central1";
const MAX_PAYMENT_VALUE = 1_000_000;
const ONZ_PROXY_URL = defineSecret("ONZ_PROXY_URL");
const ONZ_PROXY_API_KEY = defineSecret("ONZ_PROXY_API_KEY");
const ONZ_OPTIONS = { region: REGION, secrets: [ONZ_PROXY_URL, ONZ_PROXY_API_KEY] };

const PAGE_KEYS = ["dashboard","new_payment","transactions","categories","reports","users","companies","settings"];
const FEATURE_KEYS = ["menu_pix","pagar_qrcode","copia_cola","com_chave","favorecidos","agendadas","boleto","dinheiro","transferir"];

const OWNER_EMAIL = "patriciobarbosadasilva@gmail.com";
const OWNER_UID = "vgvQbMGYApNMd0bgCBBE7BACkL63";

const ONZ_STATUS_MAP = {
  PROCESSING: "pending",
  LIQUIDATED: "completed",
  CANCELED: "failed",
  REFUNDED: "completed",
  PARTIALLY_REFUNDED: "completed",
};

function send(res, status, body) { res.status(status).json(body); }
function nowIso() { return new Date().toISOString(); }

function cors(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, x-webhook-secret");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).send(""); return true; }
  return false;
}

async function authUser(req) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return admin.auth().verifyIdToken(m[1]);
}

async function requireAuth(req, res) {
  try {
    const u = await authUser(req);
    if (!u) { send(res, 401, { error: "Nï¿½o autenticado." }); return null; }
    return u;
  } catch (e) {
    send(res, 401, { error: "Token invï¿½lido." });
    return null;
  }
}

async function isAdmin(uid) {
  const s = await db.collection("user_roles").where("user_id", "==", uid).limit(1).get();
  return !s.empty && s.docs[0].data().role === "admin";
}

async function requireAdmin(req, res) {
  const u = await requireAuth(req, res);
  if (!u) return null;

  const isOwner =
    String(u.email || "").toLowerCase() === OWNER_EMAIL ||
    String(u.uid || "") === OWNER_UID;
  if (isOwner) return u;

  if (!(await isAdmin(u.uid))) { send(res, 403, { error: "Apenas administradores." }); return null; }
  return u;
}

async function deleteByField(coll, field, value) {
  const s = await db.collection(coll).where(field, "==", value).get();
  if (s.empty) return;
  const b = db.batch();
  s.docs.forEach((d) => b.delete(d.ref));
  await b.commit();
}

function cleanQr(v) {
  return String(v || "").trim().replace(/[\r\n\t]/g, "").replace(/[\u200B-\u200D\uFEFF\u00A0]/g, "");
}

function detectPixKeyType(key) {
  const c = String(key || "").replace(/[\s\-\.\/]/g, "");
  if (/^\d{11}$/.test(c)) return "CPF";
  if (/^\d{14}$/.test(c)) return "CNPJ";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(key || "").trim())) return "EMAIL";
  if (/^\+?\d{10,13}$/.test(c)) return "TELEFONE";
  return "EVP";
}

function parseEmv(emv) {
  const s = String(emv || "");
  const r = {};
  let i = 0;
  while (i + 4 <= s.length) {
    const tag = s.substring(i, i + 2);
    const len = Number(s.substring(i + 2, i + 4));
    if (!Number.isFinite(len) || i + 4 + len > s.length) break;
    r[tag] = s.substring(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return r;
}

function emvPixKey(emv) {
  const t = parseEmv(emv);
  if (!t["26"]) return null;
  const i = parseEmv(t["26"]);
  return i["01"] || null;
}

function mapStatus(raw) {
  const s = String(raw || "").replace(/,/g, "").toUpperCase();
  const internal = ONZ_STATUS_MAP[s] || "pending";
  return { raw: s, internal, completed: internal === "completed", liquidated: s === "LIQUIDATED" };
}

function toNumberLike(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;

  // Accept formats like "1234.56", "1.234,56", "R$ 1.234,56"
  const cleaned = s.replace(/[^0-9,.-]/g, "");
  if (!cleaned) return null;

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");

  let normalized = cleaned;
  if (hasComma && hasDot) {
    normalized = cleaned.replace(/./g, "").replace(/,/g, ".");
  } else if (hasComma) {
    normalized = cleaned.replace(/,/g, ".");
  }

  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function pickBalanceValue(payload) {
  if (payload == null) return null;

  const direct = toNumberLike(payload);
  if (direct != null) return direct;

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const v = pickBalanceValue(item);
      if (v != null) return v;
    }
    return null;
  }

  if (typeof payload !== "object") return null;

  const directCandidates = [
    payload.available,
    payload.balance,
    payload.amount,
    payload.valor,
    payload.saldo,
    payload.availableAmount,
    payload.currentBalance,
    payload.netAmount,
  ];
  for (const candidate of directCandidates) {
    const n = toNumberLike(candidate);
    if (n != null) return n;
  }

  const nestedCandidates = [
    payload.data,
    payload.balanceAmount,
    payload.accountBalance,
    payload.result,
    payload.response,
    payload.balances,
  ];
  for (const nested of nestedCandidates) {
    const v = pickBalanceValue(nested);
    if (v != null) return v;
  }

  return null;
}


async function callOnzProxy(url, method, headers, body) {
  const proxy = String(ONZ_PROXY_URL.value() || "").replace(/\/$/, "");
  if (!proxy) throw new Error("ONZ_PROXY_URL nï¿½o configurada.");

  const proxyApiKey = String(ONZ_PROXY_API_KEY.value() || "");
  const proxyEndpoint = `${proxy}/proxy`;

  let resp = await fetch(proxyEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(proxyApiKey ? { "x-proxy-api-key": proxyApiKey } : {}),
    },
    body: JSON.stringify({
      url,
      method,
      headers: { ...headers },
      body: body === undefined ? undefined : body,
    }),
  });

  if (resp.status === 404 || resp.status === 405) {
    const t = new URL(url);
    const path = t.pathname.replace(/^\/api\/v2/, "");
    const prefix = (t.hostname.includes("pix.infopago") && !t.hostname.includes("cashout")) ? "/pix" : "/cashout";
    const full = `${proxy}${prefix}${path}${t.search || ""}`;

    resp = await fetch(full, {
      method,
      headers: {
        ...headers,
        ...(proxyApiKey ? { "x-proxy-api-key": proxyApiKey } : {}),
      },
      body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)),
    });
  }

  const ct = resp.headers.get("content-type") || "";
  const txt = await resp.text();
  let data = txt;
  if (ct.includes("application/json")) { try { data = JSON.parse(txt); } catch (_) {} }

  if (data && typeof data === "object" && "data" in data && "status" in data) {
    return {
      ok: Number(data.status) >= 200 && Number(data.status) < 300,
      status: Number(data.status),
      data: data.data,
    };
  }

  return { ok: resp.status >= 200 && resp.status < 300, status: resp.status, data };
}

async function getPixConfig(companyId, purposes) {
  for (const p of purposes) {
    const s = await db.collection("pix_configs").where("company_id", "==", companyId).where("is_active", "==", true).where("purpose", "==", p).limit(1).get();
    if (!s.empty) return { id: s.docs[0].id, ...s.docs[0].data() };
  }
  const any = await db.collection("pix_configs").where("company_id", "==", companyId).where("is_active", "==", true).limit(1).get();
  if (!any.empty) return { id: any.docs[0].id, ...any.docs[0].data() };
  return null;
}

async function cachedToken(companyId, pixConfigId) {
  let q = db.collection("pix_tokens").where("company_id", "==", companyId);
  if (pixConfigId) q = q.where("pix_config_id", "==", pixConfigId);
  const s = await q.get();
  if (s.empty) return null;
  const now = nowIso();
  const valid = s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((t) => t.expires_at && String(t.expires_at) > now)
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  return valid[0] || null;
}

async function saveToken(companyId, pixConfigId, accessToken, expiresAt) {
  const old = await db.collection("pix_tokens").where("company_id", "==", companyId).where("pix_config_id", "==", pixConfigId || null).get();
  if (!old.empty) {
    const b = db.batch();
    old.docs.forEach((d) => b.delete(d.ref));
    await b.commit();
  }
  await db.collection("pix_tokens").add({
    company_id: companyId,
    pix_config_id: pixConfigId || null,
    access_token: accessToken,
    token_type: "Bearer",
    expires_at: expiresAt,
    created_at: nowIso(),
  });
}

async function getOnzToken(companyId, purpose, forceNew) {
  const config = await getPixConfig(companyId, purpose ? [purpose, "both"] : ["cash_out", "both", "cash_in"]);
  if (!config) return { error: { status: 404, message: "Configuraï¿½ï¿½o PIX nï¿½o encontrada." } };

  if (!forceNew) {
    const cached = await cachedToken(companyId, config.id);
    if (cached) return { accessToken: cached.access_token, config, cached: true };
  }

  const base = String(config.base_url || "").replace(/\/$/, "");
  if (!base) return { error: { status: 400, message: "base_url nï¿½o configurada." } };

  const auth = await callOnzProxy(`${base}/oauth/token`, "POST", { "Content-Type": "application/json" }, {
    clientId: config.client_id,
    clientSecret: config.client_secret_encrypted,
    grantType: "client_credentials",
  });

  if (!auth.ok) return { error: { status: 502, message: "Falha ao autenticar com ONZ.", details: auth.data } };

  const d = auth.data || {};
  const token = d.accessToken || d.access_token;
  if (!token) return { error: { status: 502, message: "Resposta ONZ sem access_token." } };

  let expires = 1800;
  if (d.expiresAt) {
    const exp = Number(d.expiresAt);
    if (Number.isFinite(exp)) expires = exp > 1_000_000_000 ? (exp - Math.floor(Date.now() / 1000)) : exp;
  }
  const expiresAt = new Date(Date.now() + Math.max(120, expires - 120) * 1000).toISOString();
  await saveToken(companyId, config.id, token, expiresAt);
  return { accessToken: token, config, cached: false, expiresAt };
}

async function createTx(payload) {
  const ref = await db.collection("transactions").add({ ...payload, created_at: nowIso(), updated_at: nowIso() });
  return ref.id;
}

async function updateTx(id, changes) {
  await db.collection("transactions").doc(String(id)).set({ ...changes, updated_at: nowIso() }, { merge: true });
}

async function txById(id) {
  if (!id) return null;
  const d = await db.collection("transactions").doc(String(id)).get();
  return d.exists ? { id: d.id, ...d.data() } : null;
}

async function txByField(field, value) {
  if (!value) return null;
  const s = await db.collection("transactions").where(field, "==", value).limit(1).get();
  return s.empty ? null : { id: s.docs[0].id, ...s.docs[0].data() };
}

async function duplicateByKey(companyId, userId, pixKey, amount) {
  const s = await db.collection("transactions").where("company_id", "==", companyId).where("created_by", "==", userId).get();
  const limit = Date.now() - 5 * 60 * 1000;
  return s.docs.map((d) => ({ id: d.id, ...d.data() })).find((tx) => String(tx.pix_key || "") === String(pixKey)
    && Number(tx.amount || 0) === Number(amount)
    && ["pending", "completed"].includes(String(tx.status || ""))
    && new Date(String(tx.created_at || "1970-01-01")).getTime() >= limit) || null;
}

async function duplicateByQr(companyId, userId, qr) {
  const s = await db.collection("transactions").where("company_id", "==", companyId).where("created_by", "==", userId).get();
  const limit = Date.now() - 5 * 60 * 1000;
  return s.docs.map((d) => ({ id: d.id, ...d.data() })).find((tx) => String(tx.pix_copia_cola || "") === String(qr)
    && ["pending", "completed"].includes(String(tx.status || ""))
    && new Date(String(tx.created_at || "1970-01-01")).getTime() >= limit) || null;
}

async function qrcInfo(companyId, qrCode, tokenHint) {
  const qr = cleanQr(qrCode);
  const config = await getPixConfig(companyId, ["cash_out", "both"]);

  if (config) {
    try {
      const token = tokenHint || await getOnzToken(companyId, "cash_out", false);
      if (!token.error && token.accessToken) {
        const base = String(config.base_url || "").replace(/\/$/, "");
        const info = await callOnzProxy(`${base}/pix/payments/qrc/info`, "POST", {
          Authorization: `Bearer ${token.accessToken}`,
          "Content-Type": "application/json",
          "x-idempotency-key": crypto.randomUUID().replace(/-/g, "").substring(0, 50),
        }, { qrCode: qr });

        if (info.ok && info.data) {
          const d = info.data;
          return {
            success: true,
            provider: "onz",
            type: d.type || (d.url ? "dynamic" : "static"),
            merchant_name: d.merchantName || null,
            merchant_city: d.merchantCity || null,
            amount: d.transactionAmount || null,
            pix_key: d.chave || emvPixKey(qr),
            txid: d.txid || null,
            end_to_end_id: d.endToEndId || null,
            payload: d.payload || d,
          };
        }
      }
    } catch (e) {
      logger.warn("pixQrcInfo fallback local", e);
    }
  }

  const tags = parseEmv(qr);
  const tag62 = tags["62"] ? parseEmv(tags["62"]) : {};
  return {
    success: true,
    provider: "local",
    type: tags["01"] === "12" ? "dynamic" : "static",
    merchant_name: tags["59"] || null,
    merchant_city: tags["60"] || null,
    amount: tags["54"] ? Number(tags["54"]) : null,
    pix_key: emvPixKey(qr),
    txid: tag62["05"] || null,
    end_to_end_id: null,
    payload: tags,
  };
}

exports.createUser = onRequest({ region: REGION }, async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const caller = await requireAdmin(req, res);
  if (!caller) return;

  const { full_name, email, password, company_id } = req.body || {};
  if (!full_name || !email || !password || !company_id) return send(res, 400, { error: "full_name, email, password, company_id sï¿½o obrigatï¿½rios." });

  try {
    const user = await admin.auth().createUser({ email: String(email).toLowerCase().trim(), password: String(password), displayName: String(full_name).trim() });
    const now = nowIso();

    await db.collection("profiles").add({ user_id: user.uid, full_name: String(full_name).trim(), email: String(email).toLowerCase().trim(), avatar_url: null, created_at: now, updated_at: now });
    await db.collection("user_roles").add({ user_id: user.uid, role: "operator", created_at: now, updated_at: now });
    await db.collection("company_members").add({ user_id: user.uid, company_id: String(company_id), is_active: true, payment_limit: null, can_view_balance: false, created_at: now, updated_at: now, created_by: caller.uid });

    for (const page_key of PAGE_KEYS) await db.collection("user_page_permissions").add({ user_id: user.uid, company_id: String(company_id), page_key, has_access: true, created_at: now, updated_at: now });
    for (const feature_key of FEATURE_KEYS) await db.collection("user_feature_permissions").add({ user_id: user.uid, company_id: String(company_id), feature_key, is_visible: true, created_at: now, updated_at: now });

    return send(res, 200, { success: true, user_id: user.uid });
  } catch (e) {
    logger.error("createUser", e);
    return send(res, 500, { error: e.message || "Erro ao criar usuï¿½rio." });
  }
});

exports.deleteUser = onRequest({ region: REGION }, async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const caller = await requireAdmin(req, res);
  if (!caller) return;

  const { user_id } = req.body || {};
  if (!user_id) return send(res, 400, { error: "user_id obrigatï¿½rio." });

  try {
    await deleteByField("profiles", "user_id", user_id);
    await deleteByField("user_roles", "user_id", user_id);
    await deleteByField("company_members", "user_id", user_id);
    await deleteByField("user_page_permissions", "user_id", user_id);
    await deleteByField("user_feature_permissions", "user_id", user_id);
    await admin.auth().deleteUser(String(user_id));
    return send(res, 200, { success: true });
  } catch (e) {
    logger.error("deleteUser", e);
    return send(res, 500, { error: e.message || "Erro ao excluir usuï¿½rio." });
  }
});

exports.resetUserPassword = onRequest({ region: REGION }, async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const caller = await requireAdmin(req, res);
  if (!caller) return;

  const { user_id, new_password } = req.body || {};
  if (!user_id || !new_password) return send(res, 400, { error: "user_id e new_password obrigatï¿½rios." });

  try {
    await admin.auth().updateUser(String(user_id), { password: String(new_password) });
    return send(res, 200, { success: true });
  } catch (e) {
    logger.error("resetUserPassword", e);
    return send(res, 500, { error: e.message || "Erro ao redefinir senha." });
  }
});

exports.pixAuth = onRequest(ONZ_OPTIONS, async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const user = await requireAuth(req, res);
  if (!user) return;

  const { company_id, purpose, force_new } = req.body || {};
  if (!company_id) return send(res, 400, { error: "company_id obrigatï¿½rio." });

  try {
    const token = await getOnzToken(String(company_id), purpose || undefined, !!force_new);
    if (token.error) return send(res, token.error.status || 500, { error: token.error.message, details: token.error.details || null });
    return send(res, 200, { access_token: token.accessToken, token_type: "Bearer", expires_at: token.expiresAt || null, provider: "onz", cached: token.cached });
  } catch (e) {
    logger.error("pixAuth", e);
    return send(res, 500, { error: e.message || "Erro no pix-auth." });
  }
});

exports.pixBalance = onRequest(ONZ_OPTIONS, async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const user = await requireAuth(req, res);
  if (!user) return;

  const { company_id } = req.body || {};
  if (!company_id) return send(res, 400, { error: "company_id obrigat?rio." });

  try {
    const token = await getOnzToken(String(company_id), "cash_out", false);
    if (token.error) return send(res, token.error.status || 500, { success: false, available: false, error: token.error.message, details: token.error.details || null });

    const base = String(token.config.base_url || "").replace(/\/$/, "");
    const paths = ["/accounts/balances/", "/accounts/balances", "/accounts/balance", "/accounts/balance/"];

    let lastError = null;
    let selected = null;

    for (const pth of paths) {
      let bal = await callOnzProxy(`${base}${pth}`, "GET", { Authorization: `Bearer ${token.accessToken}` });
      if (!bal.ok && bal.status === 401) {
        const fresh = await getOnzToken(String(company_id), "cash_out", true);
        if (!fresh.error) {
          bal = await callOnzProxy(`${base}${pth}`, "GET", { Authorization: `Bearer ${fresh.accessToken}` });
        }
      }

      if (!bal.ok) {
        lastError = bal.data;
        continue;
      }

      const value = pickBalanceValue(bal.data);
      if (value != null) {
        selected = Number(value);
        break;
      }
      lastError = bal.data;
    }

    if (selected == null) {
      return send(res, 502, { success: false, available: false, error: "Falha ao consultar saldo ONZ.", details: lastError });
    }

    return send(res, 200, { success: true, available: true, provider: "onz", balance: selected });
  } catch (e) {
    logger.error("pixBalance", e);
    return send(res, 500, { success: false, available: false, error: e.message || "Erro no pix-balance." });
  }
});

exports.pixDictLookup = onRequest({ region: REGION }, async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const user = await requireAuth(req, res);
  if (!user) return;

  const { company_id, pix_key } = req.body || {};
  if (!company_id || !pix_key) return send(res, 400, { error: "company_id e pix_key obrigatï¿½rios." });

  const key = String(pix_key).trim();
  return send(res, 200, {
    success: true,
    name: "",
    cpf_cnpj: "",
    key_type: detectPixKeyType(key),
    key,
    bank_name: "",
    agency: "",
    account: "",
    account_type: "",
    end2end_id: "",
    ispb: "",
    message: "Chave validada localmente.",
  });
});

exports.pixQrcInfo = onRequest(ONZ_OPTIONS, async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const user = await requireAuth(req, res);
  if (!user) return;

  const { company_id, qr_code } = req.body || {};
  if (!company_id || !qr_code) return send(res, 400, { error: "company_id e qr_code obrigatï¿½rios." });

  try {
    const info = await qrcInfo(String(company_id), String(qr_code));
    return send(res, 200, info);
  } catch (e) {
    logger.error("pixQrcInfo", e);
    return send(res, 500, { error: e.message || "Erro no pix-qrc-info." });
  }
});
exports.pixPayDict = onRequest(ONZ_OPTIONS, async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const user = await requireAuth(req, res);
  if (!user) return;

  const body = req.body || {};
  const companyId = String(body.company_id || "");
  const pixKey = String(body.pix_key || "").trim();
  const amount = Number(body.valor || 0);
  const descricao = body.descricao ? String(body.descricao) : "Pagamento Pix";
  const idempotencyKey = body.idempotency_key ? String(body.idempotency_key) : crypto.randomUUID().replace(/-/g, "").substring(0, 50);

  if (!companyId || !pixKey || !Number.isFinite(amount)) return send(res, 400, { error: "company_id, pix_key e valor obrigatï¿½rios." });
  if (amount <= 0 || amount > MAX_PAYMENT_VALUE) return send(res, 400, { error: `Valor invï¿½lido. Mï¿½ximo ${MAX_PAYMENT_VALUE}.` });

  try {
    const dup = await duplicateByKey(companyId, user.uid, pixKey, amount);
    if (dup) return send(res, 200, { success: true, duplicate: true, transaction_id: dup.id, status: dup.status });

    const token = await getOnzToken(companyId, "cash_out", false);
    if (token.error) return send(res, token.error.status || 500, { error: token.error.message, details: token.error.details || null });

    const base = String(token.config.base_url || "").replace(/\/$/, "");
    const pay = await callOnzProxy(`${base}/pix/payments/dict`, "POST", {
      Authorization: `Bearer ${token.accessToken}`,
      "Content-Type": "application/json",
      "x-idempotency-key": idempotencyKey,
    }, {
      pixKey,
      description: descricao,
      payment: { currency: "BRL", amount: Number(amount.toFixed(2)) },
    });

    if (!pay.ok) {
      return send(res, 502, {
        error: pay.data?.detail || pay.data?.title || "Falha no pagamento PIX.",
        provider_error: pay.data,
      });
    }

    const pd = pay.data || {};
    const txId = await createTx({
      company_id: companyId,
      created_by: user.uid,
      amount,
      status: "pending",
      pix_type: "key",
      pix_key: pixKey,
      description: descricao,
      external_id: String(pd.id || "") || null,
      pix_e2eid: pd.endToEndId || null,
      pix_provider_response: pd,
    });

    await db.collection("audit_logs").add({
      user_id: user.uid,
      company_id: companyId,
      entity_type: "transaction",
      entity_id: txId,
      action: "pix_payment_initiated",
      new_data: { provider: "onz", onzId: String(pd.id || ""), endToEndId: pd.endToEndId || null, amount, pix_key: pixKey, status: "pending" },
      created_at: nowIso(),
    });

    return send(res, 200, {
      success: true,
      transaction_id: txId,
      onz_id: String(pd.id || ""),
      end_to_end_id: pd.endToEndId || "",
      status: pd.status || "PROCESSING",
      idempotency_key: idempotencyKey,
      amount,
    });
  } catch (e) {
    logger.error("pixPayDict", e);
    return send(res, 500, { error: e.message || "Erro no pix-pay-dict." });
  }
});

exports.pixPayQrc = onRequest(ONZ_OPTIONS, async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const user = await requireAuth(req, res);
  if (!user) return;

  const body = req.body || {};
  const companyId = String(body.company_id || "");
  const qrCode = cleanQr(body.qr_code || "");
  const inputAmount = Number(body.valor || 0);
  const descricao = body.descricao ? String(body.descricao) : "Pagamento via QR Code";
  const idempotencyKey = body.idempotency_key ? String(body.idempotency_key) : crypto.randomUUID().replace(/-/g, "").substring(0, 50);

  if (!companyId || !qrCode) return send(res, 400, { error: "company_id e qr_code obrigatï¿½rios." });

  try {
    const dup = await duplicateByQr(companyId, user.uid, qrCode);
    if (dup) return send(res, 200, { success: true, duplicate: true, transaction_id: dup.id, status: dup.status });

    const token = await getOnzToken(companyId, "cash_out", false);
    if (token.error) return send(res, token.error.status || 500, { error: token.error.message, details: token.error.details || null });

    const info = await qrcInfo(companyId, qrCode, token);
    const embedded = Number(info.amount || 0);
    const amount = Number.isFinite(embedded) && embedded > 0 ? embedded : inputAmount;

    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_PAYMENT_VALUE) {
      return send(res, 400, { error: `Valor invï¿½lido. Mï¿½ximo ${MAX_PAYMENT_VALUE}.` });
    }

    const base = String(token.config.base_url || "").replace(/\/$/, "");
    const pay = await callOnzProxy(`${base}/pix/payments/qrc`, "POST", {
      Authorization: `Bearer ${token.accessToken}`,
      "Content-Type": "application/json",
      "x-idempotency-key": idempotencyKey,
    }, {
      qrCode,
      description: descricao,
      payment: { currency: "BRL", amount: Number(amount.toFixed(2)) },
    });

    if (!pay.ok) {
      const destKey = info.pix_key || null;
      if (destKey) {
        req.body = { ...body, company_id: companyId, pix_key: destKey, valor: amount, descricao, idempotency_key: idempotencyKey };
        return exports.pixPayDict(req, res);
      }
      return send(res, 502, { error: "Falha no pagamento via QR Code.", details: pay.data });
    }

    const pd = pay.data || {};
    const txId = await createTx({
      company_id: companyId,
      created_by: user.uid,
      amount,
      description: descricao,
      pix_type: "qrcode",
      pix_copia_cola: qrCode,
      pix_txid: info.txid || null,
      pix_e2eid: pd.endToEndId || null,
      external_id: String(pd.id || "") || null,
      beneficiary_name: info.merchant_name || null,
      status: "pending",
      pix_provider_response: pd,
    });

    return send(res, 200, {
      success: true,
      transaction_id: txId,
      onz_id: String(pd.id || ""),
      end_to_end_id: pd.endToEndId || "",
      amount,
      qr_info: info,
      status: pd.status || "PROCESSING",
      idempotency_key: idempotencyKey,
    });
  } catch (e) {
    logger.error("pixPayQrc", e);
    return send(res, 500, { error: e.message || "Erro no pix-pay-qrc." });
  }
});

exports.pixCheckStatus = onRequest(ONZ_OPTIONS, async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const user = await requireAuth(req, res);
  if (!user) return;

  const body = req.body || {};
  let companyId = body.company_id ? String(body.company_id) : "";
  let txId = body.transaction_id ? String(body.transaction_id) : "";
  let endToEndId = body.end_to_end_id ? String(body.end_to_end_id) : "";
  let onzId = body.onz_id ? String(body.onz_id) : "";

  try {
    if (txId && (!companyId || !endToEndId || !onzId)) {
      const tx = await txById(txId);
      if (tx) {
        companyId = companyId || String(tx.company_id || "");
        endToEndId = endToEndId || String(tx.pix_e2eid || "");
        onzId = onzId || String(tx.external_id || "");
      }
    }

    if (!companyId || (!endToEndId && !onzId)) {
      return send(res, 400, { error: "company_id e end_to_end_id (ou transaction_id) obrigatï¿½rios." });
    }

    const token = await getOnzToken(companyId, undefined, false);
    if (token.error) return send(res, token.error.status || 500, { error: token.error.message, details: token.error.details || null });

    const base = String(token.config.base_url || "").replace(/\/$/, "");
    let statusData = null;

    if (endToEndId) {
      const byE2e = await callOnzProxy(`${base}/pix/payments/${encodeURIComponent(endToEndId)}`, "GET", { Authorization: `Bearer ${token.accessToken}` });
      if (byE2e.ok && byE2e.data) statusData = byE2e.data.data || byE2e.data;
    }

    if (!statusData && onzId) {
      const byId = await callOnzProxy(`${base}/accounts/transactions/${encodeURIComponent(onzId)}/details`, "GET", { Authorization: `Bearer ${token.accessToken}` });
      if (byId.ok && byId.data) statusData = Array.isArray(byId.data) ? byId.data[0] : byId.data;
    }

    if (!statusData) return send(res, 502, { error: "Nï¿½o foi possï¿½vel obter status da transferï¿½ncia." });

    const mapped = mapStatus(statusData.status);
    if (txId) {
      const up = { status: mapped.internal, pix_provider_response: statusData, pix_e2eid: statusData.endToEndId || endToEndId || null };
      if (mapped.completed) up.paid_at = nowIso();
      await updateTx(txId, up);
    }

    return send(res, 200, {
      success: true,
      end_to_end_id: statusData.endToEndId || endToEndId || "",
      provider_id: statusData.id || onzId || "",
      status: statusData.status || "PROCESSING",
      internal_status: mapped.internal,
      is_liquidated: mapped.liquidated,
      is_completed: mapped.completed,
      amount: statusData.payment?.amount || statusData.amount || null,
      creditor: statusData.creditor || null,
      debtor: statusData.debtor || null,
      payload: statusData,
    });
  } catch (e) {
    logger.error("pixCheckStatus", e);
    return send(res, 500, { error: e.message || "Erro no pix-check-status." });
  }
});

exports.pixReceipt = onRequest(ONZ_OPTIONS, async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const user = await requireAuth(req, res);
  if (!user) return;

  const body = req.body || {};
  let companyId = body.company_id ? String(body.company_id) : "";
  let txId = body.transaction_id ? String(body.transaction_id) : "";
  let endToEndId = body.end_to_end_id ? String(body.end_to_end_id) : "";

  try {
    if (txId && (!companyId || !endToEndId)) {
      const tx = await txById(txId);
      if (tx) {
        companyId = companyId || String(tx.company_id || "");
        endToEndId = endToEndId || String(tx.pix_e2eid || "");
      }
    }

    if (!companyId || !endToEndId) return send(res, 400, { error: "company_id e end_to_end_id (ou transaction_id) obrigatï¿½rios." });

    const token = await getOnzToken(companyId, undefined, false);
    if (token.error) return send(res, token.error.status || 500, { error: token.error.message, details: token.error.details || null });

    const base = String(token.config.base_url || "").replace(/\/$/, "");
    const receipt = await callOnzProxy(`${base}/pix/payments/receipt/${encodeURIComponent(endToEndId)}`, "GET", { Authorization: `Bearer ${token.accessToken}` });

    if (!receipt.ok) return send(res, 404, { error: "Comprovante ainda nï¿½o disponï¿½vel.", details: receipt.data });

    const pdf = receipt.data?.data?.pdf || receipt.data?.pdf || null;
    if (!pdf) return send(res, 404, { error: "Comprovante nï¿½o retornado pelo provedor." });

    return send(res, 200, { success: true, end_to_end_id: endToEndId, pdf_base64: pdf, content_type: "application/pdf", provider: "onz" });
  } catch (e) {
    logger.error("pixReceipt", e);
    return send(res, 500, { error: e.message || "Erro no pix-receipt." });
  }
});

exports.pixWebhook = onRequest({ region: REGION }, async (req, res) => {
  if (cors(req, res)) return;

  if (req.method === "GET") return send(res, 200, { status: "ok", message: "Webhook endpoint ativo." });
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });

  try {
    const secret = (req.headers["x-webhook-secret"] ? String(req.headers["x-webhook-secret"]) : "") || (req.query.whs ? String(req.query.whs) : "");
    if (!secret) return send(res, 401, { error: "Unauthorized" });

    const cfg = await db.collection("pix_configs").where("webhook_secret", "==", secret).where("is_active", "==", true).limit(1).get();
    if (cfg.empty) return send(res, 401, { error: "Unauthorized" });

    const payload = req.body || {};
    const eventType = String(payload.type || "UNKNOWN");
    const data = payload.data || payload;

    await db.collection("pix_webhook_logs").add({
      event_type: eventType,
      payload,
      processed: false,
      created_at: nowIso(),
      ip_address: req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown",
    });

    if (["TRANSFER", "CASHOUT"].includes(eventType)) {
      const e2e = data.endToEndId || null;
      const onzId = String(data.id || "") || null;
      let tx = null;
      if (e2e) tx = await txByField("pix_e2eid", e2e);
      if (!tx && onzId) tx = await txByField("external_id", onzId);
      if (tx) {
        const mapped = mapStatus(data.status);
        const up = { status: mapped.internal, pix_provider_response: data, pix_e2eid: e2e || tx.pix_e2eid || null };
        if (mapped.completed) up.paid_at = nowIso();
        await updateTx(tx.id, up);
      }
    }

    if (eventType === "RECEIVE") {
      const pixKey = data.pixKey || data.chave || null;
      if (pixKey) {
        const cfgByKey = await db.collection("pix_configs").where("pix_key", "==", pixKey).where("is_active", "==", true).limit(1).get();
        if (!cfgByKey.empty) {
          const c = cfgByKey.docs[0].data();
          await createTx({
            company_id: c.company_id,
            created_by: "system",
            amount: Number(data.payment?.amount || 0),
            status: "completed",
            pix_type: "key",
            pix_key: pixKey,
            pix_e2eid: data.endToEndId || null,
            description: data.remittanceInformation || "Recebimento Pix",
            paid_at: nowIso(),
            pix_provider_response: data,
          });
        }
      }
    }

    if (eventType === "REFUND") {
      const e2e = data.endToEndId || null;
      if (e2e) {
        const rs = await db.collection("pix_refunds").where("e2eid", "==", e2e).limit(1).get();
        if (!rs.empty) {
          await db.collection("pix_refunds").doc(rs.docs[0].id).set({ status: data.status || "DEVOLVIDO", refunded_at: nowIso(), updated_at: nowIso() }, { merge: true });
        }
      }
    }

    return send(res, 200, { success: true, event_type: eventType });
  } catch (e) {
    logger.error("pixWebhook", e);
    return send(res, 500, { error: e.message || "Erro no pix-webhook." });
  }
});

function mapBilletStatus(raw) {
  const s = String(raw || "").toUpperCase();
  const completed = ["PAID", "LIQUIDATED", "SETTLED", "COMPLETED", "SUCCESS"].includes(s);
  const failed = ["CANCELED", "CANCELLED", "FAILED", "REJECTED", "ERROR"].includes(s);
  return {
    raw: s || "PROCESSING",
    internal: completed ? "completed" : (failed ? "failed" : "pending"),
    completed,
  };
}

async function callOnzCandidates(base, token, candidates) {
  for (const candidate of candidates) {
    const result = await callOnzProxy(`${base}${candidate.path}`, candidate.method || "POST", {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(candidate.idempotencyKey ? { "x-idempotency-key": candidate.idempotencyKey } : {}),
    }, candidate.body);
    if (result.ok) return result;
  }
  return null;
}

function parseOcrContent(content) {
  const clean = String(content || "")
    .replace(/```json\n?/gi, "")
    .replace(/```\n?/g, "")
    .trim();
  return JSON.parse(clean);
}

exports.generatePixReceipt = onRequest({ region: REGION }, async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const user = await requireAuth(req, res);
  if (!user) return;

  const { transaction_id, company_id } = req.body || {};
  if (!transaction_id || !company_id) {
    return send(res, 400, { success: false, error: "transaction_id e company_id sï¿½o obrigatï¿½rios." });
  }

  try {
    const tx = await txById(String(transaction_id));
    if (!tx || String(tx.company_id || "") !== String(company_id)) {
      return send(res, 404, { success: false, error: "Transaï¿½ï¿½o nï¿½o encontrada." });
    }

    const existing = await db.collection("receipts").where("transaction_id", "==", String(transaction_id)).limit(1).get();
    if (!existing.empty) {
      return send(res, 200, { success: true, already_exists: true, receipt_id: existing.docs[0].id });
    }

    const now = nowIso();
    const receiptRef = await db.collection("receipts").add({
      transaction_id: String(transaction_id),
      uploaded_by: String(tx.created_by || user.uid),
      file_url: "",
      file_name: "comprovante_pix_auto",
      file_type: "application/json",
      ocr_status: "completed",
      ocr_data: {
        auto_generated: true,
        amount: Number(tx.amount || 0),
        beneficiary: tx.beneficiary_name || null,
        pix_key: tx.pix_key || null,
        pix_e2eid: tx.pix_e2eid || null,
      },
      extracted_value: Number(tx.amount || 0),
      extracted_date: String(tx.paid_at || now).substring(0, 10),
      created_at: now,
      updated_at: now,
    });

    return send(res, 200, { success: true, receipt_id: receiptRef.id, generated: true });
  } catch (e) {
    logger.error("generatePixReceipt", e);
    return send(res, 500, { success: false, error: e.message || "Erro ao gerar comprovante." });
  }
});

exports.pixRefund = onRequest(ONZ_OPTIONS, async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const user = await requireAuth(req, res);
  if (!user) return;

  const { transaction_id, valor, motivo } = req.body || {};
  if (!transaction_id) return send(res, 400, { error: "transaction_id obrigatï¿½rio." });

  try {
    const tx = await txById(String(transaction_id));
    if (!tx) return send(res, 404, { error: "Transaï¿½ï¿½o nï¿½o encontrada." });
    if (String(tx.status || "") !== "completed") {
      return send(res, 400, { error: "Apenas transaï¿½ï¿½es concluï¿½das podem ser devolvidas." });
    }
    if (!tx.pix_e2eid) return send(res, 400, { error: "Transaï¿½ï¿½o sem e2eId." });

    const refundValue = Number(valor || tx.amount || 0);
    if (!Number.isFinite(refundValue) || refundValue <= 0) {
      return send(res, 400, { error: "Valor de devoluï¿½ï¿½o invï¿½lido." });
    }

    const existing = await db.collection("pix_refunds").where("transaction_id", "==", String(transaction_id)).get();
    const totalRefunded = existing.docs
      .map((d) => d.data())
      .filter((r) => String(r.status || "") !== "NAO_REALIZADO")
      .reduce((sum, r) => sum + Number(r.valor || 0), 0);

    const available = Number(tx.amount || 0) - totalRefunded;
    if (refundValue > available) {
      return send(res, 400, { error: "Valor de devoluï¿½ï¿½o excede saldo disponï¿½vel.", available });
    }

    const token = await getOnzToken(String(tx.company_id), "cash_in", false);
    if (token.error) return send(res, token.error.status || 500, { error: token.error.message, details: token.error.details || null });

    const base = String(token.config.base_url || "").replace(/\/$/, "");
    const refundId = crypto.randomUUID().replace(/-/g, "").substring(0, 35);

    const refund = await callOnzProxy(`${base}/pix/${encodeURIComponent(String(tx.pix_e2eid))}/devolucao/${refundId}`, "PUT", {
      Authorization: `Bearer ${token.accessToken}`,
      "Content-Type": "application/json",
    }, {
      valor: { original: refundValue.toFixed(2) },
    });

    if (!refund.ok) {
      return send(res, 502, { error: "Falha ao solicitar devoluï¿½ï¿½o.", provider_error: refund.data });
    }

    const rd = refund.data || {};
    await db.collection("pix_refunds").add({
      transaction_id: String(transaction_id),
      e2eid: String(tx.pix_e2eid),
      refund_id: refundId,
      valor: refundValue,
      motivo: motivo ? String(motivo) : null,
      status: rd.status || "EM_PROCESSAMENTO",
      refunded_at: rd.horario?.solicitacao || null,
      created_by: user.uid,
      created_at: nowIso(),
      updated_at: nowIso(),
    });

    return send(res, 200, { success: true, refund_id: refundId, status: rd.status || "EM_PROCESSAMENTO", valor: refundValue });
  } catch (e) {
    logger.error("pixRefund", e);
    return send(res, 500, { error: e.message || "Erro no pix-refund." });
  }
});

exports.billetConsult = onRequest(ONZ_OPTIONS, async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const user = await requireAuth(req, res);
  if (!user) return;

  const { company_id, codigo_barras } = req.body || {};
  const code = String(codigo_barras || "").replace(/\s/g, "");
  if (!company_id || !code) return send(res, 400, { error: "company_id e codigo_barras obrigatï¿½rios." });

  try {
    const token = await getOnzToken(String(company_id), "cash_out", false);
    if (token.error) return send(res, token.error.status || 500, { error: token.error.message, details: token.error.details || null });

    const base = String(token.config.base_url || "").replace(/\/$/, "");
    const result = await callOnzCandidates(base, token.accessToken, [
      { path: "/payments/billet/consult", method: "POST", body: { digitableLine: code } },
      { path: "/billet/consult", method: "POST", body: { digitableLine: code } },
      { path: "/boleto/consult", method: "POST", body: { codigoBarras: code } },
    ]);

    if (!result) {
      return send(res, 200, { success: false, error: "Consulta de boleto indisponï¿½vel para este provedor." });
    }

    const d = result.data?.data || result.data || {};
    return send(res, 200, {
      success: true,
      value: Number(d.value || d.amount || 0),
      total_updated_value: Number(d.totalUpdatedValue || d.total_updated_value || d.value || d.amount || 0),
      due_date: d.dueDate || d.due_date || null,
      fine_value: Number(d.fineValue || d.fine_value || 0),
      interest_value: Number(d.interestValue || d.interest_value || 0),
      discount_value: Number(d.discountValue || d.discount_value || 0),
      recipient_name: d.recipient?.name || d.recipientName || null,
      recipient_document: d.recipient?.document || d.recipientDocument || null,
      type: d.type || null,
      status: d.status || null,
      digitable_line: d.digitableLine || code,
      barcode: d.barCode || d.barcode || null,
      raw: d,
    });
  } catch (e) {
    logger.error("billetConsult", e);
    return send(res, 200, { success: false, error: e.message || "Erro no billet-consult." });
  }
});

exports.billetPay = onRequest(ONZ_OPTIONS, async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const user = await requireAuth(req, res);
  if (!user) return;

  const body = req.body || {};
  const companyId = String(body.company_id || "");
  const code = String(body.codigo_barras || "").replace(/\s/g, "");
  const amount = Number(body.valor || 0);
  const description = body.descricao ? String(body.descricao) : "Pagamento de boleto";
  const idempotencyKey = body.idempotency_key ? String(body.idempotency_key) : crypto.randomUUID().replace(/-/g, "").substring(0, 50);

  if (!companyId || !code) return send(res, 400, { error: "company_id e codigo_barras obrigatï¿½rios." });

  try {
    const token = await getOnzToken(companyId, "cash_out", false);
    if (token.error) return send(res, token.error.status || 500, { error: token.error.message, details: token.error.details || null });

    const base = String(token.config.base_url || "").replace(/\/$/, "");
    const result = await callOnzCandidates(base, token.accessToken, [
      {
        path: "/payments/billet",
        method: "POST",
        idempotencyKey,
        body: { digitableLine: code, amount: amount > 0 ? Number(amount.toFixed(2)) : undefined, description },
      },
      {
        path: "/billet/pay",
        method: "POST",
        idempotencyKey,
        body: { digitableLine: code, amount: amount > 0 ? Number(amount.toFixed(2)) : undefined, description },
      },
      {
        path: "/boleto/pay",
        method: "POST",
        idempotencyKey,
        body: { codigoBarras: code, valor: amount > 0 ? Number(amount.toFixed(2)) : undefined, descricao: description },
      },
    ]);

    if (!result) {
      return send(res, 502, { error: "Pagamento de boleto indisponï¿½vel para este provedor." });
    }

    const d = result.data?.data || result.data || {};
    const mapped = mapBilletStatus(d.status || "PROCESSING");
    const txId = await createTx({
      company_id: companyId,
      created_by: user.uid,
      amount: Number(d.amount || amount || 0),
      status: mapped.internal,
      pix_type: "boleto",
      pix_copia_cola: code,
      description,
      external_id: String(d.id || d.billetId || d.billet_id || "") || null,
      beneficiary_name: d.creditor?.name || d.recipient?.name || null,
      beneficiary_document: d.creditor?.document || d.recipient?.document || null,
      pix_provider_response: d,
      ...(mapped.completed ? { paid_at: nowIso() } : {}),
    });

    return send(res, 200, {
      success: true,
      transaction_id: txId,
      external_id: String(d.id || d.billetId || d.billet_id || ""),
      status: mapped.raw,
      amount: Number(d.amount || amount || 0),
      due_date: d.dueDate || d.due_date || null,
      creditor: d.creditor || d.recipient || null,
      idempotency_key: idempotencyKey,
    });
  } catch (e) {
    logger.error("billetPay", e);
    return send(res, 500, { error: e.message || "Erro no billet-pay." });
  }
});

exports.billetCheckStatus = onRequest(ONZ_OPTIONS, async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const user = await requireAuth(req, res);
  if (!user) return;

  const body = req.body || {};
  let companyId = body.company_id ? String(body.company_id) : "";
  let transactionId = body.transaction_id ? String(body.transaction_id) : "";
  let billetId = body.billet_id ? String(body.billet_id) : "";

  try {
    if (transactionId && (!companyId || !billetId)) {
      const tx = await txById(transactionId);
      if (tx) {
        companyId = companyId || String(tx.company_id || "");
        billetId = billetId || String(tx.external_id || "");
      }
    }

    if (!companyId || !billetId) {
      return send(res, 400, { error: "company_id e billet_id (ou transaction_id) obrigatï¿½rios." });
    }

    const token = await getOnzToken(companyId, "cash_out", false);
    if (token.error) return send(res, token.error.status || 500, { error: token.error.message, details: token.error.details || null });

    const base = String(token.config.base_url || "").replace(/\/$/, "");
    const result = await callOnzCandidates(base, token.accessToken, [
      { path: `/payments/billet/${encodeURIComponent(billetId)}`, method: "GET" },
      { path: `/payments/billet/status/${encodeURIComponent(billetId)}`, method: "GET" },
      { path: `/billet/${encodeURIComponent(billetId)}`, method: "GET" },
      { path: `/boleto/${encodeURIComponent(billetId)}`, method: "GET" },
    ]);

    if (!result) return send(res, 502, { error: "Nï¿½o foi possï¿½vel obter status do boleto." });

    const d = result.data?.data || result.data || {};
    const mapped = mapBilletStatus(d.status || "PROCESSING");

    if (transactionId) {
      const update = {
        status: mapped.internal,
        pix_provider_response: d,
        ...(mapped.completed ? { paid_at: nowIso() } : {}),
      };
      await updateTx(transactionId, update);
    }

    return send(res, 200, {
      success: true,
      billet_id: Number(d.id || d.billetId || billetId),
      status: mapped.raw,
      internal_status: mapped.internal,
      is_completed: mapped.completed,
      amount: Number(d.amount || 0),
      due_date: d.dueDate || d.due_date || null,
      settle_date: d.settleDate || d.settle_date || null,
      bar_code: d.barCode || d.bar_code || null,
      creditor: d.creditor || null,
      debtor: d.debtor || null,
      error_code: d.errorCode || d.error_code || null,
    });
  } catch (e) {
    logger.error("billetCheckStatus", e);
    return send(res, 500, { error: e.message || "Erro no billet-check-status." });
  }
});

exports.billetReceipt = onRequest(ONZ_OPTIONS, async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const user = await requireAuth(req, res);
  if (!user) return;

  const body = req.body || {};
  let companyId = body.company_id ? String(body.company_id) : "";
  let transactionId = body.transaction_id ? String(body.transaction_id) : "";
  let billetId = body.billet_id ? String(body.billet_id) : "";

  try {
    if (transactionId && (!companyId || !billetId)) {
      const tx = await txById(transactionId);
      if (tx) {
        companyId = companyId || String(tx.company_id || "");
        billetId = billetId || String(tx.external_id || "");
      }
    }

    if (!companyId || !billetId) {
      return send(res, 400, { error: "company_id e billet_id (ou transaction_id) obrigatï¿½rios." });
    }

    const token = await getOnzToken(companyId, "cash_out", false);
    if (token.error) return send(res, token.error.status || 500, { error: token.error.message, details: token.error.details || null });

    const base = String(token.config.base_url || "").replace(/\/$/, "");
    const result = await callOnzCandidates(base, token.accessToken, [
      { path: `/payments/billet/receipt/${encodeURIComponent(billetId)}`, method: "GET" },
      { path: `/billet/receipt/${encodeURIComponent(billetId)}`, method: "GET" },
      { path: `/boleto/receipt/${encodeURIComponent(billetId)}`, method: "GET" },
    ]);

    if (!result) return send(res, 404, { error: "Comprovante de boleto ainda nï¿½o disponï¿½vel." });

    const d = result.data?.data || result.data || {};
    const pdf = d.pdf || d.receipt || d.base64 || null;
    if (!pdf) return send(res, 404, { error: "Comprovante nï¿½o retornado pelo provedor." });

    return send(res, 200, {
      success: true,
      billet_id: billetId,
      pdf_base64: String(pdf),
      content_type: "application/pdf",
    });
  } catch (e) {
    logger.error("billetReceipt", e);
    return send(res, 500, { error: e.message || "Erro no billet-receipt." });
  }
});

exports.processOcr = onRequest({ region: REGION }, async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const user = await requireAuth(req, res);
  if (!user) return;

  try {
    const { imageBase64, imageUrl } = req.body || {};
    if (!imageBase64 && !imageUrl) {
      return send(res, 400, { success: false, error: "Imagem obrigatï¿½ria (base64 ou URL)." });
    }

    const apiKey = String(process.env.LOVABLE_API_KEY || "");
    if (!apiKey) {
      return send(res, 500, { success: false, error: "LOVABLE_API_KEY nï¿½o configurada." });
    }

    const imageContent = imageBase64
      ? { type: "image_url", image_url: { url: `data:image/jpeg;base64,${String(imageBase64)}` } }
      : { type: "image_url", image_url: { url: String(imageUrl) } };

    const ai = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: "Voce e um especialista em OCR e analise de documentos fiscais brasileiros. Responda APENAS com JSON valido contendo: cnpj, cpf, razao_social, data_emissao (YYYY-MM-DD), valor_total, chave_acesso, itens, keywords, categoria_sugerida, classificacao_sugerida (cost|expense), confianca (0..1). Se nao encontrar um campo, retorne null.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Analise este comprovante/nota fiscal e extraia os dados." },
              imageContent,
            ],
          },
        ],
        max_tokens: 1500,
        temperature: 0.1,
      }),
    });

    if (!ai.ok) {
      if (ai.status === 429) return send(res, 429, { success: false, error: "Limite de requisiï¿½ï¿½es excedido. Tente novamente." });
      if (ai.status === 402) return send(res, 402, { success: false, error: "Crï¿½ditos de IA esgotados." });
      const errText = await ai.text();
      logger.error("processOcr gateway", { status: ai.status, errText });
      return send(res, 502, { success: false, error: "Erro no serviï¿½o de IA." });
    }

    const aiJson = await ai.json();
    const content = aiJson?.choices?.[0]?.message?.content;
    if (!content) return send(res, 422, { success: false, error: "Resposta vazia do OCR." });

    let extracted;
    try {
      extracted = parseOcrContent(content);
    } catch (_) {
      return send(res, 422, { success: false, error: "Formato de resposta invï¿½lido.", raw_response: content });
    }

    return send(res, 200, { success: true, data: extracted });
  } catch (e) {
    logger.error("processOcr", e);
    return send(res, 500, { success: false, error: e.message || "Erro no process-ocr." });
  }
});











