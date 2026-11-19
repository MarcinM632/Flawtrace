// Integration API for outside LLMs and tools (Claude, ChatGPT, any agent that can call HTTP or MCP).
// One stable, documented surface under /api/v1 that starts UI and backend tests and reads their results.
// It does not duplicate any logic: every call is forwarded to the app's own endpoints on loopback, so the
// validation, limits and run store stay in one place.
//
// Security: /api/v1 always needs an API key (Authorization: Bearer <key> or X-API-Key). The key comes from
// QA_API_KEY, else it is generated once and kept in <data dir>/api-key.txt. A tunnel in front of the app (which
// makes remote requests look like loopback) therefore cannot open it up.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, PORT } = require('./config');

const KEY_FILE = path.join(DATA_DIR, 'api-key.txt');

function apiKey() {
  const env = String(process.env.QA_API_KEY || '').trim();
  if (env) return env;
  try { const k = fs.readFileSync(KEY_FILE, 'utf8').trim(); if (k) return k; } catch (_) { /* first start */ }
  const k = 'ft_' + crypto.randomBytes(24).toString('hex');
  try { fs.writeFileSync(KEY_FILE, k + '\n', { mode: 0o600 }); } catch (_) { /* read-only disk: key lives for this process */ }
  generated = k;
  return k;
}
let generated = null;

function authorized(req) {
  const h = String(req.headers.authorization || '');
  const given = (/^Bearer\s+(.+)$/i.exec(h) || [])[1] || String(req.headers['x-api-key'] || '');
  const a = crypto.createHash('sha256').update(given.trim()).digest();
  const b = crypto.createHash('sha256').update(apiKey()).digest();
  return crypto.timingSafeEqual(a, b);
}

// ---- Tool catalogue: the single source for OpenAPI, OpenAI/Anthropic tool definitions and the MCP server ----
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const TOOLS = [
  {
    name: 'run_ui_test', method: 'POST', path: '/tests/ui',
    summary: 'Start a UI test: an agent opens the page in a browser, checks what is asked and can log in first.',
    input: {
      type: 'object', required: ['url', 'goal'],
      properties: {
        url: str('Address of the page to test (http or https, no user name or password inside).'),
        goal: str('What to check on the page, at least 10 characters.', { minLength: 10, maxLength: 8000 }),
        username: str('Optional login user name.'),
        password: str('Optional login password. Kept in memory of the run only.'),
      },
    },
  },
  {
    name: 'run_backend_test', method: 'POST', path: '/tests/backend',
    summary: 'Start a backend (API) test: an agent calls the test environment API and reports what it found.',
    input: {
      type: 'object', required: ['description'],
      properties: {
        description: str('The test process to run, at least 10 characters.', { minLength: 10, maxLength: 8000 }),
        scope: str('"auto" (default) or "all".', { enum: ['auto', 'all'] }),
      },
    },
  },
  {
    name: 'run_suite', method: 'POST', path: '/tests/suite',
    summary: 'Run selected tests of the autotest suite (pytest) and return the run id.',
    input: {
      type: 'object', required: ['targets'],
      properties: { targets: { type: 'array', items: { type: 'string' }, description: 'Test files or test ids from list_suite.' } },
    },
  },
  { name: 'list_suite', method: 'GET', path: '/tests/suite', summary: 'List the tests of the autotest suite and the state of the last suite run.', input: { type: 'object', properties: {} } },
  { name: 'get_suite_run', method: 'GET', path: '/tests/suite/run', summary: 'Status and output of the current or last suite run.', input: { type: 'object', properties: {} } },
  { name: 'list_runs', method: 'GET', path: '/runs', summary: 'Recent agent runs (UI tests, backend tests, analyses) with status.', input: { type: 'object', properties: { limit: { type: 'integer', description: 'Max rows, default 20.' } } } },
  {
    name: 'get_run', method: 'GET', path: '/runs/{id}', summary: 'Status and report of one run. Poll until status is not "running".',
    input: { type: 'object', required: ['id'], properties: { id: str('Run id returned when the test was started.') } },
  },
  {
    name: 'cancel_run', method: 'POST', path: '/runs/{id}/cancel', summary: 'Cancel a running run.',
    input: { type: 'object', required: ['id'], properties: { id: str('Run id.') } },
  },
];

