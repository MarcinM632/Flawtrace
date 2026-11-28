// The mutation check of a generated UI test, started from the app: preconditions, result, verdict, and that the
// real proxy is given the page origin and the project folder. The Playwright run itself is replaced by a stub runner.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-mut-'));
process.env.QA_DATA_DIR = data;
const um = require('../lib/ui-mutation');
test.after(() => fs.rmSync(data, { recursive: true, force: true }));

function run(over = {}) {
  const staging = path.join(data, 'work', 'r1', 'staging');
  const tsRun = path.join(data, 'work', 'r1', 'ts-run');
  fs.mkdirSync(path.join(tsRun, 'node_modules'), { recursive: true });
  fs.mkdirSync(staging, { recursive: true });
  return { meta: { id: 'r1', agent: 'autotest', stack: 'ts-playwright', status: 'done', url: 'http://127.0.0.1:4400/#/cart', staging: { dir: staging, state: 'pending' }, testRun: { state: 'passed' }, ...over }, events: [] };
}
const until = async (f) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 10)); };

test('only a passing, installed ts-playwright project can be checked', () => {
  assert.throws(() => um.startMutation(run({ testRun: { state: 'failed' } }), {}), (e) => e.code === 409);
  assert.throws(() => um.startMutation(run({ stack: 'pytest' }), {}), (e) => e.code === 400);
  const r = run();
  fs.rmSync(path.join(data, 'work', 'r1', 'ts-run', 'node_modules'), { recursive: true });
  assert.throws(() => um.startMutation(r, {}), /not installed/);
});

test('the proxy gets the page origin, BASE_URL and the project folder; the result and verdict land on the run', async () => {
  const r = run();
  let got = null;
  const runner = async (o) => {
    got = o;
    o.log('baseline passed, 2 endpoint(s) seen, 3 mutant(s)');
    o.log('M1 killed      GET /api/cart total: 214 → 215');
    return { baseline: { ok: true, endpoints: 2 }, score: 33.3, killed: 1, survived: 2, notReached: 0, survivors: { 'GET /api/cart': ['discount: 20 → 21', 'codes: list of 1 → 0'] } };
  };
  const mu = um.startMutation(r, { username: 'demo', password: 'pw' }, { runner, max: 3 });
  assert.strictEqual(mu.state, 'running');
  assert.throws(() => um.startMutation(r, {}, { runner }), /already running/);
  await until(() => r.meta.mutation.state !== 'running');
  assert.strictEqual(got.target, 'http://127.0.0.1:4400');
  assert.strictEqual(got.envVar, 'BASE_URL');
  assert.strictEqual(got.cwd, path.join(data, 'work', 'r1', 'ts-run'));
  assert.match(got.cmd, /flawtrace-mutation\.config\.ts/);
  assert.strictEqual(got.env.E2E_PASSWORD, 'pw');
  assert.ok(fs.existsSync(path.join(got.cwd, 'flawtrace-mutation.config.ts')));
  const m = r.meta.mutation;
  assert.deepStrictEqual([m.state, m.verdict, m.score, m.total, m.done], ['done', 'weak', 33.3, 3, 1]);
  assert.deepStrictEqual(m.survivors['GET /api/cart'].length, 2);
  assert.ok(fs.existsSync(path.join(data, 'runs', 'r1.json')), 'persisted');
});

test('a red baseline is an error, no mutant reached is "none", and a restart ends a running check', async () => {
  const r = run();
  um.startMutation(r, {}, { runner: async () => ({ baseline: { ok: false }, error: 'The suite fails without any mutant' }) });
  await until(() => r.meta.mutation.state !== 'running');
  assert.deepStrictEqual([r.meta.mutation.state, r.meta.mutation.error], ['error', 'The suite fails without any mutant']);
  const r2 = run();
  um.startMutation(r2, {}, { runner: async () => ({ baseline: { ok: true, endpoints: 0 }, score: null, killed: 0, survived: 0, notReached: 0, survivors: {} }) });
  await until(() => r2.meta.mutation.state !== 'running');
  assert.strictEqual(r2.meta.mutation.verdict, 'none');
  assert.match(r2.meta.mutation.error, /BASE_URL/);
  const stale = { id: 'gone', mutation: { state: 'running' } };
  um.reconcile(stale);
  assert.strictEqual(stale.mutation.state, 'error');
  assert.strictEqual(um.verdictOf({ score: 75 }), 'strong');
});
