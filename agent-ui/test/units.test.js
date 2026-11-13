// Testy jednostkowe logiki, której nie obejmuje test API (bo wymaga modelu albo repo autotestów): zakres narzędzi, pętla weryfikacji
// z atrapą bramki, poczekalnia. Pracują na KOPII repo autotestów (QA_AUTOTEST_REPO), więc prawdziwe autotests/ jest nietknięte.
//   node --test test/units.test.js
const { test, before, after } = require('node:test');
// The public copy of autotests/ has no test files, HTTP client or environment config (see autotests/README.md),
// so tests that need the real suite are skipped there. They run where tests/smoke exists.
const NO_PRIVATE_TESTS = !require('fs').existsSync(require('path').join(__dirname, '..', '..', 'autotests', 'tests', 'smoke'))
  && 'needs the private autotests/ suite';
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-ui-units-'));
const repoCopy = path.join(tmp, 'autotests');
const real = path.resolve(__dirname, '..', '..', 'autotests');
fs.cpSync(real, repoCopy, { recursive: true, filter: (s) => !['__pycache__', '.pytest_cache'].includes(path.basename(s)) });
process.env.QA_AUTOTEST_REPO = repoCopy;
process.env.QA_DATA_DIR = path.join(tmp, 'data');
process.env.QA_HEDGE_GUARD = '0'; // strażnik reguły AUTOTEST łączy się z prawdziwym środowiskiem
process.env.PLAT_MANAGER_TOKEN = process.env.PLAT_MANAGER_TOKEN || 'unit-test-token';

const scope = require('../lib/scope');
const repo = require('../lib/autotest-repo');
const { AUTOTEST_REPO, RUNS_DIR } = require('../lib/config');

