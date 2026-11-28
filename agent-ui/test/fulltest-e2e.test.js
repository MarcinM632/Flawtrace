// Full tests end to end, through the real server, with a stand-in for the claude CLI (fixtures/fake-claude.js).
// It proves the orchestration that unit tests of the engine cannot: every phase starts as a real run, gets the digest
// of the phase before it, the two execution tracks start together, the failures of both tracks become items to
// confirm, the tester's decision closes the case, becomes a lesson and shows in the documentation draft.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP = path.resolve(__dirname, '..');
let proc, base, dataDir, promptLog, knowledge;
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const call = async (method, p, body) => {
  const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch (_) { data = text; }
  return { status: res.status, data };
};

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-ft-e2e-'));
  knowledge = path.join(dataDir, 'knowledge');
  fs.mkdirSync(knowledge);
  fs.writeFileSync(path.join(knowledge, 'how-we-test.md'), '# How we test\nBoundaries first.\n');
  fs.mkdirSync(path.join(dataDir, 'runs'));
  fs.writeFileSync(path.join(dataDir, 'bugs.json'), '[]');
  fs.writeFileSync(path.join(dataDir, 'jira-sync.json'), JSON.stringify({ lastTry: Date.now(), lastOk: Date.now(), lastComments: Date.now(), added: 0, found: 0, error: '' }));
  fs.writeFileSync(path.join(dataDir, 'sources.json'), JSON.stringify({ knowledgeDir: knowledge, repos: [], api: { baseUrl: 'http://127.0.0.1:9', authHeader: 'Authorization', authValue: '', specs: [], readOnly: false } }));
  promptLog = path.join(dataDir, 'prompts.jsonl');
  const port = await freePort();
  base = 'http://127.0.0.1:' + port;
  proc = spawn(process.execPath, ['server.js'], { cwd: APP, env: { ...process.env, PORT: String(port), QA_DATA_DIR: dataDir, QA_SOURCES_FILE: '', QA_API_KEY: 'k', JIRA_SYNC_MINUTES: '999999', QA_HEDGE_GUARD: '0',
    QA_CLAUDE_CMD: path.join(__dirname, 'fixtures', 'fake-claude.js'), FAKE_CLAUDE_LOG: promptLog, QA_VERIFIER: '0', QA_UI_FORM_HINTS: '0', QA_OSV: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 20000);
    proc.stdout.on('data', (c) => { if (String(c).includes('Agent UI:')) { clearTimeout(t); resolve(); } });
    proc.on('exit', (code) => reject(new Error('server exited early: ' + code)));
  });
  const up = await call('POST', '/api/sources/specs/upload', { name: 'pets', text: fs.readFileSync(path.join(__dirname, 'fixtures', 'petstore.json'), 'utf8') });
  assert.equal(up.status, 200, JSON.stringify(up.data));
});
after(() => { if (proc) proc.kill(); if (process.env.KEEP_E2E) { console.log('kept ' + dataDir); return; } try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) { /* temp */ } });

async function waitCase(id, until, ms = 60000) {
  const end = Date.now() + ms;
  let v;
  while (Date.now() < end) {
    v = (await call('GET', '/api/fulltest/' + id)).data;
    if (until(v)) return v;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('case did not get there: ' + JSON.stringify(v && { status: v.status, pause: v.pause, stages: v.stages }));
}

test('Full tests: static -> design -> API and UI together -> confirmation -> lesson and documentation', async () => {
  const agents = (await call('GET', '/api/fulltest')).data.agents;
  assert.equal(agents.api, true, 'the API track is available (spec + base URL)');
  const ready = (await call('POST', '/api/fulltest/readiness', { task: 'DEMO-1', stages: { static: true } })).data;
  assert.deepEqual([ready.ready, ready.items.map((i) => i.code)], [false, ['key-without-jira']], 'the readiness check sees that Jira is not connected');
  const created = await call('POST', '/api/fulltest', { task: 'DEMO-1: registration with a password of at least 8 characters', stages: { static: true, whitebox: false, design: true, api: true, ui: true }, url: 'http://127.0.0.1:9/#/register' });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const id = created.data.id;

  const v = await waitCase(id, (c) => ['waiting', 'done', 'paused', 'failed', 'cancelled'].includes(c.status));
  assert.equal(v.status, 'waiting', JSON.stringify({ pause: v.pause, stages: v.stages }));
  const st = v.stages;
  for (const k of ['static', 'design', 'api', 'ui']) assert.equal(st[k].status, 'done', k + ': ' + st[k].note);
  assert.equal(st.whitebox.status, 'skipped');
  assert.equal(v.static.verdict, 'NEEDS REWORK');
  assert.equal(v.static.findings, 1);
  // Order: the design starts only after the review; both tracks start after the design, at the same moment.
  assert.ok(st.design.startedAt >= st.static.finishedAt, 'design after static');
  assert.ok(st.api.startedAt >= st.design.finishedAt && st.ui.startedAt >= st.design.finishedAt, 'tracks after design');
  assert.ok(Math.abs(st.api.startedAt - st.ui.startedAt) < 2000, 'the two tracks run together');

  // Each phase got what the one before found.
  const prompts = fs.readFileSync(promptLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l).prompt);
  const design = prompts.find((p) => /static-review\.md/.test(p));
  assert.ok(design, 'the design got the static review');
  assert.match(design, /15 minutes in the description and 30 minutes/);
  const api = prompts.find((p) => /through the qa MCP server/.test(p));
  assert.match(api, /8-character password => 201 created/, 'the API track got the design');
  const ui = prompts.find((p) => /PAGE UNDER TEST/.test(p));
  assert.match(ui, /8-character password => 201 created/, 'the UI track got the design');
  assert.match(ui, /http:\/\/127\.0\.0\.1:9\/#\/register/);

  // Failures of both tracks are the items to confirm.
  const items = v.confirm.items;
  assert.deepEqual(items.map((i) => i.layer).sort(), ['api', 'ui', 'ui']);
  assert.ok(items.some((i) => i.layer === 'api' && /8-character password is rejected/.test(i.title)));

  const decisions = Object.fromEntries(items.map((i) => [i.id, i.layer === 'api' ? 'defect' : 'not-defect']));
  const done = await call('POST', `/api/fulltest/${id}/confirm`, { decisions, note: 'UI text is a known copy issue' });
  assert.equal(done.status, 200, JSON.stringify(done.data));
  assert.equal(done.data.status, 'done');

  const lessons = fs.readdirSync(path.join(knowledge, 'lessons')).map((f) => fs.readFileSync(path.join(knowledge, 'lessons', f), 'utf8')).join('\n');
  assert.match(lessons, /8-character password is rejected/, 'the confirmed defect is kept as a lesson');
  const docs = (await call('GET', `/api/fulltest/${id}/docs`)).data;
  assert.match(docs.markdown, /Defect: \[API\] An 8-character password is rejected/);
  assert.match(docs.markdown, /Not a defect: \[UI\]/);
  assert.match(docs.markdown, /Verdict: NEEDS REWORK/);
});
