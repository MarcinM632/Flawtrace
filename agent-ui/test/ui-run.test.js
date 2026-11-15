const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ur = require('../lib/ui-run');

const JSON_REPORT = {
  stats: { expected: 2, unexpected: 1, flaky: 0, skipped: 0 },
  suites: [{ file: 'a.spec.ts', specs: [{ title: 'logs in', file: 'a.spec.ts', tests: [{ projectName: 'chromium', status: 'expected', results: [{ duration: 1200 }] }] }],
    suites: [{ title: 'nested', file: 'a.spec.ts', specs: [{ title: 'logs out', tests: [{ status: 'unexpected', results: [{ duration: 500 }, { duration: 700, error: { message: '\x1b[31mExpected: visible\x1b[39m\nReceived: hidden' } }] }] }] }] }],
};

test('parseResults: counts, one row per test, the last attempt error without colour codes', () => {
  const p = ur.parseResults(JSON_REPORT);
  assert.deepStrictEqual(p.stats, { passed: 2, failed: 1, flaky: 0, skipped: 0, total: 2 });
  assert.deepStrictEqual(p.tests.map((t) => [t.title, t.status, t.ms]), [['logs in', 'expected', 1200], ['logs out', 'unexpected', 1200]]);
  assert.match(p.tests[1].error, /^Expected: visible\nReceived: hidden$/);
  assert.deepStrictEqual(ur.parseResults(null).stats.total, 0);
});

test('testEnv gives the tests the page origin and the login, drops CI, and does not touch other variables', () => {
  const env = ur.testEnv({ url: 'https://t.example.com/login?x=1' }, { username: 'anna', password: 'pw' }, { PATH: 'p', CI: '1' });
  assert.strictEqual(env.BASE_URL, 'https://t.example.com');
  assert.strictEqual(env.E2E_USERNAME, 'anna');
  assert.strictEqual(env.E2E_PASSWORD, 'pw');
  assert.strictEqual(env.PATH, 'p');
  assert.ok(!('CI' in env));
  assert.ok(!('E2E_PASSWORD' in ur.testEnv({ url: 'https://t.example.com' }, { username: '', password: '' }, {})));
});

test('the run config keeps the base config and turns on screenshots, video and trace without retries', () => {
  assert.match(ur.CONFIG_SOURCE, /import base from '\.\/playwright\.config'/);
  for (const s of ["screenshot: 'on'", "video: 'on'", "trace: 'on'", 'retries: 0', 'timeout: 20000', 'actionTimeout: 8000', "'html'"]) assert.ok(ur.CONFIG_SOURCE.includes(s), s);
});

function reportFixture() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'uirun-'));
  const staging = path.join(work, 'autotests'); fs.mkdirSync(staging);
  const rep = path.join(work, 'ts-run', 'flawtrace-report'); fs.mkdirSync(path.join(rep, 'data'), { recursive: true });
  fs.writeFileSync(path.join(rep, 'index.html'), '<html></html>');
  fs.writeFileSync(path.join(rep, 'data', 'v.webm'), '0123456789');
  fs.writeFileSync(path.join(work, 'secret.txt'), 'nope');
  return { meta: { staging: { dir: staging } }, work };
}

test('reportFile serves the report folder only: index by default, no ../ escape, no missing files', () => {
  const { meta, work } = reportFixture();
  assert.ok(ur.reportFile(meta, '/').endsWith('index.html'));
  assert.ok(ur.reportFile(meta, '/data/v.webm').endsWith('v.webm'));
  assert.strictEqual(ur.reportFile(meta, '/../../secret.txt'), '');
  assert.strictEqual(ur.reportFile(meta, '/%2e%2e/%2e%2e/secret.txt'), '');
  assert.strictEqual(ur.reportFile(meta, '/nope.html'), '');
  assert.strictEqual(ur.reportFile({}, '/'), '');
  fs.rmSync(work, { recursive: true, force: true });
});

const { PassThrough } = require('stream');
function fakeRes() {
  const r = new PassThrough();
  r.writeHead = function (c, h) { this.head = [c, h]; };
  r.body = new Promise((resolve) => { const parts = []; r.on('data', (c) => parts.push(c)); r.on('end', () => resolve(Buffer.concat(parts).toString())); });
  return r;
}

test('serveReport answers a Range request with 206 and the right bytes so a video can be seeked', async () => {
  const { meta, work } = reportFixture();
  const res = fakeRes();
  assert.ok(ur.serveReport({ headers: { range: 'bytes=2-5' } }, res, meta, '/data/v.webm'));
  assert.strictEqual(res.head[0], 206);
  assert.strictEqual(res.head[1]['Content-Range'], 'bytes 2-5/10');
  assert.strictEqual(res.head[1]['Content-Length'], 4);
  assert.strictEqual(await res.body, '2345');
  const full = fakeRes();
  ur.serveReport({ headers: {} }, full, meta, '/data/v.webm');
  assert.strictEqual(full.head[0], 200);
  assert.strictEqual(await full.body, '0123456789');
  const bad = fakeRes();
  ur.serveReport({ headers: { range: 'bytes=50-60' } }, bad, meta, '/data/v.webm');
  assert.strictEqual(bad.head[0], 416);
  bad.end();
  assert.strictEqual(ur.serveReport({ headers: {} }, fakeRes(), meta, '/../secret.txt'), false);
  fs.rmSync(work, { recursive: true, force: true });
});

test('reconcile: a run saved as busy by a server that restarted is shown as interrupted', () => {
  const meta = { id: 'x1', testRun: { state: 'running', startedAt: 1, finishedAt: null } };
  ur.reconcile(meta);
  assert.strictEqual(meta.testRun.state, 'error');
  assert.match(meta.testRun.error, /restarted/);
  const done = { id: 'x2', testRun: { state: 'passed' } };
  ur.reconcile(done);
  assert.strictEqual(done.testRun.state, 'passed');
});

test('startTestRun refuses what cannot be run, with the right status code', () => {
  const run = (meta) => { try { ur.startTestRun({ meta }, {}); return null; } catch (e) { return e.code; } };
  assert.strictEqual(run({ id: 'a', agent: 'qamcp' }), 400);
  assert.strictEqual(run({ id: 'a', agent: 'autotest', stack: 'ts-playwright', status: 'running' }), 409);
  assert.strictEqual(run({ id: 'a', agent: 'autotest', stack: 'ts-playwright', status: 'done', staging: { dir: path.join(os.tmpdir(), 'no-such-dir-xyz') }, url: 'https://t.example.com' }), 410);
});