let mock;
before(async () => {
  mock = http.createServer((q, s) => {
    s.setHeader('content-type', 'application/json');
    if (q.method === 'POST' && q.url === '/v1/sessions') return s.end(JSON.stringify({ sessionToken: 'abc' }));
    if (q.url === '/v1/ping') return s.end(JSON.stringify({ ok: true }));
    s.statusCode = 404; s.end('{}');
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  process.env.PLAT_MANAGER_BASE_URL = 'http://127.0.0.1:' + mock.address().port;
});
after(() => { mock.close(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* tymczasowe */ } });

test('the app is pointed at the copy, never at the real autotests/', () => {
  assert.equal(AUTOTEST_REPO, repoCopy);
  assert.notEqual(path.resolve(AUTOTEST_REPO), real);
});

// ---------------------------------------------------------------- scope
test('scopeFor: without a tool group map every run gets the whole API', () => {
  const s = scope.scopeFor('Open an order and check the balance', 'auto');
  assert.equal(s.mode, 'all'); assert.equal(s.groups, null);
});

test('built-in tool sets and run time limits per mode', () => {
  assert.deepEqual(scope.BUILTIN_TOOLS.qamcp, ['ToolSearch']);
  for (const t of ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'ToolSearch']) assert.ok(scope.BUILTIN_TOOLS.autotest.includes(t), t);
  assert.ok(!scope.BUILTIN_TOOLS.autotest.includes('Bash'), 'Autotests must not get a shell');
  for (const t of ['Bash', 'Agent', 'ToolSearch']) assert.ok(scope.BUILTIN_TOOLS.qa.includes(t), t);
  assert.deepEqual(scope.BUILTIN_TOOLS.design, scope.BUILTIN_TOOLS.qa);
  assert.equal(scope.runLimitMs('design'), 60 * 60000);
  assert.equal(scope.runLimitMs('qamcp'), 30 * 60000);
  assert.equal(scope.runLimitMs('autotest'), 20 * 60000);
  assert.equal(scope.runLimitMs(undefined), 45 * 60000);
});

test('addUsage accumulates tokens and turns across passes', () => {
  const meta = {};
  scope.addUsage(meta, null);
  assert.equal(meta.usage, undefined);
  scope.addUsage(meta, { usage: { input_tokens: 3, output_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000 }, turns: 2 });
  scope.addUsage(meta, { usage: { input_tokens: 1, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 500 }, turns: 3 });
  assert.deepEqual(meta.usage, { input: 4, output: 15, cacheCreate: 100, cacheRead: 1500, turns: 5 });
});

test('redact removes credential values but leaves short or empty ones alone', () => {
  assert.equal(repo.redact('token=SECRET-VALUE-123 ok', { A: 'SECRET-VALUE-123' }), 'token=*** ok');
  assert.equal(repo.redact('abc', { A: 'abc', B: '' }), 'abc');
  assert.equal(repo.redact(null, {}), '');
});

// ---------------------------------------------------------------- verification loop + staging
const BAD = `from utils.imports import *
from utils.http import get, MANAGER


@pytest.mark.MANAGER
def test_ping_is_served(request):
    scenario = """GIVEN a gateway
        WHEN ping is read
        THEN it says ok"""
    add_scenario_to_report(request, scenario)
    body = get(MANAGER, "/v1/pingg")
    assert body["ok"] is True, "ping not ok"
`;
const GOOD = BAD.replace('/v1/pingg', '/v1/ping');

function newRun(name) {
  const dir = path.join(tmp, 'work', name, 'autotests');
  repo.stageRepo(dir);
  const r = { meta: { id: name, status: 'running', staging: { dir, state: 'pending', base: repo.hashTree(dir) } }, events: [], listeners: new Set(), proc: null, repoDir: dir };
  const before = repo.snapTests(dir);
  fs.mkdirSync(path.join(dir, 'tests', '_unit'), { recursive: true });
  const file = path.join(dir, 'tests', '_unit', 'test_ping.py');
  return { r, before, file, dir };
}

test('staging: copy has no caches and the real repo stays untouched until Save', async () => {
  const { dir, file } = newRun('stage-1');
  assert.ok(!fs.existsSync(path.join(dir, 'tests', 'smoke', '__pycache__')));
  fs.writeFileSync(file, GOOD);
  assert.ok(!fs.existsSync(path.join(AUTOTEST_REPO, 'tests', '_unit')), 'nothing leaks into the repo');
});

test('verify: a failing test is sent to the agent, fixed, and must pass twice', { skip: NO_PRIVATE_TESTS }, async () => {
  const { r, before, file } = newRun('verify-fix');
  fs.writeFileSync(file, BAD);
  let calls = 0; let promptSeen = '';
  const v = await repo.verifyAutotests(r, before, async (prompt) => {
    calls++; promptSeen = prompt;
    fs.writeFileSync(file, GOOD);
    return { finalText: 'ROZSTRZYGNIĘCIE: NAPRAWIONO\n--- TREŚĆ ---\nzła ścieżka', cost: 0.01 };
  });
  assert.equal(v.state, 'passed'); assert.equal(v.rounds, 1); assert.equal(calls, 1);
  assert.match(promptSeen, /404/, 'the agent receives the real pytest output');
  assert.equal(v.attempts.length, 4, 'fail, unchanged re-run, fixed re-run, full repeat'); assert.equal(v.attempts[1].repeat, true); assert.equal(v.attempts[3].repeat, true);
  assert.ok(!JSON.stringify(v).includes(process.env.PLAT_MANAGER_TOKEN) || process.env.PLAT_MANAGER_TOKEN.length < 4);
});

test('verify: an agent that blames the environment and changes nothing yields "defect"', { skip: NO_PRIVATE_TESTS }, async () => {
  const { r, before, file } = newRun('verify-defect');
  fs.writeFileSync(file, BAD);
  const v = await repo.verifyAutotests(r, before, async () => ({ finalText: 'ROZSTRZYGNIĘCIE: DEFEKT ŚRODOWISKA\n--- TREŚĆ ---\nping zwraca 404', cost: 0 }));
  assert.equal(v.state, 'defect');
  assert.equal(fs.readFileSync(file, 'utf8'), BAD, 'the assertion was not weakened to make it pass');
});

const STEP_NOTE = `### TEST: test_three_quick_rejects_bench_the_first_lp
WERDYKT: DEFEKT ŚRODOWISKA
SPRAWDZA: Po 3 odrzuceniach w 5 s hedger przestaje wysyłać zlecenia do pierwszego LP.
KROKI:
1. Test otwiera BUY 25 lotów SYMBOL1 na koncie 1001.
2. Hedger wysyła zlecenie do LP A, LP A odrzuca je: Not enough margin!
3. [BŁĄD] Hedger wysyła do LP A czwarte zlecenie,
   choć limit w regule to 3.
OCZEKIWANO: dokładnie 3 odrzucenia, potem zlecenie do LP B.
JEST: 4 odrzucenia, dopiero potem LP B.
PRZYCZYNA: test czeka poprawnie; LP jest wyłączany o jedno odrzucenie za późno.
### TEST: test_second
KROKI:
1. Coś się dzieje.
JEST: (nie widać w wyniku pytest)`;

test('verify: the fix agent\'s step-by-step answer is parsed into cases', () => {
  const c = repo.parseFixNote(STEP_NOTE);
  assert.equal(c.length, 2);
  assert.equal(c[0].test, 'test_three_quick_rejects_bench_the_first_lp');
  assert.equal(c[0].verdict, 'DEFEKT ŚRODOWISKA');
  assert.equal(c[0].steps.length, 3);
  assert.deepEqual(c[0].steps.map((s) => s.bad), [false, false, true]);
  assert.equal(c[0].steps[2].text, 'Hedger wysyła do LP A czwarte zlecenie, choć limit w regule to 3.', 'wrapped step lines are joined, the marker is removed');
  assert.match(c[0].expected, /dokładnie 3/); assert.match(c[0].actual, /4 odrzucenia/); assert.match(c[0].cause, /za późno/);
  assert.deepEqual(repo.parseFixNote('zła ścieżka w helperze'), [], 'free text yields no cases, the UI shows it as text');
});

test('verify: the fix prompt asks for steps and the cases are kept on the attempt', { skip: NO_PRIVATE_TESTS }, async () => {
  const { r, before, file } = newRun('verify-steps');
  r.flow = 'ZASADY...\n=== PRZEBIEG QA MCP ===\n1. manager_read_get_account_positions {"clientId":"1001"}\n   → {"positions":[]}';
  fs.writeFileSync(file, BAD);
  let promptSeen = '';
  const LONG = STEP_NOTE.replace('za późno.', 'za późno. ' + 'Dalszy opis dowodu. '.repeat(60));
  const v = await repo.verifyAutotests(r, before, async (p) => { promptSeen = p; return { finalText: 'ROZSTRZYGNIĘCIE: DEFEKT ŚRODOWISKA\n--- TREŚĆ ---\n' + LONG, cost: 0 }; });
  assert.match(promptSeen, /KROKI:/); assert.match(promptSeen, /\[BŁĄD\]/);
  assert.match(promptSeen, /<przebieg_qa_mcp>[\s\S]*"positions":\[\][\s\S]*<\/przebieg_qa_mcp>/, 'the fix agent can compare the test with the QA MCP run');
  assert.match(promptSeen, /STAN POCZĄTKOWY/);
  assert.equal(v.state, 'defect');
  assert.equal(v.attempts[0].cases.length, 2);
  assert.equal(v.attempts[0].note, LONG, 'the answer is no longer cut at 900 characters');
});

test('verify: stops after two fixes and reports failing', { skip: NO_PRIVATE_TESTS }, async () => {
  const { r, before, file } = newRun('verify-fail');
  fs.writeFileSync(file, BAD);
  let calls = 0;
  const v = await repo.verifyAutotests(r, before, async () => {
    calls++; fs.writeFileSync(file, BAD + '\n# attempt ' + calls + '\n'); // zmienia plik, ale błąd zostaje
    return { finalText: 'ROZSTRZYGNIĘCIE: NIE UDAŁO SIĘ\n--- TREŚĆ ---\n?', cost: 0 };
  });
  assert.equal(v.state, 'failing'); assert.equal(calls, 2);
});

test('verify: a fix that changes nothing ends the loop without another pytest run', { skip: NO_PRIVATE_TESTS }, async () => {
  const { r, before, file } = newRun('verify-nochange');
  fs.writeFileSync(file, BAD);
  let calls = 0;
  const v = await repo.verifyAutotests(r, before, async () => { calls++; return { finalText: 'ROZSTRZYGNIĘCIE: NIE UDAŁO SIĘ\n--- TREŚĆ ---\nnie wiem', cost: 0 }; });
  assert.equal(v.state, 'failing'); assert.equal(calls, 1);
  assert.equal(v.attempts.length, 2, 'only the flaky check ran again, not another run after the empty fix');
  assert.match(v.summary, /changed nothing/);
});

test('verify: after a fix only the failed tests run, then everything once more', { skip: NO_PRIVATE_TESTS }, async () => {
  const { r, before, file } = newRun('verify-only');
  const second = (src) => src.split('\n\n\n')[1].replace('test_ping_is_served', 'test_ping_is_served_again');
  fs.writeFileSync(file, GOOD + '\n\n' + second(BAD));
  const v = await repo.verifyAutotests(r, before, async () => { fs.writeFileSync(file, GOOD + '\n\n' + second(GOOD)); return { finalText: 'ROZSTRZYGNIĘCIE: NAPRAWIONO\n--- TREŚĆ ---\nzła ścieżka', cost: 0 }; });
  assert.equal(v.state, 'passed');
  assert.deepEqual(v.attempts.map((a) => [a.passed, a.failed]), [[1, 1], [0, 1], [1, 0], [2, 0]]);
  assert.deepEqual(v.attempts[2].only, ['test_ping_is_served_again']);
  assert.equal(v.attempts[3].repeat, true);
});

test('QA MCP -> Autotests: the flow carries what each endpoint returned', () => {
  const { flowFromRun } = require('../lib/run-format');
  const { toolResultText } = require('../lib/run-agent');
  assert.equal(toolResultText([{ type: 'text', text: '{"a":1}' }, { type: 'image' }]), '{"a":1}\n');
  assert.equal(toolResultText('plain'), 'plain');
  const ev = (input, output, extra = {}) => ({ type: 'endpoint', text: 'core_hedger_read_get_lp_short_info', input, output, ...extra });
  const src = { meta: { ticket: 'check cooldown', report: 'SUKCES', reportStatus: 'SUKCES' }, events: [
    ev('{"id":"r1"}', '{"lps":[{"id":"A","rejectCooldownUntil":null}]}'),
    ev('{"id":"r1"}', '{"lps":[{"id":"A","rejectCooldownUntil":1760000060000}]}'), // ponowiony odczyt: zostaje ostatnia odpowiedź
    { type: 'endpoint', text: 'manager_create_account_order', input: '{"volume":2500}', output: 'Bad Request: volume', error: true },
    { type: 'text', who: 'main', text: 'A dostał cooldown' },
  ] };
  const flow = flowFromRun(src, []);
  assert.match(flow, /core_hedger_read_get_lp_short_info \{"id":"r1"\}  ×2\n   → \{"lps":\[\{"id":"A","rejectCooldownUntil":1760000060000\}\]\}/);
  assert.match(flow, /→ BŁĄD: Bad Request: volume/);
  assert.match(flow, /NAPRAWDĘ zwrócił/);
  const old = flowFromRun({ meta: src.meta, events: [{ type: 'endpoint', text: 'x_read', input: '{}' }] }, []);
  assert.match(old, /nie zapisywał odpowiedzi/, 'runs recorded before this change say so instead of pretending');
  const huge = { meta: src.meta, events: Array.from({ length: 300 }, (_, i) => ev(`{"i":${i}}`, 'x'.repeat(1200))) };
  const cut = flowFromRun(huge, []);
  assert.ok(cut.length < 36000, 'long runs are shortened, responses first');
  assert.ok(cut.includes('middle of the log was cut') && cut.includes('{"i":299}'), 'the end of the run (result, cleanup) survives the cut');
});

test('verify: failed tests are read from the pytest summary', () => {
  assert.deepEqual(repo.failedTests('x\nFAILED tests/a/test_x.py::test_one[2012-SYMBOL1] - AssertionError: no\nFAILED tests/a/test_x.py::test_two - E\n1 failed'),
    { files: ['tests/a/test_x.py'], names: ['test_one', 'test_two'] });
  assert.equal(repo.failedTests('ERROR tests/a/test_x.py - ImportError'), null, 'a collection error means: run everything');
  assert.equal(repo.failedTests('5 passed'), null);
});

test('verify: an unreachable environment is "unverified", not a test failure', async () => {
  const keep = process.env.PLAT_MANAGER_BASE_URL;
  process.env.PLAT_MANAGER_BASE_URL = 'http://127.0.0.1:1'; // nothing listens there
  try {
    const { r, before, file } = newRun('verify-env');
    fs.writeFileSync(file, GOOD);
    let calls = 0;
    const v = await repo.verifyAutotests(r, before, async () => { calls++; return null; });
    assert.equal(v.state, 'unverified'); assert.equal(calls, 0, 'the agent is not asked to "fix" an environment problem');
  } finally { process.env.PLAT_MANAGER_BASE_URL = keep; }
});

test('saveStaged: only verified runs, refuses conflicts, copies, then cleans up', async () => {
  const { r, before, file, dir } = newRun('save-1');
  fs.writeFileSync(file, GOOD);
  r.meta.files = repo.diffSnap(before, repo.snapTests(dir));
  r.meta.status = 'done';
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  r.meta.verify = { state: 'failing' };
  assert.throws(() => repo.saveStaged(r), /passed on the environment/);
  r.meta.verify = { state: 'passed' };
  const target = path.join(AUTOTEST_REPO, 'tests', '_unit', 'test_ping.py');
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, '# someone else\n');
  assert.throws(() => repo.saveStaged(r), /changed in autotests/);
  fs.rmSync(path.dirname(target), { recursive: true, force: true });
  const files = repo.saveStaged(r);
  assert.deepEqual(files.map((f) => f.path), ['tests/_unit/test_ping.py']);
  assert.equal(fs.readFileSync(target, 'utf8'), GOOD);
  assert.ok(!fs.existsSync(dir), 'staging removed');
  assert.equal(r.meta.staging.state, 'saved');
  assert.throws(() => repo.saveStaged(r), /Nothing waiting/);
});

