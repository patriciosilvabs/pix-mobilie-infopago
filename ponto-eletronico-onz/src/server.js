const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const ENV_FILE = path.join(ROOT, '.env');
const PORT = Number(process.env.PORT || 3333);

function loadEnvFile() {
  if (!fs.existsSync(ENV_FILE)) return;
  const lines = fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

const ONZ_BASE_URL = process.env.ONZ_BASE_URL || 'https://secureapi.bancodigital.hmg.onz.software/api/v2';
const ONZ_CLIENT_ID = process.env.ONZ_CLIENT_ID || '';
const ONZ_CLIENT_SECRET = process.env.ONZ_CLIENT_SECRET || '';
const ONZ_SCOPE = process.env.ONZ_SCOPE || 'pix.write pix.read';
const ONZ_MOCK = (process.env.ONZ_MOCK || 'true').toLowerCase() === 'true';

let tokenCache = null;

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ employees: [], timeEntries: [], payrolls: [], pixEvents: [] }, null, 2),
      'utf8',
    );
  }
}

function readDb() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, 'utf8').replace(/^\\uFEFF/, '');
  return JSON.parse(raw);
}

function writeDb(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-idempotency-key',
  });
  res.end(JSON.stringify(payload));
}

function notFound(res) {
  json(res, 404, { error: 'Not found' });
}

function badRequest(res, message) {
  json(res, 400, { error: message });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString('utf8');
      if (body.length > 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function monthToRange(month) {
  const match = /^\d{4}-\d{2}$/.test(month);
  if (!match) throw new Error('Mês inválido. Use formato YYYY-MM.');
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1, 0, 0, 0));
  return { start, end };
}

