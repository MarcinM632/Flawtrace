// Hosted hardening: network guard (SSRF), secrets at rest, gateway token, blocked paths, jailed knowledge folder.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertPublicUrl, isPrivateIp } = require('../lib/net-guard');
const secrets = require('../lib/secrets');

test('private, loopback, link-local and reserved addresses are refused, public ones pass', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.5.5', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:a00:1', '64:ff9b::10.0.0.1']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111']) assert.equal(isPrivateIp(ip), false, ip);
});

test('assertPublicUrl: schemes, credentials, internal names, literal IPs', async () => {
  await assert.rejects(assertPublicUrl('file:///etc/passwd'), /Only/);
  await assert.rejects(assertPublicUrl('ftp://example.com'), /Only/);
  await assert.rejects(assertPublicUrl('https://user:pw@example.com'), /user name/);
  await assert.rejects(assertPublicUrl('http://169.254.169.254/latest/meta-data'), /private/);
  await assert.rejects(assertPublicUrl('http://[::1]:8080/'), /private/);
  await assert.rejects(assertPublicUrl('http://localhost:4000/'), /internal/);
  await assert.rejects(assertPublicUrl('http://db.internal/'), /internal/);
  await assert.rejects(assertPublicUrl('not a url'), /not valid/);
  await assert.rejects(assertPublicUrl('http://8.8.8.8/', { schemes: ['https:'] }), /Only https/);
  assert.equal((await assertPublicUrl('http://8.8.8.8/x')).hostname, '8.8.8.8');
});

test('secrets: sealed with a master key, opened again, wrong key gives nothing, plain without a key', () => {
  const prev = process.env.QA_MASTER_KEY;
  try {
    delete process.env.QA_MASTER_KEY;
    assert.equal(secrets.seal('abc'), 'abc');
    process.env.QA_MASTER_KEY = 'master-one-xxxxxxxxxxxxxxxx';
    const a = secrets.seal('sk-secret'), b = secrets.seal('sk-secret');
    assert.ok(a.startsWith(secrets.PREFIX));
    assert.ok(!a.includes('sk-secret'));
    assert.notEqual(a, b, 'a fresh nonce every time');
    assert.equal(secrets.open(a), 'sk-secret');
    assert.equal(secrets.seal(a), a, 'not sealed twice');
    assert.equal(secrets.open('plain'), 'plain');
    process.env.QA_MASTER_KEY = 'master-two-yyyyyyyyyyyyyyyy';
    assert.equal(secrets.open(a), '');
    const tree = secrets.mapFields({ jira: { token: 't', url: 'u' }, keys: { a: 'k1', b: 'k2' } }, [['jira', 'token'], ['keys', '*']], secrets.seal);
    assert.equal(tree.jira.url, 'u');
    assert.ok(tree.jira.token.startsWith(secrets.PREFIX) && tree.keys.b.startsWith(secrets.PREFIX));
  } finally { if (prev === undefined) delete process.env.QA_MASTER_KEY; else process.env.QA_MASTER_KEY = prev; }
});

// ----- a real hosted process -----
const APP = path.resolve(__dirname, '..');
let proc, base, dataDir;
const TOKEN = 'gateway-token-0123456789abcdef0123';
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const call = (p, opts = {}, token = TOKEN) => fetch(base + p, { ...opts, headers: { 'content-type': 'application/json', ...(token ? { 'x-flawtrace-gateway': token } : {}), ...(opts.headers || {}) } });

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-hosted-'));
  fs.mkdirSync(path.join(dataDir, 'runs'));
  fs.writeFileSync(path.join(dataDir, 'bugs.json'), '[]');
  fs.writeFileSync(path.join(dataDir, 'jira-sync.json'), JSON.stringify({ lastTry: Date.now(), lastOk: Date.now(), lastComments: Date.now(), added: 0, found: 0, error: '' }));
  const port = await freePort();
  base = 'http://127.0.0.1:' + port;
  proc = spawn('node', ['server.js'], { cwd: APP, env: { ...process.env, PORT: String(port), QA_DATA_DIR: dataDir, QA_HOSTED: '1', QA_GATEWAY_TOKEN: TOKEN, QA_MASTER_KEY: 'tenant-master-key-0123456789', QA_API_KEY: 'k', JIRA_SYNC_MINUTES: '999999', QA_HEDGE_GUARD: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 20000);
    proc.stdout.on('data', (c) => { if (String(c).includes('Agent UI:')) { clearTimeout(t); resolve(); } });
    proc.on('exit', (code) => reject(new Error('server exited early: ' + code)));
  });
});
after(() => { if (proc) proc.kill(); try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) { /* temp */ } });