test('discardStaged removes the copy and never touches the repo', () => {
  fs.rmSync(path.join(AUTOTEST_REPO, 'tests', '_unit'), { recursive: true, force: true }); // left over by the Save test
  const { r, file, dir } = newRun('discard-1');
  fs.writeFileSync(file, GOOD);
  r.meta.status = 'done';
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  repo.discardStaged(r);
  assert.equal(r.meta.staging.state, 'discarded');
  assert.ok(!fs.existsSync(dir));
  assert.ok(!fs.existsSync(path.join(AUTOTEST_REPO, 'tests', '_unit', 'test_ping.py')));
});

test('Tools diff finds new endpoints, removed ones and every kind of parameter change', () => {
  const { diffCatalogues } = require('../lib/tools');
  const ep = (params, extra = {}) => ({ method: 'POST', path: '/a', read: false, group: 'g', params, ...extra });
  const before = { keep: ep([{ name: 'body.x', required: false, type: 'string' }]), gone: ep([]), same: ep([{ name: 'id', required: true, type: 'string' }]) };
  const after = {
    keep: ep([{ name: 'body.x', required: true, type: 'integer' }, { name: 'body.y', required: true, type: 'boolean' }], { path: '/b' }),
    same: ep([{ name: 'id', required: true, type: 'string' }]),
    fresh: ep([]),
  };
  const d = diffCatalogues(before, after);
  assert.deepEqual(d.added, ['fresh']);
  assert.deepEqual(d.removed, ['gone']);
  assert.equal(d.changed.length, 1);
  const c = d.changed[0];
  assert.equal(c.name, 'keep');
  assert.deepEqual(c.added, ['body.y (required boolean)']);
  assert.deepEqual(c.modified, [{ name: 'body.x', from: 'string', to: 'required integer' }]);
  assert.deepEqual(c.moved, { from: 'POST /a', to: 'POST /b' });
});

