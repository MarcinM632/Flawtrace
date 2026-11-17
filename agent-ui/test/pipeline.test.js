// Full tests: the server-side orchestrator, driven with fake runs (no agents, no network).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pl = require('../lib/pipeline');
const rf = require('../lib/report-format');

const STATIC = fs.readFileSync(path.join(__dirname, 'fixtures', 'static-sample-good.txt'), 'utf8');
const STATIC_CODE = STATIC.replace('(static: base branch develop)', '(whitebox: branch feature/DEMO-101)');
const STATIC_BLOCKED = STATIC.replace('NEEDS REWORK', 'BLOCKED').replace('[Interface] [Critical]', '[Impossible] [Critical]');
const WHITEBOX = 'DEMO-101\nwhitebox: 3 | diff: 40 | mode: whitebox | repos: 2 | contacts: 4 | callers: 9\n1. Off by one\nCo się dzieje: rejects only above\nPowinno być: reject at the limit\nDowód: LimitService.kt:41\nIntegracje: event customerLimit read in LimitCache.kt:8\nPoza zmianą: 9 callers checked\nSprawdzone i czyste: x\n';
const DESIGN = 'TEST DESIGN — DEMO-101\n## 1. Order at the limit [Boundary Value Analysis]\n- Place order with 5 open => rejected (src: LimitService.kt:41)\n## 2. Limit visible on the screen [Use case]\n- Open the rule page => shows maxOpenOrders (src: DEMO-101)\n';
const API_FAIL = '**BŁĄD** — one check failed\nReplikacja:\n1. Read the rule\nBłędy:\n1. Gdzie: `manager_read_check` krok 2\nOczekiwano: rejected\nOtrzymano: allowed\n';
const UI_FAIL = '## Steps\n[s1] PASS — open the page → ok\n## Checks\n[a1] FAIL — the field maxOpenOrders is visible (after s1)\n## Findings\nThe field is missing.';
const UI_OK = '## Steps\n[s1] PASS — open → ok\n## Checks\n[a1] PASS — the title is visible (after s1)\n## Findings\nNone';

function rig(over = {}) {
  const runs = new Map(); const started = []; let n = 0; const cancelled = [];
  const avail = { static: true, design: true, core: true, svc: true, mcp: true, execution: true, uitest: true, autotest: true, ...(over.avail || {}) };
  const AGENTS = Object.fromEntries(Object.keys(avail).map((k) => [k, { key: k }]));
  const deps = {
    dir: fs.mkdtempSync(path.join(os.tmpdir(), 'qa-pl-')), runs, AGENTS, agentAvailable: (a) => avail[a.key],
    startRun: (agent, ticket, notes, extra) => {
      const id = 'r' + (++n); started.push({ id, agent, ticket, notes, extra });
      runs.set(id, { meta: { id, agent, ticket, status: 'running', report: null, reportStatus: null, costUsd: 0, url: (extra || {}).url }, events: [] }); return runs.get(id).meta;
    },
    autotestsFromRun: async (src, note, layer) => { deps.atCalls.push({ id: src.meta.id, note, layer }); return { id: 'at-' + layer }; }, atCalls: [],
    persistRun: () => {}, parseAnalysis: rf.parseAnalysis, parseDesign: rf.parseDesign, parseReport: rf.parseReport,
    uiTest: { acceptBlocker: (m) => (/^VERIFIED/.test(m.reportStatus || '') ? '' : `The status is ${m.reportStatus}, not VERIFIED.`), buildFlow: () => 'flow' },
    cancelRun: (r) => { cancelled.push(r.meta.id); r.meta.status = 'cancelled'; },
    sources: { confluencePublishTarget: () => over.target || { ready: true, space: 'QA' }, confluencePublish: async ({ title }) => ({ id: '9', url: 'https://c/wiki/9', created: true, title }) },
  };
  const P = pl.create(deps);
  const finish = (id, report, status = 'x', cost = 0.1, st = 'done') => { const m = runs.get(id).meta; m.status = st; m.report = report; m.reportStatus = status; m.costUsd = cost; m.finishedAt = Date.now(); };
  return { P, runs, started, finish, deps, cancelled };
}
const lastOf = (t, agent) => t.started.filter((s) => s.agent === agent).pop();
const dataText = (s, name) => { const f = (s.extra.dataFiles || []).find((x) => x.name === name); return f ? f.buffer.toString('utf8') : null; };