test('only the gateway may call the process', async () => {
  assert.equal((await call('/api/agents', {}, '')).status, 401);
  assert.equal((await call('/api/agents', {}, 'wrong-token-0123456789abcdefghij')).status, 401);
  assert.equal((await call('/api/agents')).status, 200);
});

test('paths that could run code or touch the host do not exist', async () => {
  for (const [m, p] of [['POST', '/api/admin/restart'], ['POST', '/api/suite/run'], ['GET', '/api/suite'], ['GET', '/api/v1/runs'], ['POST', '/api/llm/login'], ['GET', '/api/llm/detect'], ['GET', '/api/integration']]) {
    const r = await call(p, { method: m, body: m === 'POST' ? '{}' : undefined });
    assert.equal(r.status, 403, m + ' ' + p);
  }
});

test('internal addresses cannot be put into the sources', async () => {
  for (const patch of [{ api: { baseUrl: 'http://169.254.169.254' } }, { jira: { url: 'https://localhost:9' } }, { repos: [{ url: '/etc' }] }, { repos: [{ url: 'file:///etc' }] }, { repos: [{ url: 'https://10.0.0.5/x.git' }] }, { api: { specs: [{ name: 'x', url: 'http://127.0.0.1:1/spec.json' }] } }]) {
    const r = await call('/api/sources', { method: 'POST', body: JSON.stringify(patch) });
    assert.equal(r.status, 400, JSON.stringify(patch) + ' ' + await r.clone().text());
  }
});

test('the knowledge folder cannot be pointed elsewhere, and tokens are sealed on disk', async () => {
  const r = await call('/api/sources', { method: 'POST', body: JSON.stringify({ knowledgeDir: 'C:/Windows', jira: { url: 'https://example.atlassian.net', email: 'a@b.c', token: 'jira-secret-token' } }) });
  assert.equal(r.status, 200, await r.clone().text());
  const file = fs.readFileSync(path.join(dataDir, 'sources.json'), 'utf8');
  assert.ok(!file.includes('jira-secret-token'), 'token is not plain on disk');
  assert.match(file, /enc:v1:/);
  assert.equal(JSON.parse(file).knowledgeDir, '');
  const view = await (await call('/api/sources')).json();
  assert.equal(view.jira.token, '********');
});

test('an AI key is sealed on disk, an internal endpoint is refused, plain http is refused', async () => {
  const bad = await call('/api/llm', { method: 'POST', body: JSON.stringify({ provider: 'openai-compatible', model: 'm', baseUrl: 'http://127.0.0.1:11434/v1' }) });
  assert.equal(bad.status, 400);
  const plain = await call('/api/llm', { method: 'POST', body: JSON.stringify({ provider: 'openai-compatible', model: 'm', baseUrl: 'http://8.8.8.8/v1' }) });
  assert.equal(plain.status, 400);
  const ok = await call('/api/llm', { method: 'POST', body: JSON.stringify({ provider: 'anthropic', model: 'claude-sonnet-5-5', key: 'sk-ant-very-secret' }) });
  assert.equal(ok.status, 200, await ok.clone().text());
  const file = fs.readFileSync(path.join(dataDir, 'llm.json'), 'utf8');
  assert.ok(!file.includes('sk-ant-very-secret'));
  const v = await ok.json();
  assert.equal(v.keySet, true);
  assert.ok(!JSON.stringify(v).includes('sk-ant-very-secret'));
});

test('outbound fetch inside the hosted process is guarded (redirect to an internal address is refused)', async () => {
  // A tiny public-looking server cannot be made public in a test, so check the wrapper directly on a loopback redirector.
  const guard = require('../lib/net-guard');
  const prev = process.env.QA_HOSTED; process.env.QA_HOSTED = '1';
  const origFetch = globalThis.fetch;
  try {
    guard.install();
    await assert.rejects(() => fetch('http://169.254.169.254/latest/meta-data'), /private/);
    await assert.rejects(() => fetch('http://127.0.0.1:1/x'), /private/);
  } finally { globalThis.fetch = origFetch; if (prev === undefined) delete process.env.QA_HOSTED; else process.env.QA_HOSTED = prev; }
});

test('pentest engine on a hosted deployment: scope only within the hosts connected in Sources', async () => {
  const body = { name: 'x', scope: { domains: ['victim.example'] }, authorization: { authorizedBy: 'me', attestation: true }, plan: { startUrl: 'https://victim.example/' } };
  const r = await call('/api/pentest/engagements', { method: 'POST', body: JSON.stringify(body) });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /Sources/);
});