test('OpenAPI 3 and Swagger 2 become one endpoint list with parameters and body outline', () => {
  const { parseSpec } = require('../lib/openapi');
  const v3 = parseSpec({
    openapi: '3.0.0', info: { title: 'Shop', version: '1' }, servers: [{ url: 'https://t.example.com/api' }],
    paths: {
      '/orders/{id}': { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], get: { operationId: 'getOrder', tags: ['Orders'] } },
      '/orders': { post: { operationId: 'createOrder', tags: ['Orders'], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } } } } },
    },
    components: { schemas: { Order: { type: 'object', required: ['item'], properties: { item: { type: 'string' }, side: { type: 'string', enum: ['buy', 'sell'] } } } } },
  }, 'shop');
  assert.deepEqual(v3.servers, ['https://t.example.com/api']);
  const get = v3.endpoints.find((e) => e.name === 'get_order');
  assert.equal(get.method, 'GET'); assert.equal(get.read, true); assert.equal(get.groupLabel, 'Orders');
  assert.deepEqual(get.params.map((x) => [x.name, x.in, x.required]), [['id', 'path', true]]);
  const post = v3.endpoints.find((e) => e.name === 'create_order');
  assert.equal(post.read, false);
  assert.deepEqual(post.body, { item: 'string', 'side?': 'buy | sell' });
  const v2 = parseSpec({ swagger: '2.0', host: 'old.example.com', basePath: '/v1', schemes: ['http'], paths: { '/ping': { get: { summary: 'Ping' } } } }, 'old');
  assert.deepEqual(v2.servers, ['http://old.example.com/v1']);
  assert.equal(v2.endpoints[0].name, 'get_ping'); assert.equal(v2.endpoints[0].summary, 'Ping');
});

test('Tools: a rescan marks new, removed and changed endpoints', () => {
  const { diffCatalogues } = require('../lib/tools');
  const before = { a: { method: 'GET', path: '/a', params: [{ name: 'x', type: 'string', required: false }] }, gone: { method: 'GET', path: '/g', params: [] } };
  const after = { a: { method: 'GET', path: '/a', params: [{ name: 'x', type: 'string', required: true }] }, fresh: { method: 'POST', path: '/f', params: [] } };
  const d = diffCatalogues(before, after);
  assert.deepEqual(d.added, ['fresh']); assert.deepEqual(d.removed, ['gone']);
  assert.equal(d.changed[0].modified[0].to, 'required string');
});

test('qa MCP server: lists, describes and calls endpoints, numbers every call and logs it', async () => {
  const http = require('http');
  const { spawn } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-mcp-'));
  const srv = http.createServer((q, r) => { let b = ''; q.on('data', (c) => { b += c; }); q.on('end', () => { r.writeHead(201, { 'content-type': 'application/json' }); r.end(JSON.stringify({ method: q.method, url: q.url, auth: q.headers.authorization || '', body: b ? JSON.parse(b) : null })); }); });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const base = 'http://127.0.0.1:' + srv.address().port;
  fs.mkdirSync(path.join(dir, 'specs'));
  fs.writeFileSync(path.join(dir, 'specs', 'shop.json'), JSON.stringify({ openapi: '3.0.0', info: { title: 'Shop' }, paths: { '/orders/{id}': { put: { operationId: 'updateOrder', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }] } } } }));
  fs.writeFileSync(path.join(dir, 'sources.json'), JSON.stringify({ api: { baseUrl: base, authHeader: 'Authorization', authValue: 'Bearer t' } }));
  const log = path.join(dir, 'calls.jsonl');
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'mcp', 'api-server.js')], { env: { ...process.env, QA_DATA_DIR: dir, QA_SPECS_DIR: path.join(dir, 'specs'), QA_SOURCES_FILE: path.join(dir, 'sources.json'), QA_CALL_LOG: log } });
  let out = '';
  const answers = new Map();
  p.stdout.on('data', (c) => { out += c; let i; while ((i = out.indexOf('\n')) >= 0) { const m = JSON.parse(out.slice(0, i)); out = out.slice(i + 1); answers.set(m.id, m); } });
  const ask = (id, method, params) => new Promise((ok) => { p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); const t = setInterval(() => { if (answers.has(id)) { clearInterval(t); ok(answers.get(id)); } }, 10); });
  try {
    assert.equal((await ask(1, 'initialize', {})).result.serverInfo.name, 'qa');
    const names = (await ask(2, 'tools/list')).result.tools.map((t) => t.name);
    for (const n of ['general_get_status', 'general_read_list_endpoints', 'general_read_describe_endpoint', 'general_call_endpoint']) assert.ok(names.includes(n), n);
    const ok = JSON.parse((await ask(3, 'tools/call', { name: 'general_call_endpoint', arguments: { name: 'update_order', path_params: { id: 7 }, body: { qty: 2 } } })).result.content[0].text);
    assert.equal(ok._call, 'c1'); assert.equal(ok.status, 201);
    assert.deepEqual(ok.body, { method: 'PUT', url: '/orders/7', auth: 'Bearer t', body: { qty: 2 } });
    const bad = (await ask(4, 'tools/call', { name: 'general_call_endpoint', arguments: { name: 'update_order' } })).result;
    assert.equal(bad.isError, true); assert.match(bad.content[0].text, /\[c2\] Missing path parameter "id"/);
    const lines = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => [l.ref, l.ok]), [['c1', true], ['c2', false]]);
  } finally { p.kill(); srv.close(); }
});

