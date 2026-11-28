// The mutation check of the Python API autotests: preconditions, the .env rewrite, and one real run end to end:
// the benchmark shop, the real mutation proxy and a small pytest suite that reads its address from its .env file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-apimut-'));
process.env.QA_DATA_DIR = data;
const am = require('../lib/api-mutation');
const { build } = require('../eval/build-shop');
test.after(() => fs.rmSync(data, { recursive: true, force: true }));

const lock = { acquire: async () => () => {} };
function run(over = {}) {
  const staging = path.join(data, 'staging-' + Math.random().toString(16).slice(2));
  fs.mkdirSync(path.join(staging, 'tests'), { recursive: true });
  return { meta: { id: 'a' + Math.random().toString(16).slice(2, 8), agent: 'autotest', stack: '', status: 'done', verify: { state: 'passed' }, staging: { dir: staging, state: 'pending' }, files: [{ path: 'tests/test_products.py', status: 'new' }, { path: 'utils/helpers.py', status: 'new' }], ...over }, events: [] };
}
const until = async (f, ms = 120000) => { const end = Date.now() + ms; while (!f() && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); };

test('rewriteEnv points every mention of the environment at the proxy, with and without the scheme', () => {
  const env = 'PLAT_URL=https://test.example.com/api\nHOST=test.example.com\nOTHER=https://elsewhere.example.com\n';
  assert.equal(am.rewriteEnv(env, 'https://test.example.com', 'http://127.0.0.1:5555'), 'PLAT_URL=http://127.0.0.1:5555/api\nHOST=127.0.0.1:5555\nOTHER=https://elsewhere.example.com\n');
  assert.ok(am.isTestFile('tests/api/test_orders.py') && am.isTestFile('a/orders_test.py') && !am.isTestFile('utils/helpers.py'));
});

test('only passed Python autotests with a test file and an environment address can be checked', () => {
  const sources = { read: () => ({ api: { baseUrl: 'http://127.0.0.1:9' } }) };
  const deps = { sources, lock, loadSecrets: async () => ({ ok: true, values: {} }), envFile: '', runner: async () => ({ baseline: { ok: true, endpoints: 0 }, score: null }) };
  assert.throws(() => am.startApiMutation(run({ verify: { state: 'flaky' } }), deps), (e) => e.code === 409);
  assert.throws(() => am.startApiMutation(run({ stack: 'ts-playwright' }), deps), (e) => e.code === 400);
  assert.throws(() => am.startApiMutation(run({ files: [{ path: 'utils/x.py' }] }), deps), /no test file/);
  assert.throws(() => am.startApiMutation(run(), { ...deps, sources: { read: () => ({ api: {} }) } }), /No test environment address/);
});

const HAS_PYTEST = spawnSync('python', ['-m', 'pytest', '--version'], { encoding: 'utf8' }).status === 0;
test('end to end: a suite that asserts the answer kills mutants, its .env is rewritten, the lock is held', { skip: !HAS_PYTEST && 'needs python with pytest' }, async () => {
  const built = build();
  const { server } = require(path.join(built.app, 'server.js'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const shop = 'http://127.0.0.1:' + server.address().port;
  try {
    const r = run();
    // The suite reads its address only from the file in PLAT_ENV_FILE, like the private suite does.
    fs.writeFileSync(path.join(r.meta.staging.dir, 'tests', 'test_products.py'), [
      'import json, os, re, urllib.request',
      'def base():',
      '    text = open(os.environ["PLAT_ENV_FILE"]).read()',
      '    return re.search(r"^SHOP_URL=(.*)$", text, re.M).group(1).strip()',
      'def test_catalogue_page():',
      '    d = json.load(urllib.request.urlopen(base() + "/api/products?pageSize=5"))',
      '    assert d["total"] == 23',
      '    assert d["page"] == 1',
      '    assert len(d["items"]) == 5',
      '',
    ].join('\n'));
    const envFile = path.join(data, 'suite.env');
    fs.writeFileSync(envFile, `SHOP_URL=${shop}\n`);
    let locked = 0, released = 0;
    const deps = { sources: { read: () => ({ api: { baseUrl: shop + '/api' } }) }, envFile, loadSecrets: async () => ({ ok: true, values: {} }),
      lock: { acquire: async () => { locked++; return () => { released++; }; } } };
    process.env.QA_API_MUTANTS = '6';
    am.startApiMutation(r, deps);
    await until(() => r.meta.mutation.state !== 'running');
    const mu = r.meta.mutation;
    assert.equal(mu.state, 'done', mu.error + '\n' + mu.log);
    // The suite checks the counts but never the products themselves: the shorter list is caught, the changed names and
    // prices are not. That is exactly what the check must show the tester.
    assert.ok(mu.killed >= 1, JSON.stringify(mu));
    assert.equal(mu.verdict, 'weak');
    assert.ok(mu.survivors['GET /api/products'].some((x) => /items\[0\]\.name/.test(x)), JSON.stringify(mu.survivors));
    assert.match(fs.readFileSync(path.join(data, 'runs', r.meta.id + '.json'), 'utf8'), /"kind":"api"/, 'persisted');
    const rewritten = fs.readFileSync(path.join(data, 'runs', 'work', r.meta.id, 'mutation.env'), 'utf8');
    assert.doesNotMatch(rewritten, new RegExp(shop.replace(/[.:/]/g, '\\$&')), 'the suite never talks to the shop directly');
    assert.deepEqual([locked, released], [1, 1]);
  } finally {
    delete process.env.QA_API_MUTANTS;
    server.close();
    fs.rmSync(built.outDir, { recursive: true, force: true });
  }
});