test('readers: verdict, code change, digests and results', () => {
  assert.equal(pl.staticVerdict(STATIC), 'NEEDS REWORK');
  assert.equal(pl.codeChangeFound(STATIC), false); assert.equal(pl.codeChangeFound(STATIC_CODE), true);
  assert.equal(pl.staticFindingCount(STATIC), 2);
  const d = pl.staticDigest(STATIC, { requirements: true });
  assert.match(d, /Verdict: NEEDS REWORK/); assert.match(d, /## Requirements/); assert.match(d, /Scenarios that did not match/); assert.match(d, /Open questions/);
  assert.doesNotMatch(pl.staticDigest(STATIC), /## Requirements/); assert.ok(pl.staticDigest(STATIC, { cap: 300 }).length <= 300);
  assert.match(pl.whiteboxDigest(WHITEBOX, rf.parseAnalysis), /1\. Off by one[\s\S]*Integrations: event customerLimit/);
  const a = pl.apiItems(API_FAIL, 'BŁĄD', rf.parseReport);
  assert.equal(a.length, 1); assert.match(a[0].detail, /expected: rejected \| got: allowed/);
  assert.deepEqual(pl.uiItems(UI_FAIL).map((i) => i.id), ['ui:a1']); assert.deepEqual(pl.uiItems(UI_OK), []);
  assert.ok(pl.apiProcedure('x'.repeat(20000)).length <= 8000);
});

test('full flow: static -> whitebox -> design -> API and UI in parallel -> confirm -> autotests -> documentation', async () => {
  const t = rig();
  const v = t.P.createCase('DEMO-101', 'details of the task', { ui: true, url: 'https://app.example.com/login', username: 'qa', password: 'pw' });
  assert.equal(t.started.length, 1); assert.equal(t.started[0].agent, 'static');
  assert.match(dataText(t.started[0], 'task.md'), /details of the task/);
  assert.equal(v.stages.api.status, 'pending'); assert.equal(v.stages.ui.status, 'pending');

  t.P.tick(); assert.equal(t.started.length, 1, 'nothing starts while Static runs');
  t.finish('r1', STATIC_CODE, 'STATIC OK', 0.4); t.P.tick();
  const wb = lastOf(t, 'core'); assert.ok(wb, 'the change is in the code, so Whitebox runs');
  assert.match(dataText(wb, 'static-review.md'), /Verdict: NEEDS REWORK/);

  t.finish(wb.id, WHITEBOX, 'RAPORT OK', 0.5); t.P.tick();
  const ds = lastOf(t, 'design');
  assert.match(dataText(ds, 'static-review.md'), /## Requirements/);
  assert.match(dataText(ds, 'whitebox-findings.md'), /Off by one/);

  t.finish(ds.id, DESIGN, 'PROJEKT OK', 0.6); t.P.tick();
  const api = lastOf(t, 'execution'), ui = lastOf(t, 'uitest');
  assert.ok(api && ui, 'both tracks start in the same step');
  assert.match(api.ticket, /ONLY the checks that can be verified with endpoints[\s\S]*TEST DESIGN/);
  assert.match(ui.ticket, /only the checks .* web interface/);
  assert.deepEqual(ui.extra.credentials, { username: 'qa', password: 'pw' }); assert.equal(ui.extra.url, 'https://app.example.com/login');

  t.runs.get(api.id).events.push({ type: 'endpoint', text: 'manager_read_check' });
  t.finish(api.id, API_FAIL, 'BŁĄD', 0.3); t.P.tick(); assert.equal(t.P.get(t.P.list()[0].id).status, 'running', 'waits for the UI track');
  t.finish(ui.id, UI_FAIL, 'FAILED', 0.2); t.P.tick();
  const id = t.P.list()[0].id; let c = t.P.view(t.P.get(id));
  assert.equal(c.status, 'waiting'); assert.equal(c.confirm.items.length, 2);
  assert.equal(c.costUsd, 2.0);
  await assert.rejects(() => t.P.autotests(id, 'api'), /Confirm the results first/);

  c = t.P.act(id, 'confirm', { decisions: { 'api:1': 'defect', 'ui:a1': 'not-defect' }, note: 'checked by hand' });
  assert.equal(c.status, 'done'); assert.deepEqual(c.confirm.items.map((i) => i.decision), ['defect', 'not-defect']);
  assert.equal(t.started.length, 5, 'one run per stage, nothing repeated');

  await t.P.autotests(id, 'api'); await new Promise((r) => setImmediate(r));
  assert.equal(t.deps.atCalls.length, 1); assert.match(t.deps.atCalls[0].note, /Defects confirmed[\s\S]*manager_read_check|Defects confirmed/);
  assert.equal(t.P.get(id).autotests.api.state, 'started');
  await assert.rejects(() => t.P.autotests(id, 'ui'), /fully passed run/);

  const d = t.P.docsDraft(id);
  assert.match(d.markdown, /# Full test: DEMO-101/); assert.match(d.markdown, /Defect: \[API\]/); assert.match(d.markdown, /Not a defect: \[UI\]/); assert.match(d.html, /<h2>Task review/);
  const pub = await t.P.publish(id); assert.equal(pub.url, 'https://c/wiki/9'); assert.equal(t.P.get(id).docs.id, '9');
});

test('gate: a BLOCKED review pauses the case; continue goes on; no change in code means no Whitebox', () => {
  const t = rig();
  t.P.createCase('A task without a ticket key', '', {});
  t.finish('r1', STATIC_BLOCKED, 'STATIC OK'); t.P.tick();
  let c = t.P.view(t.P.get(t.P.list()[0].id));
  assert.equal(c.status, 'paused'); assert.deepEqual(c.pause.actions, ['continue', 'stop']); assert.equal(t.started.length, 1);
  c = t.P.act(c.id, 'continue');
  assert.equal(c.stages.whitebox.status, 'skipped'); assert.equal(t.started.length, 2); assert.equal(t.started[1].agent, 'design', 'no change in the code: straight to the design');
});

test('nothing to run: no environment and no page address means the case ends after the design', () => {
  const t = rig({ avail: { execution: false } });
  const v = t.P.createCase('DEMO-1', '', { ui: false });
  assert.match(v.stages.api.note, /no test environment/); assert.equal(v.stages.ui.status, 'skipped');
  t.finish('r1', STATIC, 'x'); t.P.tick(); t.finish('r2', DESIGN, 'x'); t.P.tick();
  const c = t.P.view(t.P.get(v.id)); assert.equal(c.status, 'done'); assert.equal(c.confirm.auto, true); assert.equal(t.started.length, 2);
});

test('a clean execution needs no confirmation and the whitebox can be switched off', () => {
  const t = rig();
  const v = t.P.createCase('DEMO-2', '', { whitebox: 'skip', ui: true, url: 'https://x.example.com' });
  t.finish('r1', STATIC_CODE, 'x'); t.P.tick(); assert.equal(lastOf(t, 'core'), undefined); t.finish('r2', DESIGN, 'x'); t.P.tick();
  t.finish(lastOf(t, 'execution').id, '**SUKCES** — all good\nReplikacja:\n1. read\n', 'SUKCES'); t.finish(lastOf(t, 'uitest').id, UI_OK, 'VERIFIED'); t.P.tick();
  const c = t.P.view(t.P.get(v.id)); assert.equal(c.status, 'done'); assert.equal(c.confirm.auto, true);
});

test('budget pauses before the next phase; continue allows the next step', () => {
  const t = rig();
  const v = t.P.createCase('DEMO-3', '', { budgetUsd: 1 });
  t.finish('r1', STATIC, 'x', 1.5); t.P.tick();
  let c = t.P.view(t.P.get(v.id)); assert.equal(c.status, 'paused'); assert.match(c.pause.reason, /budget/); assert.equal(t.started.length, 1);
  c = t.P.act(v.id, 'continue'); assert.equal(c.status, 'running'); assert.equal(t.started.length, 2);
});

test('a failed run pauses with retry; retry starts one new run for that stage only; stop cancels what runs', () => {
  const t = rig();
  const v = t.P.createCase('DEMO-4', '', {});
  t.finish('r1', null, null, 0, 'failed'); t.P.tick();
  let c = t.P.view(t.P.get(v.id)); assert.equal(c.status, 'paused'); assert.deepEqual(c.pause.actions, ['retry', 'stop']);
  c = t.P.act(v.id, 'retry'); assert.equal(t.started.length, 2); assert.equal(t.started[1].agent, 'static');
  c = t.P.act(v.id, 'stop'); assert.equal(c.status, 'cancelled'); assert.deepEqual(t.cancelled, ['r2']);
  assert.throws(() => t.P.act(v.id, 'continue'), /Nothing is waiting/);
});

test('state survives a restart; a lost run is reported, not waited for', () => {
  const t = rig();
  const v = t.P.createCase('DEMO-5', '', {});
  const again = pl.create({ ...t.deps, runs: new Map() }); again.load();
  again.tick();
  const c = again.view(again.get(v.id));
  assert.equal(c.status, 'paused'); assert.match(c.stages.static.note, /lost/);
});

test('validation: short task, bad page address', () => {
  const t = rig();
  assert.throws(() => t.P.createCase('ab'), /at least 3/);
  assert.throws(() => t.P.createCase('DEMO-6', '', { ui: true, url: 'ftp://x' }), /http\(s\)/);
  assert.throws(() => t.P.createCase('DEMO-6', '', { ui: true, url: 'https://u:p@x.com' }), /without a user name/);
  assert.throws(() => rig({ avail: { static: false } }).P.createCase('DEMO-6'), /Static cannot run/);
});