// ---------------------------------------------------------------- report cards + hallucination audit
const rf = require('../lib/report-format');
const QA_NEW = `WYNIK: BUY 0.01 lota otworzył jedną pozycję, ale zamknięcie zamknęło inną.
ZLECENIE:
- [ZROBIONO] Otwórz BUY 0.01 lota SYMBOL1 na koncie 1001
- [POMINIĘTO] Sprawdź marżę — zależała od kroku 3; manager_read_get_account_balance nie był potrzebny
KROKI:
1. Konto 1001 nie ma pozycji SYMBOL1 (odczyt: 0).
2. BUY 0.01 lota: nowa pozycja, wolumen 1.
3. [BŁĄD] Zlecenie zamykające zamknęło starszą pozycję, wskazana została.
BŁĘDY:
### Zamknięcie trafia w złą pozycję
KROK: 3
ENDPOINT: \`manager_create_account_order\`
OCZEKIWANO: zamknięta pozycja z closingClOrdId.
OTRZYMANO: zamknięta najstarsza pozycja.
RODZAJ: PRODUKT
STAN KOŃCOWY: konto 1001 bez pozycji, reguła AUTOTEST bez zmian.`;

test('report cards: QA MCP new and old format', () => {
  const v = rf.parseQamcp(QA_NEW, 'BŁĄD');
  assert.equal(v.format, 'steps');
  assert.equal(v.scope.length, 2); assert.equal(v.scope[1].tag, 'POMINIĘTO');
  assert.deepEqual(v.steps.map((s) => s.bad), [false, false, true]);
  assert.equal(v.errors.length, 1);
  assert.deepEqual([v.errors[0].step, v.errors[0].endpoint, v.errors[0].kind], ['3', 'manager_create_account_order', 'PRODUKT']);
  assert.match(v.endState, /bez pozycji/);
  const old = rf.parseQamcp('**BŁĄD** — 1 z 3 nie zagrało.\n\nReplikacja:\n1. Otwórz.\n2. Zamknij.\n\nBłędy:\n1. Gdzie: `manager_create_account_order` w kroku 2\n   Oczekiwano: zamknięta.\n   Otrzymano: otwarta.\n\nPominięte: krok 3', 'BŁĄD');
  assert.equal(old.format, 'legacy'); assert.equal(old.steps.length, 2);
  assert.deepEqual([old.errors[0].endpoint, old.errors[0].step, old.errors[0].expected], ['manager_create_account_order', '2', 'zamknięta.']);
  assert.equal(old.skipped, 'krok 3');
});

test('report cards: Analyses new (steps on lines, [BŁĄD]) and old (inline steps)', () => {
  const v = rf.parseAnalysis('PRJ-508\n\n1. LP za późno\nCo się dzieje: 4 odrzucenia.\nPowinno być: 3 odrzucenia.\nDlaczego to groźne: dłużej bez hedge.\nŚcieżka do replikacji:\n1) Ustaw limit 3.\n2) [BŁĄD] Zobacz 4 odrzucenia.\nDowód: A.kt:27\nwhitebox: 0 | static: 1 | dynamic: 0', 'RAPORT OK');
  assert.equal(v.ticket, 'PRJ-508'); assert.equal(v.cases.length, 1);
  const c = v.cases[0];
  assert.deepEqual([c.actual, c.expected, c.proof], ['4 odrzucenia.', '3 odrzucenia.', 'A.kt:27']);
  assert.deepEqual(c.steps.map((s) => [s.text, !!s.bad]), [['Ustaw limit 3.', false], ['Zobacz 4 odrzucenia.', true]]);
  const old = rf.parseAnalysis('SVC-1\n\n1. T\nCo się dzieje: x\nDlaczego to groźne: y\nŚcieżka do replikacji: 1) a 2) b 3) c\nDowód: B.kt:1\nSprawdzone i czyste: z\nwhitebox: 1 | static: 0 | dynamic: 0', 'RAPORT OK');
  assert.equal(old.cases[0].steps.length, 3); assert.equal(old.cases[0].steps[2].obs, true, 'old reports: the last step carries the observation');
  assert.equal(old.clean, 'z');
  assert.equal(rf.parseAnalysis('PRJ-1\n[Hedger] — brak krytycznych przypadków.', 'RAPORT OK').none, '[Hedger] — brak krytycznych przypadków.');
});

test('report cards: Test design sections and checks', () => {
  const v = rf.parseDesign('TEST DESIGN — X\nTest basis: PRJ-1\nScope: a\n\n## 1. Limits  [Boundary Value Analysis, ISTQB FL v4.0 §4.2.2]\n- Save 3000 => rejected (src: V.kt:75)\n- Save 3001 => saved (src: V.kt:75)\nNot covered: -\n\n## Summary\n1 | Limits | 2 checks | x\n\n## To confirm before testing\n- Ask dev.', 'PROJEKT OK');
  assert.equal(v.sections.length, 1); assert.equal(v.sections[0].technique, 'Boundary Value Analysis, ISTQB FL v4.0 §4.2.2');
  assert.deepEqual(v.sections[0].checks[0], { action: 'Save 3000', expected: 'rejected', src: 'V.kt:75' });
  assert.deepEqual(v.confirm, ['Ask dev.']);
  assert.equal(rf.parseReport('qa', '', 'x'), null);
});

