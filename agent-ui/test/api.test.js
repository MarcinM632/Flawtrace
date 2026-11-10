// Testy kontraktowe API. Startują OSOBNĄ instancję serwera na wolnym porcie, z odizolowanym katalogiem danych (QA_DATA_DIR),
// i nie wołają modelu, więc nic nie kosztują ani nie dotykają prawdziwych runów i rejestru błędów.
//   node --test test/            (z katalogu agent-ui)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP = path.resolve(__dirname, '..');
let proc, base, dataDir;

function freePort() {
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}
const get = (p, opt) => fetch(base + p, opt);
const j = async (p, opt) => { const r = await get(p, opt); return { status: r.status, body: await r.json().catch(() => null), headers: r.headers }; };
const send = (method, p, body) => j(p, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-ui-test-'));
  fs.mkdirSync(path.join(dataDir, 'runs'));
  const run = {
    meta: { id: '20260101000000-aaaa', agent: 'qamcp', label: 'QA MCP', ticket: 'Fixture run', notes: '', folder: '', source: '', brief: '', status: 'done',
      startedAt: 1767225600000, finishedAt: 1767225660000, report: 'REPORT BODY', reportStatus: 'SUKCES', finalText: 'FINAL', costUsd: 0.12, error: null },
    events: [{ type: 'status', text: 'Start', t: 1 }, { type: 'endpoint', who: 'main', text: 'general_get_status', t: 2 }, { type: 'end', status: 'done', t: 3 }],
  };
  fs.writeFileSync(path.join(dataDir, 'runs', run.meta.id + '.json'), JSON.stringify(run));
  fs.writeFileSync(path.join(dataDir, 'bugs.json'), '[]');
  // lastTry = teraz, żeby GET /api/bugs nie odpalił płatnej synchronizacji z Jirą
  fs.writeFileSync(path.join(dataDir, 'jira-sync.json'), JSON.stringify({ lastTry: Date.now(), lastOk: Date.now(), lastComments: Date.now(), added: 0, found: 0, error: '' }));
  const port = await freePort();
  base = 'http://127.0.0.1:' + port;
  proc = spawn('node', ['server.js'], { cwd: APP, env: { ...process.env, PORT: String(port), QA_DATA_DIR: dataDir, JIRA_SYNC_MINUTES: '999999', QA_HEDGE_GUARD: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 20000);
    proc.stdout.on('data', (c) => { if (String(c).includes('Agent UI:')) { clearTimeout(t); resolve(); } });
    proc.on('exit', (code) => reject(new Error('server exited early: ' + code)));
  });
});

after(() => { if (proc) proc.kill(); try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) { /* tymczasowe */ } });

test('static files are served, with ETag revalidation and without path traversal', async () => {
  for (const p of ['/', '/index.html', '/app.css', '/js/01-core.js', '/js/10-main.js']) {
    const r = await get(p); assert.equal(r.status, 200, p); await r.arrayBuffer();
  }
  const r = await get('/app.css'); const etag = r.headers.get('etag'); await r.arrayBuffer();
  assert.ok(etag);
  assert.equal((await get('/app.css', { headers: { 'if-none-match': etag } })).status, 304);
  for (const p of ['/../server.js', '/js/..%2f..%2fserver.js', '/nonexistent.js', '/server.js', '/tool-groups.json']) {
    assert.equal((await get(p)).status, 404, p);
  }
  const html = await (await get('/')).text();
  assert.match(html, /<link rel="stylesheet" href="\/app\.css">/);
  const scripts = [...html.matchAll(/<script src="(\/js\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 10 && scripts.at(-1) === '/js/10-main.js', 'main.js must load last');
  for (const s of scripts) assert.equal((await get(s)).status, 200, s);
});

test('/api/agents lists every app with its fields', async () => {
  const { status, body } = await j('/api/agents');
  assert.equal(status, 200);
  const keys = body.map((a) => a.key);
  for (const k of ['core', 'svc', 'mcp', 'design', 'qamcp', 'autotest']) assert.ok(keys.includes(k), k);
  for (const a of body) for (const f of ['label', 'hint', 'mode', 'freeform', 'services', 'dir', 'available']) assert.ok(f in a, a.key + '.' + f);
  assert.equal(body.find((a) => a.key === 'qamcp').mode, 'qamcp');
  assert.equal(body.find((a) => a.key === 'autotest').available, true);
});

test('/api/plat-status and /api/autotest-meta describe the environment and the repo', async () => {
  const s = await j('/api/plat-status');
  assert.equal(s.status, 200); assert.ok('environment' in s.body && Array.isArray(s.body.hosts));
  const m = await j('/api/autotest-meta');
  assert.equal(m.body.available, true); assert.ok(m.body.folders.includes('smoke')); assert.ok(m.body.tests >= 1);
});

test('/api/autotest-meta splits pytest areas from Playwright areas under tests/ui/', async () => {
  const m = (await j('/api/autotest-meta')).body;
  assert.ok(!m.folders.includes('ui'), 'tests/ui is not offered as a pytest area');
  assert.ok(m.ui.folders.includes('ui/prj_risk')); assert.ok(m.ui.tests >= 1);
});

test('POST /api/runs: a pytest autotest cannot be written into tests/ui/', async () => {
  const r = await send('POST', '/api/runs', { agent: 'autotest', layer: 'api', ticket: 'Balance is reported for an existing account', folder: 'ui/prj_risk' });
  assert.equal(r.status, 400); assert.match(r.body.error, /Playwright/);
});

test('/api/runs: slim list, ETag, full on request; detail and 404', async () => {
  const list = await j('/api/runs');
  assert.equal(list.status, 200);
  const r = list.body.find((x) => x.id === '20260101000000-aaaa');
  assert.ok(r);
  assert.deepEqual(Object.keys(r).sort(), ['agent', 'costUsd', 'finishedAt', 'id', 'label', 'startedAt', 'status', 'ticket']);
  const etag = list.headers.get('etag');
  assert.equal((await get('/api/runs', { headers: { 'if-none-match': etag } })).status, 304);
  const full = await j('/api/runs?full=1');
  assert.equal(full.body.find((x) => x.id === r.id).report, 'REPORT BODY');
  const d = await j('/api/runs/' + r.id);
  assert.equal(d.body.meta.report, 'REPORT BODY'); assert.equal(d.body.events.length, 3);
  assert.equal((await j('/api/runs/nope')).status, 404);
  assert.equal((await send('POST', '/api/runs/nope/cancel', {})).status, 404);
});

test('POST /api/runs validates before any model is called', async () => {
  assert.equal((await send('POST', '/api/runs', { agent: 'nonexistent', ticket: 'x' })).status, 400);
  const short = await send('POST', '/api/runs', { agent: 'qamcp', ticket: 'x' });
  assert.equal(short.status, 400);
  const bad = await send('POST', '/api/runs', { agent: 'core', ticket: '' });
  assert.equal(bad.status, 400);
});

test('bug registry: add, correct, list, never delete', async () => {
  const empty = await j('/api/bugs');
  assert.equal(empty.status, 200); assert.deepEqual(empty.body.bugs, []); assert.deepEqual(empty.body.severities, ['krytyczny', 'wazny', 'drobny']);
  assert.equal((await send('POST', '/api/bugs', { agent: 'zzz', service: 's', title: 't' })).status, 400);
  assert.equal((await send('POST', '/api/bugs', { agent: 'core', service: '', title: 't' })).status, 400);
  assert.equal((await send('POST', '/api/bugs', { agent: 'core', service: 's', title: '' })).status, 400);
  const add = await send('POST', '/api/bugs', { agent: 'core', service: 'core-hedger', title: 'Fixture bug', ticket: 'prj-1', severity: 'krytyczny', notes: 'n' });
  assert.equal(add.status, 201); assert.equal(add.body.ticket, 'PRJ-1'); assert.equal(add.body.severity, 'krytyczny');
  const patch = await send('PATCH', '/api/bugs/' + add.body.id, { severity: 'drobny', notes: 'changed' });
  assert.equal(patch.body.severity, 'drobny'); assert.equal(patch.body.notes, 'changed');
  assert.equal((await send('PATCH', '/api/bugs/doesnotexist', {})).status, 404);
  assert.equal((await send('DELETE', '/api/bugs/' + add.body.id, {})).status, 405);
  const after = await j('/api/bugs');
  assert.equal(after.body.bugs.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'bugs.json'), 'utf8')).length, 1, 'persisted to the isolated data dir');
});