function durationHours(startIso, endIso) {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  return ms > 0 ? ms / 1000 / 60 / 60 : 0;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function computePayrollForEmployee(employee, entries) {
  const completedEntries = entries.filter((entry) => Boolean(entry.clockOutAt));
  const totalHours = round2(
    completedEntries.reduce((sum, entry) => sum + durationHours(entry.clockInAt, entry.clockOutAt), 0),
  );

  const standardMonthlyHours = 220;
  const hourlyRate = employee.baseSalary / standardMonthlyHours;
  const overtimeHours = Math.max(0, totalHours - standardMonthlyHours);
  const overtimeAmount = round2(overtimeHours * hourlyRate * 1.5);
  const grossSalary = round2(employee.baseSalary + overtimeAmount);
  const inss = round2(grossSalary * 0.08);
  const netSalary = round2(grossSalary - inss);

  return {
    totalHours,
    overtimeHours: round2(overtimeHours),
    overtimeAmount,
    grossSalary,
    inss,
    netSalary,
  };
}

async function fetchOnzToken() {
  if (ONZ_MOCK) return 'mock-token';
  if (!ONZ_CLIENT_ID || !ONZ_CLIENT_SECRET) {
    throw new Error('ONZ_CLIENT_ID e ONZ_CLIENT_SECRET são obrigatórios quando ONZ_MOCK=false.');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.expiresAt > nowSeconds + 20) {
    return tokenCache.accessToken;
  }

  const response = await fetch(`${ONZ_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: ONZ_CLIENT_ID,
      clientSecret: ONZ_CLIENT_SECRET,
      grantType: 'client_credentials',
      scope: ONZ_SCOPE,
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`Erro ao autenticar na ONZ: HTTP ${response.status} ${JSON.stringify(data)}`);
  }

  tokenCache = {
    accessToken: data.accessToken,
    expiresAt: Number(data.expiresAt || nowSeconds + 300),
  };

  return tokenCache.accessToken;
}

function createIdempotencyKey() {
  return crypto.randomBytes(16).toString('hex').slice(0, 32);
}

async function sendPixViaOnz({ pixKey, creditorDocument, amount, description }) {
  if (ONZ_MOCK) {
    return {
      mode: 'mock',
      status: 'QUEUED',
      id: Math.floor(Math.random() * 1000000),
      endToEndId: `E2E${Date.now()}`,
      eventDate: new Date().toISOString(),
      payment: { currency: 'BRL', amount },
      type: 'DICT',
    };
  }

  const token = await fetchOnzToken();
  const idempotencyKey = createIdempotencyKey();
  const payload = {
    pixKey,
    creditorDocument,
    description,
    paymentFlow: 'INSTANT',
    payment: {
      currency: 'BRL',
      amount,
    },
  };

  const response = await fetch(`${ONZ_BASE_URL}/pix/payments/dict`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-idempotency-key': idempotencyKey,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`Erro ONZ Pix: HTTP ${response.status} ${JSON.stringify(data)}`);
  }

  return { mode: 'live', idempotencyKey, ...data };
}

function parsePath(reqUrl) {
  const url = new URL(reqUrl, 'http://localhost');
  return { pathname: url.pathname, searchParams: url.searchParams };
}

function serveStatic(pathname, res) {
  const resolved = pathname === '/' ? '/index.html' : pathname;
  const clean = path.normalize(resolved).replace(/^([.][.][\\/])+/, '');
  const filePath = path.join(PUBLIC_DIR, clean);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    notFound(res);
    return;
  }

  if (!fs.existsSync(filePath)) {
    notFound(res);
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType =
    ext === '.html'
      ? 'text/html; charset=utf-8'
      : ext === '.css'
        ? 'text/css; charset=utf-8'
        : ext === '.js'
          ? 'application/javascript; charset=utf-8'
          : 'application/octet-stream';

  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-idempotency-key',
      });
      res.end();
      return;
    }

    const { pathname, searchParams } = parsePath(req.url || '/');

    if (pathname === '/api/health' && req.method === 'GET') {
      json(res, 200, {
        ok: true,
        service: 'ponto-eletronico-onz',
        onzMode: ONZ_MOCK ? 'mock' : 'live',
        now: new Date().toISOString(),
      });
      return;
    }

    if (pathname === '/api/employees' && req.method === 'GET') {
      const db = readDb();
      json(res, 200, db.employees);
      return;
    }

    if (pathname === '/api/employees' && req.method === 'POST') {
      const body = await parseBody(req);
      const { name, role, cpf, pixKey, baseSalary } = body;
      if (!name || !cpf || !pixKey || !baseSalary) {
        badRequest(res, 'Campos obrigatórios: name, cpf, pixKey, baseSalary');
        return;
      }
      const db = readDb();
      const employee = {
        id: randomId('emp'),
        name,
        role: role || 'Colaborador',
        cpf,
        pixKey,
        baseSalary: Number(baseSalary),
        createdAt: new Date().toISOString(),
      };
      db.employees.push(employee);
      writeDb(db);
      json(res, 201, employee);
      return;
    }

    if (pathname === '/api/time-entries' && req.method === 'GET') {
      const db = readDb();
      const employeeId = searchParams.get('employeeId');
      const month = searchParams.get('month');
      let entries = db.timeEntries;

      if (employeeId) entries = entries.filter((item) => item.employeeId === employeeId);
      if (month) {
        const { start, end } = monthToRange(month);
        entries = entries.filter((item) => {
          const startAt = new Date(item.clockInAt);
          return startAt >= start && startAt < end;
        });
      }

      json(res, 200, entries);
      return;
    }

    if (pathname === '/api/time-entries/clock-in' && req.method === 'POST') {
      const body = await parseBody(req);
      const { employeeId, timestamp } = body;
      if (!employeeId) {
        badRequest(res, 'employeeId é obrigatório');
        return;
      }

      const db = readDb();
      const employee = db.employees.find((item) => item.id === employeeId);
      if (!employee) {
        json(res, 404, { error: 'Funcionário não encontrado' });
        return;
      }

      const hasOpen = db.timeEntries.some((entry) => entry.employeeId === employeeId && !entry.clockOutAt);
      if (hasOpen) {
        badRequest(res, 'Já existe um ponto aberto para este funcionário');
        return;
      }

      const entry = {
        id: randomId('time'),
        employeeId,
        clockInAt: timestamp || new Date().toISOString(),
        clockOutAt: null,
      };

      db.timeEntries.push(entry);
      writeDb(db);
      json(res, 201, entry);
      return;
    }

    if (pathname === '/api/time-entries/clock-out' && req.method === 'POST') {
      const body = await parseBody(req);
      const { employeeId, timestamp } = body;
      if (!employeeId) {
        badRequest(res, 'employeeId é obrigatório');
        return;
      }

      const db = readDb();
      const openEntry = [...db.timeEntries]
        .reverse()
        .find((entry) => entry.employeeId === employeeId && !entry.clockOutAt);

      if (!openEntry) {
        badRequest(res, 'Nenhum ponto aberto encontrado');
        return;
      }

      openEntry.clockOutAt = timestamp || new Date().toISOString();
      writeDb(db);
      json(res, 200, openEntry);
      return;
    }

    if (pathname === '/api/payroll/close-month' && req.method === 'POST') {
      const body = await parseBody(req);
      const month = body.month;
      if (!month) {
        badRequest(res, 'month é obrigatório no formato YYYY-MM');
        return;
      }

      const { start, end } = monthToRange(month);
      const db = readDb();

      const payrolls = db.employees.map((employee) => {
        const entries = db.timeEntries.filter((entry) => {
          const clockInAt = new Date(entry.clockInAt);
          return entry.employeeId === employee.id && clockInAt >= start && clockInAt < end;
        });

        const computed = computePayrollForEmployee(employee, entries);
        const existing = db.payrolls.find((payroll) => payroll.employeeId === employee.id && payroll.month === month);

        const record = {
          id: existing ? existing.id : randomId('pay'),
          employeeId: employee.id,
          employeeName: employee.name,
          cpf: employee.cpf,
          pixKey: employee.pixKey,
          month,
          status: existing && existing.status === 'PAID' ? 'PAID' : 'CLOSED',
          ...computed,
          paidAt: existing ? existing.paidAt || null : null,
          pixPayment: existing ? existing.pixPayment || null : null,
          updatedAt: new Date().toISOString(),
        };

        if (existing) {
          Object.assign(existing, record);
          return existing;
        }

        db.payrolls.push(record);
        return record;
      });

      writeDb(db);
      json(res, 201, payrolls);
      return;
    }

    if (pathname === '/api/payroll' && req.method === 'GET') {
      const db = readDb();
      const month = searchParams.get('month');
      const data = month ? db.payrolls.filter((item) => item.month === month) : db.payrolls;
      json(res, 200, data);
      return;
    }

    const payMatch = pathname.match(/^\/api\/payroll\/([^/]+)\/pay-via-pix$/);
    if (payMatch && req.method === 'POST') {
      const payrollId = payMatch[1];
      const body = await parseBody(req);
      const description = body.description || 'Pagamento de folha';

      const db = readDb();
      const payroll = db.payrolls.find((item) => item.id === payrollId);
      if (!payroll) {
        json(res, 404, { error: 'Folha não encontrada' });
        return;
      }

      if (payroll.status === 'PAID') {
        badRequest(res, 'Esta folha já foi paga');
        return;
      }

      const pixResult = await sendPixViaOnz({
        pixKey: payroll.pixKey,
        creditorDocument: payroll.cpf,
        amount: payroll.netSalary,
        description: `${description} ${payroll.month}`,
      });

      payroll.status = 'PAID';
      payroll.paidAt = new Date().toISOString();
      payroll.pixPayment = pixResult;

      db.pixEvents.push({
        id: randomId('pixevt'),
        payrollId: payroll.id,
        employeeId: payroll.employeeId,
        month: payroll.month,
        amount: payroll.netSalary,
        mode: pixResult.mode,
        createdAt: new Date().toISOString(),
        payload: pixResult,
      });

      writeDb(db);
      json(res, 200, payroll);
      return;
    }

    if (pathname === '/api/pix/events' && req.method === 'GET') {
      const db = readDb();
      json(res, 200, db.pixEvents);
      return;
    }

    if (pathname.startsWith('/api/')) {
      notFound(res);
      return;
    }

    serveStatic(pathname, res);
  } catch (error) {
    json(res, 500, { error: error.message || 'Erro interno' });
  }
});

ensureDataFile();
server.listen(PORT, () => {
  console.log(`Servidor iniciado em http://localhost:${PORT}`);
  console.log(`Integração ONZ: ${ONZ_MOCK ? 'MODO MOCK' : 'MODO REAL'}`);
});