test('audit: QA MCP report may only name endpoints the run really called', () => {
  const ev = (n) => ({ type: 'endpoint', text: n });
  const events = [ev('general_get_status'), ev('manager_read_get_account_positions'), ev('manager_create_account_order')];
  assert.deepEqual(rf.auditQamcp(QA_NEW, 'BŁĄD', events), [], 'a tool named only in a skipped order item is not a claim');
  const lied = QA_NEW.replace('2. BUY 0.01 lota', '2. Odczyt admin_read_get_external_lp_connectors zwraca 3 konektory. BUY 0.01 lota');
  const a = rf.auditQamcp(lied, 'BŁĄD', [...events, { type: 'endpoint', text: 'general_read_describe_endpoint', input: '{"tool":"admin_read_get_external_lp_connectors"}' }]);
  assert.equal(a[0].code, 'uncalled-endpoint'); assert.deepEqual(a[0].items, ['admin_read_get_external_lp_connectors']);
  assert.match(a[0].text, /only their description was read/);
  assert.ok(rf.auditQamcp(QA_NEW, 'SUKCES', events).some((i) => i.code === 'status-mismatch'));
  assert.match(rf.correctionPrompt('qamcp', a), /admin_read_get_external_lp_connectors[\s\S]*niczego nie zapisuj/);
});

test('audit: every file:line in an analysis must exist in the downloaded code', () => {
  const wd = path.join(tmp, 'audit-wd');
  fs.mkdirSync(path.join(wd, 'kod-po', 'src', 'x'), { recursive: true });
  fs.writeFileSync(path.join(wd, 'kod-po', 'src', 'x', 'Rule.kt'), 'a\nb\nc\nd\n');
  const rep = 'PRJ-1\n\n1. T\nDowód: Rule.kt:3 oraz src/x/Rule.kt:2-4\n\n2. U\nDowód: Ghost.kt:10, Rule.kt:99\n';
  const r = rf.auditEvidence(rep, wd);
  assert.equal(r.checked, 4);
  assert.deepEqual(r.issues.map((i) => [i.code, i.items]), [['evidence-missing-file', ['Ghost.kt:10']], ['evidence-bad-line', ['Rule.kt:99']]]);
  assert.deepEqual(rf.auditEvidence('## 1. A [T]\n- x => y (src: Rule.kt:1; PRJ-1)', wd).issues, [], 'Test design src refs are checked the same way');
  assert.equal(rf.auditEvidence(rep, path.join(tmp, 'no-code')), null, 'no downloaded code, no verdict');
});

test('report cards: the business-rules gate line has its own field, not glued to RODZAJ', () => {
  const v = rf.parseQamcp('WYNIK: x\nKROKI:\n1. a\nBŁĘDY:\n### t\nKROK: 1\nRODZAJ: PRODUKT\nbramka: (1) nie walidacja\nSTAN KOŃCOWY: ok', 'BŁĄD');
  assert.deepEqual([v.errors[0].kind, v.errors[0].gate], ['PRODUKT', '(1) nie walidacja']);
  assert.match(require('../lib/prompts').OVERRIDE_QAMCP, /BRAMKA:/);
});

test('Test design: a tester flow must be mapped and run, not replaced by config-save checks', () => {
  const flow = 'please cover PRJ-508: rejecting trades moves orders to other accounts in the matrix or the next priority; two no-funds accounts in one tranche, exposure moves to two funded ones; vary minOrderStep and maxLotPerTrade per account';
  assert.equal(rf.hasTesterFlow('PRJ-508', ''), false, 'a bare ticket key is not a flow');
  assert.equal(rf.hasTesterFlow('https://your-org.atlassian.net/browse/PRJ-508', 'check it'), false);
  assert.equal(rf.hasTesterFlow('PRJ-508', flow), true);
  const head = 'TEST DESIGN — X\nTest basis: PRJ-508\n';
  const saves = '## 1. Limits  [BVA, ISTQB FL v4.0 §4.2.2]\n- Save maxRejectsCount 3, window 300 => rejected "x" (src: V.kt:75)\n- Save maxRejectsCount 3, window 301 => saved (src: V.kt:75)\n- Put A and B in one tranche, open BUY 25 lots => C and D fill the tranche (src: flow; A.kt:85)\n';
  const bad = rf.auditDesignFlow(head + saves, 'PRJ-508', flow);
  assert.deepEqual(bad.map((i) => i.code), ['flow-missing', 'flow-replaced']);
  const good = rf.auditDesignFlow(head + 'Flow: F1 two no-funds accounts→§1\n## 1. Rotation (F1)  [DT, ISTQB FL v4.0 §4.2.3]\n- Put A and B in one tranche, open BUY 25 lots => C and D fill the tranche (src: flow; A.kt:85)\n', 'PRJ-508', flow);
  assert.deepEqual(good, []);
  assert.deepEqual(rf.auditDesignFlow(head + saves, 'PRJ-508', ''), [], 'no flow given: validation points are allowed');
  assert.match(rf.correctionPrompt('design', bad), /F1, F2[\s\S]*WYKONUJĄCYMI/);
});

