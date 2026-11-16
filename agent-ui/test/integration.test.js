// Integration API (/api/v1): API key, tool catalogue, OpenAPI spec. Own server instance, no model calls.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP = path.resolve(__dirname, '..');
const KEY = 'test-key-123';
let proc, base, dataDir;
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const call = (p, opt = {}) => fetch(base + p, opt).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const auth = { authorization: 'Bearer ' + KEY, 'content-type': 'application/json' };

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-ui-int-'));
  fs.mkdirSync(path.join(dataDir, 'runs'));
  fs.writeFileSync(path.join(dataDir, 'bugs.json'), '[]');
  fs.writeFileSync(path.join(dataDir, 'jira-sync.json'), JSON.stringify({ lastTry: Date.now(), lastOk: Date.now(), lastComments: Date.now(), added: 0, found: 0, error: '' }));
  const port = await freePort();
  base = 'http://127.0.0.1:' + port;
  proc = spawn('node', ['server.js'], { cwd: APP, env: { ...process.env, PORT: String(port), QA_DATA_DIR: dataDir, QA_API_KEY: KEY, JIRA_SYNC_MINUTES: '999999', QA_HEDGE_GUARD: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 20000);
    proc.stdout.on('data', (c) => { if (String(c).includes('Agent UI:')) { clearTimeout(t); resolve(); } });
    proc.on('exit', (code) => reject(new Error('server exited early: ' + code)));
  });
});
after(() => { if (proc) proc.kill(); try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) { /* temp */ } });

test('OpenAPI spec and tool definitions are public and describe every tool', async () => {
  const spec = await call('/api/v1/openapi.json');
  assert.equal(spec.status, 200);
  assert.equal(spec.body.openapi, '3.1.0');
  const ids = Object.values(spec.body.paths).flatMap((o) => Object.values(o).map((x) => x.operationId));
  for (const n of ['run_ui_test', 'run_backend_test', 'get_run']) assert.ok(ids.includes(n), n);
  const tools = await call('/api/v1/tools');
  assert.equal(tools.body.openai.length, ids.length);
  assert.ok(tools.body.anthropic[0].input_schema && tools.body.mcp[0].inputSchema);
});

test('everything else needs the API key', async () => {
  assert.equal((await call('/api/v1/runs')).status, 401);
  assert.equal((await call('/api/v1/runs', { headers: { authorization: 'Bearer nope' } })).status, 401);
  assert.equal((await call('/api/v1/runs', { headers: { 'x-api-key': KEY } })).status, 200);
  assert.equal((await call('/api/v1/health', { headers: auth })).status, 200);
});

test('starting tests validates input through the app and unknown run is 404', async () => {
  const bad = await call('/api/v1/tests/ui', { method: 'POST', headers: auth, body: JSON.stringify({ url: 'not a url', goal: 'check the login page works' }) });
  assert.equal(bad.status, 400);
  const short = await call('/api/v1/tests/backend', { method: 'POST', headers: auth, body: JSON.stringify({ description: 'x' }) });
  assert.ok([400, 409].includes(short.status), 'rejected by the app (400, or 409 when QA MCP is not set up here)');
  assert.equal((await call('/api/v1/runs/nope', { headers: auth })).status, 404);
  assert.equal((await call('/api/v1/nothing', { headers: auth })).status, 404);
});