const pathParams = (t) => (t.path.match(/\{(\w+)\}/g) || []).map((s) => s.slice(1, -1));

function openai() {
  return TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.summary, parameters: t.input } }));
}
function anthropic() {
  return TOOLS.map((t) => ({ name: t.name, description: t.summary, input_schema: t.input }));
}
function mcp() {
  return TOOLS.map((t) => ({ name: t.name, description: t.summary, inputSchema: t.input }));
}

function openapi(serverUrl) {
  const paths = {};
  for (const t of TOOLS) {
    const params = pathParams(t);
    const op = { operationId: t.name, summary: t.summary, responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } } } };
    const props = t.input.properties || {};
    if (t.method === 'POST' && !params.length) {
      op.requestBody = { required: true, content: { 'application/json': { schema: t.input } } };
    } else {
      op.parameters = Object.entries(props).map(([name, s]) => ({
        name, in: params.includes(name) ? 'path' : 'query', required: params.includes(name), schema: { type: s.type || 'string' }, description: s.description,
      }));
    }
    (paths['/api/v1' + t.path] = paths['/api/v1' + t.path] || {})[t.method.toLowerCase()] = op;
  }
  return {
    openapi: '3.1.0',
    info: { title: 'Flawtrace integration API', version: '1.0.0', description: 'Start UI and backend tests and read their results.' },
    servers: [{ url: serverUrl }],
    components: { securitySchemes: { ApiKey: { type: 'http', scheme: 'bearer' } } },
    security: [{ ApiKey: [] }],
    paths,
  };
}

// ---- Handlers: translate a v1 call into the app's own endpoints ----
const slimRun = (r) => {
  const m = r.meta || r;
  return {
    id: m.id, agent: m.agent, label: m.label, input: m.ticket, status: m.status, reportStatus: m.reportStatus || null,
    startedAt: m.startedAt, finishedAt: m.finishedAt || null, error: m.error || null, costUsd: m.costUsd == null ? null : m.costUsd,
    report: m.report || null,
  };
};