test('Test design: the bug registry teaches flows and error classes, never cases to copy', () => {
  const { DATA_DIR } = require('../lib/config');
  const reg = [
    { service: 'core-hedger', severity: 'krytyczny', ticket: 'PRJ-508', title: 'Reject loop with rejectsTimeWindow 10 and cooldown 100', notes: 'Reported in PRJ-508, item #3. https://x/y\n\n1. I set rejectsTimeWindow=10 [ms], additionalCooldownExecution=100 [ms]\n2. rotation never happens\nMedia: a.mp4' },
    { service: 'core-hedger', severity: 'wazny', ticket: 'PRJ-318', title: 'Leftovers after disable and enable', notes: 'Replikacja: disable the rule, enable it, open 5 lots => old orders stay' },
  ];
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'bugs.json'), JSON.stringify(reg));
  const { writeBugRegistry } = require('../lib/run-agent');
  const d = path.join(tmp, 'reg'); fs.mkdirSync(d, { recursive: true });
  writeBugRegistry(d, 'PRJ-508\nplease cover rotation');
  const md = fs.readFileSync(path.join(d, 'bug-registry.md'), 'utf8');
  assert.match(md, /NIE lista przypadków do skopiowania/);
  assert.match(md, /^- \[ZGLOSZONY\] PRJ-508 /m, 'bugs of the ticket under test are marked as already reported');
  assert.doesNotMatch(md, /^- \[krytyczny\] PRJ-508/m);
  assert.match(md, /Replikacja: disable the rule/);
  writeBugRegistry(d, 'PRJ-600');
  const other = fs.readFileSync(path.join(d, 'bug-registry.md'), 'utf8');
  assert.match(other, /Replikacja: 1\. I set rejectsTimeWindow=10 \[ms\].*rotation never happens/, 'flow comes from the notes when there is no Replikacja line');
  assert.doesNotMatch(other, /Media:|https:\/\//);

  const head = 'TEST DESIGN — X\nTest basis: PRJ-600\n';
  const ok = rf.auditDesignBugs(head + 'Bug patterns: PRJ-318 leftovers after disable/enable → §2\n## 2. Re-enable  [ST, ISTQB FL v4.0 §4.2.4]\n- Disable rule R, enable it, open 3 lots => only new orders (src: R.kt:10 | bug:PRJ-318)\n', reg, 'PRJ-600');
  assert.deepEqual(ok, []);
  const bad = rf.auditDesignBugs(head + '## 1. Loop\n- Set rejectsTimeWindow 10 ms and cooldown 100 ms => rotation never happens (src: V.kt:5 | bug:PRJ-508)\n', reg, 'PRJ-508');
  assert.deepEqual(bad.map((i) => i.code), ['bugs-missing', 'bugs-same-ticket']);
  const copy = rf.auditDesignBugs(head + 'Bug patterns: PRJ-508 reject loop → §1\n## 1. Loop\n- Set rejectsTimeWindow 10 ms and cooldown 100 ms => rotation never happens (src: V.kt:5 | bug:PRJ-508)\n', reg, 'PRJ-600');
  assert.deepEqual(copy.map((i) => i.code), ['bugs-copied']);
  assert.match(rf.correctionPrompt('design', bad), /wzorzec, nie kopia/);
  assert.match(require('../lib/prompts').OVERRIDE_DESIGN, /REJESTR BŁĘDÓW TO WZORZEC, NIE KOPIA/);
});

test('Test design: checks are written on the AUTOTEST accounts in lots, not on placeholders', () => {
  const d = path.join(tmp, 'setup'); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'autotest-setup.md'), '| priority | hedgerId |\n|---|---|\n| 1 | 1002 | SYMBOL1 |\n| 1 | 1004 | SYMBOL1 |\n- system SYS: klient 1001 coveragePercentage 100\n');
  const head = 'TEST DESIGN — X\n## 1. Reduction  [ST, ISTQB FL v4.0 §4.2.4]\n';
  const abstract = rf.auditDesignConcrete(head + '- A, B, C enabled, raise net above T; rule off, C false, on => C position unchanged in hedge total (src: X.kt:1)\n- Reduce net by V units => SELL only on A and B (src: X.kt:2)\n', d);
  assert.deepEqual(abstract.map((i) => i.code), ['design-abstract', 'design-no-accounts']);
  assert.equal(abstract[0].items.length, 2);
  const real = rf.auditDesignConcrete(head + '- 1) client 1001 BUY 30 lots SYMBOL1; 2) rule off, 1004 isEnabled=false, rule on => 1004 keeps its lots, hedge total unchanged (src: X.kt:1)\n', d);
  assert.deepEqual(real, []);
  assert.deepEqual(rf.auditDesignConcrete(head + '- Logon with SenderCompID FEED1 while PLAT is down => Logout 58 "PLAT unavailable" (src: S.kt:9)\n', d), [], 'non-hedger designs need no AUTOTEST account');
  assert.match(rf.correctionPrompt('design', abstract), /prawdziwe numery kont zamiast liter/);
  assert.match(require('../lib/prompts').OVERRIDE_DESIGN, /OPIS NA PRZYKŁADZIE AUTOTEST/);
});

test('Test design gets the list of existing autotests and the tester text as its order', { skip: NO_PRIVATE_TESTS }, () => {
  const { writeAutotestCoverage } = require('../lib/run-agent');
  const d = path.join(tmp, 'cov'); fs.mkdirSync(d, { recursive: true });
  writeAutotestCoverage(d);
  const cov = fs.readFileSync(path.join(d, 'autotests-coverage.md'), 'utf8');
  assert.match(cov, /## tests\/smoke\/test_environment_is_alive\.py/);
  assert.match(cov, /^- test_\w+/m);
  const p = require('../lib/prompts').OVERRIDE_DESIGN;
  assert.match(p, /FLOW TESTERA JEST SZKIELETEM/);
  assert.match(p, /Granice walidacji projektujesz jako osobne sprawdzenia TYLKO wtedy/);
});

// ---------------------------------------------------------------- audit fixes 2026-10-22
test('verify guards: shared code pulls its dependants in, trading on hedger accounts and dropped checks are caught', () => {
  const d = path.join(tmp, 'guards');
  const w = (rel, src) => { fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); fs.writeFileSync(path.join(d, rel), src); };
  w('utils/methods/hedger_utils.py', 'def enable_all_assignments(rule_id):\n    pass\n');
  w('tests/hedger/conftest.py', 'from utils.methods.hedger_utils import enable_all_assignments\n');
  w('tests/hedger/test_a.py', 'def test_a():\n    assert 1\n');
  w('tests/trading/test_b.py', 'def test_b():\n    assert 1\n');
  w('tests/trading/test_c.py', 'from utils.methods.hedger_utils import enable_all_assignments\ndef test_c():\n    assert 1\n');
  assert.deepEqual(repo.affectedTests(d, ['utils/methods/hedger_utils.py']), ['tests/hedger/test_a.py', 'tests/trading/test_c.py'], 'importers and tests under an importing conftest');
  assert.deepEqual(repo.affectedTests(d, ['tests/hedger/conftest.py']), ['tests/hedger/test_a.py']);
  assert.deepEqual(repo.affectedTests(d, ['tests/trading/test_b.py']), ['tests/trading/test_b.py']);
  w('tests/hedger/conftest.py', 'def flatten(hedger_ids, symbol):\n    for hedger_id in hedger_ids:\n        set_net_position(hedger_id, symbol, 0)\n');
  assert.equal(repo.hedgerTrades(d).length, 1);
  assert.match(repo.hedgerTrades(d)[0], /conftest\.py:3/);
  assert.equal(repo.checkCount('def verify_x():\n    assert a\nassert b\nverify_x()\n'), 3, 'asserts and verify calls, not verify definitions');
});

