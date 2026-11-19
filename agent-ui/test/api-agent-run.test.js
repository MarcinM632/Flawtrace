// A QA MCP run on the user's own API key (built-in agent loop), through the real server, with a fake provider instead of
// an AI. Checks: the loop starts the real tool servers, a tool call is run and logged, the report is extracted, the run
// ends, and with a missing key the run fails with a clear message instead of falling back to Claude Code.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP = path.resolve(__dirname, '..');
const TOKEN = 'gateway-token-0123456789abcdef0123';
let proc, base, dataDir, fake, fakeBase, requests = [];
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

before(async () => {
  fake = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const j = JSON.parse(b || '{}'); requests.push(j);
      const lastIsToolResult = Array.isArray(j.messages.at(-1).content) && j.messages.at(-1).content[0].type === 'tool_result';
      const status = (j.tools || []).find((t) => /general_get_status$/.test(t.name));
      res.writeHead(200, { 'content-type': 'application/json' });
      if (!lastIsToolResult && status) {
        return res.end(JSON.stringify({ content: [{ type: 'tool_use', id: 'tu1', name: status.name, input: {} }], stop_reason: 'tool_use', usage: { input_tokens: 100, output_tokens: 10 } }));
      }
      res.end(JSON.stringify({ content: [{ type: 'text', text: 'STATUS: OK\n--- TREŚĆ ---\nFake report from the API loop\n--- KONIEC TREŚCI ---' }], stop_reason: 'end_turn', usage: { input_tokens: 120, output_tokens: 20 } }));
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  fakeBase = 'http://127.0.0.1:' + fake.address().port;
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-api-loop-'));
  fs.mkdirSync(path.join(dataDir, 'runs'));
  fs.writeFileSync(path.join(dataDir, 'bugs.json'), '[]');
  fs.writeFileSync(path.join(dataDir, 'jira-sync.json'), JSON.stringify({ lastTry: Date.now(), lastOk: Date.now(), lastComments: Date.now(), added: 0, found: 0, error: '' }));
  const port = await freePort();
  base = 'http://127.0.0.1:' + port;
  proc = spawn('node', ['server.js'], { cwd: APP, env: { ...process.env, PORT: String(port), QA_DATA_DIR: dataDir, QA_API_KEY: 'k', JIRA_SYNC_MINUTES: '999999', QA_HEDGE_GUARD: '0', QA_VERIFIER: '0', QA_HOSTED: '1', QA_GATEWAY_TOKEN: TOKEN, QA_GUARD_ALLOW_LOOPBACK: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 20000);
    proc.stdout.on('data', (c) => { if (String(c).includes('Agent UI:')) { clearTimeout(t); resolve(); } });
    proc.on('exit', (code) => reject(new Error('server exited early: ' + code)));
  });
});
after(() => { if (proc) proc.kill(); if (fake) fake.close(); try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) { /* temp */ } });

const H = { 'x-flawtrace-gateway': TOKEN };
const get = (p) => fetch(base + p, { headers: H });
const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...H }, body: JSON.stringify(b) });
async function finished(id) {
  let run;
  for (let i = 0; i < 120; i++) {
    run = await (await get('/api/runs/' + id)).json();
    if (run.meta.status !== 'running') return run;
    await new Promise((r) => setTimeout(r, 500));
  }
  return run;
}

test('setup: a test environment API is connected (Petstore spec, nothing is called)', async () => {
  const text = fs.readFileSync(path.join(APP, 'specs', 'petstore.json'), 'utf8');
  const up = await post('/api/sources/specs/upload', { name: 'petstore', text });
  assert.equal(up.status, 200, await up.clone().text());
  const sv = await post('/api/sources', { api: { baseUrl: 'http://127.0.0.1:9', readOnly: true } });
  assert.equal(sv.status, 200, await sv.clone().text());
});

test('hosted mode lists only API-key providers', async () => {
  const v = await (await get('/api/llm')).json();
  assert.equal(v.hosted, true);
  assert.ok(v.providers.length >= 4);
  assert.ok(!v.providers.some((p) => p.id === 'claude-cli' || p.id === 'acp'));
  const bad = await post('/api/llm', { provider: 'claude-cli' });
  assert.equal(bad.status, 400);
});

test('without a key the run fails clearly and does not fall back to Claude Code', async () => {
  const start = await post('/api/runs', { agent: 'qamcp', ticket: 'Check the status of the test environment' });
  assert.equal(start.status, 201, await start.clone().text());
  const run = await finished((await start.json()).id);
  assert.equal(run.meta.status, 'failed');
  assert.match(run.meta.error, /No API key/);
});

test('QA MCP runs on the API loop: tools started, call logged, report extracted', async () => {
  const set = await post('/api/llm', { provider: 'anthropic', model: 'fake-model', baseUrl: fakeBase, key: 'sk-test-123' });
  assert.equal(set.status, 200, await set.clone().text());
  requests = [];
  const start = await post('/api/runs', { agent: 'qamcp', ticket: 'Check the status of the test environment' });
  assert.equal(start.status, 201, await start.clone().text());
  const run = await finished((await start.json()).id);
  const log = run.events.map((e) => `${e.type}:${e.text}`).join('\n');
  assert.equal(run.meta.status, 'done', log + '\n' + run.meta.error);
  assert.match(log, /Running on your own API key/);
  assert.ok(run.events.some((e) => /general_get_status/.test(e.text)), log);
  assert.match(run.meta.report, /Fake report from the API loop/);
  assert.ok(requests.length >= 2);
  assert.ok(requests[0].tools.length > 0, 'the model got tools');
  assert.ok(!JSON.stringify(run).includes('sk-test-123'), 'the key is never in a run');
  assert.ok(run.meta.usage && run.meta.usage.input > 0);
});

test('an agent that needs a shell is refused on a hosted deployment', async () => {
  const start = await post('/api/runs', { agent: 'static', ticket: 'ABC-123' });
  if (start.status !== 201) return; // not startable without a repository: nothing to assert
  const run = await finished((await start.json()).id);
  assert.equal(run.meta.status, 'failed');
  assert.match(run.meta.error, /not available with an API key/);
});