test('/api/jobs and the prompt engineer validate input', async () => {
  assert.deepEqual((await j('/api/jobs')).body, []);
  assert.equal((await send('POST', '/api/prompt-engineer', { target: 'nope', text: 'x' })).status, 400);
});

test('test suite: list, validation, history, file read and write guard', async () => {
  const s = await j('/api/suite');
  assert.equal(s.status, 200); assert.equal(s.body.error, null);
  assert.ok(s.body.tests.length >= 5);
  for (const t of s.body.tests.slice(0, 5)) { assert.ok(t.id.startsWith('tests/')); assert.ok(Array.isArray(t.markers)); assert.ok(t.name); }
  assert.ok(s.body.tests.some((t) => t.markers.includes('SMOKE')));
  assert.equal((await send('POST', '/api/suite/run', { targets: [] })).status, 400);
  assert.equal((await send('POST', '/api/suite/run', { targets: ['../etc/passwd'] })).status, 400);
  assert.equal((await send('POST', '/api/suite/run', { targets: ['tests/../utils/config.py'] })).status, 400);
  assert.equal((await send('POST', '/api/suite/run', { targets: ['-k', 'x'] })).status, 400);
  assert.equal((await send('POST', '/api/suite/cancel', {})).status, 404);
  assert.deepEqual((await j('/api/suite/history')).body, []);
  assert.equal((await j('/api/suite/history/none')).status, 404);
  const f = await j('/api/suite/file?path=utils/config.py');
  assert.equal(f.status, 200); assert.match(f.body.content, /PLAT_ENV_FILE/);
  for (const bad of ['../mcp-server/.env', 'conftest.py', 'utils/../../x.py', 'tests/x.txt']) assert.equal((await j('/api/suite/file?path=' + encodeURIComponent(bad))).status, 400, bad);
  assert.equal((await send('PUT', '/api/suite/file', { path: '../x.py', content: '' })).status, 400);
  assert.equal((await send('PUT', '/api/suite/file', { path: 'tests/smoke/missing_file.py', content: 'x' })).status, 404);
});

test('autotest staging endpoints refuse unknown or non-pending runs', async () => {
  assert.equal((await send('POST', '/api/runs/nope/autotests/save', {})).status, 404);
  assert.equal((await send('POST', '/api/runs/nope/autotests/discard', {})).status, 404);
  const r = await send('POST', '/api/runs/20260101000000-aaaa/autotests/save', {});
  assert.equal(r.status, 409); // run bez poczekalni
});

test('unknown routes are 404 JSON', async () => {
  const r = await j('/api/does-not-exist');
  assert.equal(r.status, 404); assert.equal(r.body.error, 'Not found');
});