async function local(method, p, payload) {
  const res = await fetch(`http://127.0.0.1:${PORT}${p}`, {
    method, headers: { 'content-type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const ROUTES = [
  ['POST', /^\/tests\/ui$/, async (b) => local('POST', '/api/runs', { agent: 'uitest', ticket: b.goal, url: b.url, username: b.username, password: b.password }).then(started)],
  ['POST', /^\/tests\/backend$/, async (b) => local('POST', '/api/runs', { agent: 'qamcp', ticket: b.description, scope: b.scope }).then(started)],
  ['POST', /^\/tests\/suite$/, async (b) => local('POST', '/api/suite/run', { targets: b.targets })],
  ['GET', /^\/tests\/suite$/, async () => local('GET', '/api/suite')],
  ['GET', /^\/tests\/suite\/run$/, async () => local('GET', '/api/suite/run')],
  ['GET', /^\/runs$/, async (_b, q) => {
    const r = await local('GET', '/api/runs');
    const list = Array.isArray(r.data) ? r.data : (r.data.runs || []);
    const limit = Math.min(Math.max(parseInt(q.get('limit'), 10) || 20, 1), 200);
    return { status: r.status, data: { runs: list.slice(0, limit).map(slimRun) } };
  }],
  ['GET', /^\/runs\/([\w-]+)$/, async (_b, _q, m) => {
    const r = await local('GET', '/api/runs/' + m[1]);
    return r.status === 200 ? { status: 200, data: slimRun(r.data) } : r;
  }],
  ['POST', /^\/runs\/([\w-]+)\/cancel$/, async (_b, _q, m) => local('POST', `/api/runs/${m[1]}/cancel`)],
];
function started(r) { return r.status === 201 ? { status: 202, data: slimRun(r.data) } : r; }

/** True only for a request made on this machine and not relayed by a proxy or tunnel. */
function isLocalDirect(req) {
  const a = String(req.socket.remoteAddress || '');
  const local = a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
  const relayed = ['x-forwarded-for', 'x-forwarded-host', 'forwarded', 'x-real-ip'].some((h) => req.headers[h]);
  return local && !relayed;
}

/** Facts the "How to connect" page shows. The key itself goes only to a direct local request. */
function info(req) {
  const origin = process.env.QA_PUBLIC_URL || `http://${req.headers.host || '127.0.0.1:' + PORT}`;
  const local = isLocalDirect(req);
  return {
    url: origin, publicUrlSet: !!process.env.QA_PUBLIC_URL, keyFromEnv: !!process.env.QA_API_KEY, keyFile: KEY_FILE,
    key: local ? apiKey() : null, keyHidden: !local,
    mcpScript: path.resolve(__dirname, '..', 'mcp', 'flawtrace-server.js'),
  };
}

/** Returns true when the request belonged to /api/v1 or /api/integration (and was answered). */
async function handle(req, res, p, { body, json }) {
  if (p === '/api/integration' && req.method === 'GET') return json(res, 200, info(req)), true;
  if (p === '/api/llm' || p === '/api/llm/test' || p === '/api/llm/detect' || p === '/api/llm/login') {
    const llm = require('./llm');
    if (req.method === 'GET' && p === '/api/llm') return json(res, 200, llm.view()), true;
    if (req.method === 'GET' && p === '/api/llm/detect') return json(res, 200, await require('./llm/detect').detect()), true;
    // A key is written or used only by a direct request on this machine, never through a proxy or tunnel.
    if (!isLocalDirect(req)) return json(res, 403, { error: 'Open Flawtrace directly on the machine it runs on to change the AI provider.' }), true;
    if (req.method === 'POST' && p === '/api/llm/login') {
      try { const b = await body(req); return json(res, 200, require('./llm/detect').startLogin(String(b.tool || ''))), true; } catch (e) { return json(res, e.code || 500, { error: e.message }), true; }
    }
    if (req.method === 'POST' && p === '/api/llm') {
      try {
        const b = await body(req);
        if (require('./hosted').HOSTED && b && b.baseUrl) await require('./net-guard').assertPublicUrl(b.baseUrl, { schemes: ['https:'] }).catch((e) => { throw Object.assign(e, { code: 400 }); });
        return json(res, 200, llm.update(b)), true;
      } catch (e) { return json(res, e.code || 500, { error: e.message }), true; }
    }
    if (req.method === 'POST' && p === '/api/llm/test') {
      try { const r = await llm.complete('Reply with the single word OK.', 'ping', { timeoutMs: 45000 }); return json(res, 200, { ok: true, text: String(r.text).slice(0, 80), provider: r.provider, usage: r.usage || null }), true; }
      catch (e) { return json(res, 200, { ok: false, error: e.message }), true; }
    }
  }
  if (p !== '/api/v1' && !p.startsWith('/api/v1/')) return false;
  const url = new URL(req.url, 'http://x');
  const sub = p.slice('/api/v1'.length) || '/';
  const origin = process.env.QA_PUBLIC_URL || `http://${req.headers.host || '127.0.0.1:' + PORT}`;
  // The two descriptions carry no data, so a tool (e.g. a Custom GPT importing the spec) can read them without the key.
  if (req.method === 'GET' && sub === '/openapi.json') return json(res, 200, openapi(origin)), true;
  if (req.method === 'GET' && sub === '/tools') {
    const f = url.searchParams.get('format');
    return json(res, 200, f === 'openai' ? openai() : f === 'anthropic' ? anthropic() : f === 'mcp' ? mcp() : { openai: openai(), anthropic: anthropic(), mcp: mcp() }), true;
  }
  if (!authorized(req)) { res.setHeader('WWW-Authenticate', 'Bearer'); return json(res, 401, { error: 'Missing or wrong API key. Send it as "Authorization: Bearer <key>" or "X-API-Key".' }), true; }
  if (req.method === 'GET' && sub === '/health') return json(res, 200, { ok: true }), true;
  for (const [method, re, fn] of ROUTES) {
    const m = re.exec(sub);
    if (req.method !== method || !m) continue;
    const b = method === 'POST' ? await body(req) : {};
    const out = await fn(b, url.searchParams, m);
    return json(res, out.status, out.data), true;
  }
  return json(res, 404, { error: 'Unknown /api/v1 route' }), true;
}

module.exports = { info, isLocalDirect, TOOLS, KEY_FILE, anthropic, apiKey, authorized, handle, mcp, openai, openapi, pathParams, slimRun, wasGenerated: () => generated };