test('design audits: real domain text is not a placeholder, AUTOTEST values are not a copied bug, a wish is not a flow', () => {
  const d = path.join(tmp, 'setup2'); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'autotest-setup.md'), '| 1 | 1002 | SYMBOL1 | 50 | 13 |\n| 1 | 1003 | SYMBOL1 | 20 | 10 |\n- klient 1001 100\n');
  const head = 'TEST DESIGN\n## 1. x\n';
  for (const l of ['- Route client 1001 to B-book group => order goes to B-book (src: R.kt:1)', '- settlement date T+2 for SYMBOL2 => SettlDate is trade date + 2 days (src: S.kt:1)', '- Send 59=C or D => rejected (src: F.kt:3)']) {
    assert.deepEqual(rf.auditDesignConcrete(head + l + '\n', d), [], l);
  }
  assert.equal(rf.auditDesignConcrete(head + '- Reduce net by V units => SELL only on A and B (src: X.kt:2)\n', d)[0].code, 'design-abstract');
  const reg = [{ ticket: 'PRJ-524', title: 'Reduction: 1002 got 10 lots', notes: 'client 1001 BUY 40 lots' }];
  assert.deepEqual(rf.auditDesignBugs('Bug patterns: PRJ-524 split → §1\n- client 1001 BUY 28 lots => 1002, 1003 split 10 lots (src: X.kt:1; bug:PRJ-524)\n', reg, 'PRJ-629', d), []);
  assert.equal(rf.hasTesterFlow('https://x/browse/PRJ-629', 'Find any regressions or mistakes made within this new functionality - make sure to cover high percentage of coverage'), false);
  assert.equal(rf.hasTesterFlow('PRJ-629', 'please verify there are no regressions, for example if i turn off an account, it does not hedge for this account'), true);
});

test('QA MCP audit: BŁĄD needs a product error', () => {
  const rep = (kind) => `WYNIK: x\nZLECENIE:\n1. [ZROBIONO] a\nKROKI:\n1. [BŁĄD] b\nBŁĘDY:\n### t\nKROK: 1\nENDPOINT: \`manager_read_get_account_positions\`\nOCZEKIWANO: a\nOTRZYMANO: b\nRODZAJ: ${kind}\nBRAMKA: c\nSTAN KOŃCOWY: ok`;
  const ev = [{ type: 'endpoint', text: 'manager_read_get_account_positions' }];
  assert.ok(rf.auditQamcp(rep('OGRANICZENIE ŚRODOWISKA'), 'BŁĄD', ev).some((i) => i.code === 'status-mismatch'));
  assert.ok(!rf.auditQamcp(rep('PRODUKT'), 'BŁĄD', ev).some((i) => i.code === 'status-mismatch'));
  assert.ok(rf.auditQamcp(rep('PRODUKT'), 'NIEWERYFIKOWALNE', ev).some((i) => i.code === 'status-mismatch'));
});

test('QA MCP audit: every value cited with [cN] must be in that call, units may be shown as lots', () => {
  const d = path.join(tmp, 'calls'); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'calls.jsonl'), [
    { ref: 'c1', tool: 'manager_read_get_account_positions', args: { clientId: '1001' }, ok: true, response: { positions: [{ instrument: 'SYMBOL1', volume: '600' }] } },
    { ref: 'c2', tool: 'core_hedger_read_get_exposure_dashboard', args: {}, ok: true, response: { volumeNetExposure: 6, hedgeExposureInfo: { hedgerExposures: [{ hedgerId: 1002, netExposure: 3 }] } } },
  ].map((c) => JSON.stringify(c)).join('\n') + '\n');
  const ev = [{ type: 'endpoint', text: 'manager_read_get_account_positions' }, { type: 'endpoint', text: 'core_hedger_read_get_exposure_dashboard' }];
  const rep = (steps) => `WYNIK: x\nZLECENIE:\n1. [ZROBIONO] a\nKROKI:\n${steps}\nSTAN KOŃCOWY: ok`;
  assert.deepEqual(rf.auditQamcp(rep('1. Klient 1001 ma 6 lotów SYMBOL1 [c1].\n2. Hedger 1002 trzyma 3 loty [c2].'), 'SUKCES', ev, d), [], '600 units = 6 lots');
  const bad = rf.auditQamcp(rep('1. Klient 1001 ma 7 lotów SYMBOL1 [c1].\n2. Hedger 1002 trzyma 3 loty [c9].'), 'SUKCES', ev, d);
  assert.deepEqual(bad.map((i) => i.code).sort(), ['unknown-call-ref', 'value-not-in-call']);
  assert.equal(rf.auditQamcp(rep('1. Klient 1001 ma 6 lotów SYMBOL1.'), 'SUKCES', ev, d)[0].code, 'no-call-refs');
  assert.deepEqual(rf.auditQamcp(rep('1. Klient 1001 ma 7 lotów SYMBOL1.'), 'SUKCES', ev, path.join(tmp, 'no-calls')), [], 'runs without a call log are not checked');
  assert.match(rf.correctionPrompt('qamcp', bad), /\(wyliczone/);
});
