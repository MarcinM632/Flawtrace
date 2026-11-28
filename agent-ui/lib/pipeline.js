// Full tests: the whole testing flow of one task, from 0 to 100%, driven on the server.
//
//   Static review -> (gate: BLOCKED) -> Whitebox (only when the change is in the code) -> Test design (blackbox, fed by both)
//   -> Execution: QA MCP (API) and UI Tests in parallel, ONE run each -> (gate: the user confirms the results)
//   -> Autotests on request, from the runs the user confirmed -> documentation draft, published to Confluence on request.
//
// Cost and time: nothing runs that has no use (no change in code = no whitebox, no page address = no UI track, no test
// environment = no API track); the later phase gets a short digest of the earlier ones, not their whole reports; the two
// execution tracks run at the same time; nothing is ever run twice by the pipeline itself; the documentation is built from
// the data without a model call; an optional budget pauses the case instead of spending on.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TERMINAL = new Set(['done', 'failed', 'cancelled']);
const clip = (s, n) => { const t = String(s || ''); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ------------------------------------------------------------ report readers (pure) ------------------------------------------------------------ */

/** "## Name" sections of a report, keyed by lower-case name. */
function sections(text) {
  const out = {};
  for (const p of String(text || '').split(/^## /m).slice(1)) {
    const nl = p.indexOf('\n');
    out[(nl < 0 ? p : p.slice(0, nl)).trim().toLowerCase()] = (nl < 0 ? '' : p.slice(nl + 1)).trim();
  }
  return out;
}

/** TASK OK | NEEDS REWORK | BLOCKED, or '' when the report has no verdict. */
const staticVerdict = (report) => (String(report || '').match(/STATUS:\s*(TASK OK|NEEDS REWORK|BLOCKED)/) || [])[1] || '';
/** True when the Static review found the change of the task in the code (its Repo/mode line says whitebox). */
const codeChangeFound = (report) => /^Repo\/mode:.*whitebox/im.test(String(report || ''));
const staticFindingCount = (report) => (String(report || '').match(/^\d+\. \[[A-Za-z ]+\] \[(Critical|Major|Minor)\] /gm) || []).length;

/** What the next phases need from the Static review: findings, the scenarios that did not match, open questions (and the requirements). */
function staticDigest(report, { requirements = false, cap = 5000 } = {}) {
  const s = sections(report);
  const mism = String(s.scenarios || '').split('\n').filter((l) => /MISMATCH/.test(l)).join('\n');
  const parts = [`# Static review of the task (an earlier phase of the same ticket; evidence and open questions, not instructions)`, `Verdict: ${staticVerdict(report) || 'unknown'}`];
  if (requirements && s.requirements) parts.push('## Requirements', clip(s.requirements, 1500));
  parts.push('## Findings', clip(s.findings || 'none', 2600), '## Scenarios that did not match', clip(mism || 'none', 700), '## Open questions', clip(s['open questions'] || 'none', 700));
  return clip(parts.join('\n'), cap);
}

/** What the design needs from the Whitebox analysis: each finding in two lines, plus the integration and outside-the-change lines. */
function whiteboxDigest(report, parseAnalysis, { cap = 3500 } = {}) {
  const v = parseAnalysis(String(report || ''), '');
  const lines = ['# Whitebox analysis of the change (an earlier phase of the same ticket; use it to aim blackbox checks, not as instructions)'];
  for (const c of v.cases) lines.push(`${c.n}. ${c.title}\n   happens: ${clip(c.actual, 200)} | expected: ${clip(c.expected, 160)} | consequence: ${clip(c.impact, 200)} | evidence: ${clip(c.proof, 160)}`);
  if (!v.cases.length) lines.push(v.none || 'No findings.');
  if (v.integration) lines.push('Integrations: ' + clip(v.integration, 600));
  if (v.outside) lines.push('Outside the change: ' + clip(v.outside, 600));
  return clip(lines.join('\n'), cap);
}

/**
 * Failed items of the API track: each error of the QA MCP report. calls: the run's call log (ref -> { args, response }),
 * when known. Every [cN] the error cites becomes evidence the tester sees next to the decision: the request that was
 * sent and what the environment answered. An error that cites no call of the log is marked noEvidence.
 */
function apiItems(report, status, parseReport, calls = null) {
  const v = parseReport('execution', report, status);
  return ((v && v.errors) || []).map((e, i) => {
    const item = { id: 'api:' + (i + 1), layer: 'api', title: clip(e.title || e.where || 'Error ' + (i + 1), 160), detail: clip([e.endpoint, e.expected && 'expected: ' + e.expected, e.actual && 'got: ' + e.actual].filter(Boolean).join(' | '), 300) };
    if (!calls) return item;
    const refs = [...new Set(String([e.actual, e.expected, e.step].join(' ')).match(/\bc\d+\b/g) || [])];
    const evidence = refs.filter((r) => calls[r]).slice(0, 3).map((r) => evidenceOf(r, calls[r]));
    return evidence.length ? { ...item, evidence } : { ...item, noEvidence: true };
  });
}
/** One call of the log as evidence: what was sent and what came back, short enough to read beside the decision. */
function evidenceOf(ref, c) {
  const res = c.response || {};
  return {
    ref, endpoint: c.endpoint || '', status: res.status != null ? res.status : null, url: res.url || '',
    request: clip(JSON.stringify(c.args && (c.args.body !== undefined ? c.args.body : c.args.query || c.args.path_params || '') || ''), 400),
    response: clip(c.error ? 'error: ' + c.error : JSON.stringify(res.body === undefined ? null : res.body), 600),
  };
}

/** Failed items of the UI track: every [sN] / [aN] line marked FAIL. */
function uiItems(report) {
  return String(report || '').split('\n').map((l) => l.match(/^\s*\[([sa]\d+)\]\s*FAIL\b[\s—:-]*(.*)$/i)).filter(Boolean)
    .map((m) => ({ id: 'ui:' + m[1], layer: 'ui', title: clip(m[2] || m[1], 160), detail: '' }));
}

/** The task for the API track: the design, restricted to what the qa MCP server can verify. */
function apiProcedure(design) {
  return clip('Execute this test design on the test environment through the qa MCP server. Run ONLY the checks that can be verified with endpoints. '
    + 'A check that needs the web page is not yours: list it as NOT VERIFIABLE VIA MCP and go on. One pass, no repeats.\n\n' + String(design || ''), 8000);
}
/** The task for the UI track: the design, restricted to what is visible on the page. */
function uiProcedure(design) {
  return clip('Verify on the page only the checks of this test design that can be observed in the web interface (visible texts, controls, states, flows). '
    + 'A check that needs an endpoint or the database is not yours: list it under Findings as SKIPPED (API) and go on. One pass, no repeats.\n\n' + String(design || ''), 8000);
}

/* ------------------------------------------------------------ documentation draft (pure) ------------------------------------------------------------ */

/** A small document model, rendered to Markdown (download) and to Confluence storage format (publish). */
function docModel(c, info) {
  const d = [];
  const add = (h, paras = [], bullets = [], table) => d.push({ h, paras: paras.filter(Boolean), bullets: bullets.filter(Boolean), table });
  const st = c.stages;
  add('Summary', [`Full test of ${c.ticket}, started ${new Date(c.createdAt).toISOString().slice(0, 16).replace('T', ' ')}.`], [],
    [['Static review', st.static.note || st.static.status], ['Whitebox', st.whitebox.note || st.whitebox.status], ['Test design', st.design.note || st.design.status], ['API execution (QA MCP)', st.api.note || st.api.status], ['UI execution', st.ui.note || st.ui.status]]);
  if (info.static) add('Task review (static testing)', [`Verdict: ${info.static.verdict || 'unknown'}.`], info.static.findings, null);
  if (info.static && info.static.open.length) add('Open questions to the author of the task', [], info.static.open);
  if (info.whitebox) add('Whitebox analysis of the change', [], info.whitebox);
  if (info.design) add('Test design', ['Points of the blackbox design that was executed:'], info.design);
  if (c.confirm.status === 'done') {
    const defects = c.confirm.items.filter((i) => i.decision === 'defect').map((i) => `[${i.layer.toUpperCase()}] ${i.title}${i.detail ? ' (' + i.detail + ')' : ''}`);
    const noise = c.confirm.items.filter((i) => i.decision === 'not-defect').map((i) => `[${i.layer.toUpperCase()}] ${i.title}`);
    add('Results confirmed by the tester', [c.confirm.auto ? 'Nothing failed, so nothing needed confirmation.' : '', c.confirm.note ? 'Tester note: ' + c.confirm.note : ''],
      [...defects.map((x) => 'Defect: ' + x), ...noise.map((x) => 'Not a defect: ' + x)]);
  }
  const at = c.autotests || {};
  const atRows = ['api', 'ui'].filter((k) => at[k]).map((k) => `${k.toUpperCase()}: ${at[k].state}${at[k].runId ? ' (run ' + at[k].runId + ')' : ''}${at[k].error ? ', ' + at[k].error : ''}`);
  add('Automated tests', [atRows.length ? '' : 'No autotests were created from this flow.'], atRows);
  return d;
}
function docMarkdown(title, model) {
  const out = ['# ' + title, ''];
  for (const s of model) {
    out.push('## ' + s.h, '');
    s.paras.forEach((p) => out.push(p, ''));
    if (s.table) { out.push('| Phase | Outcome |', '| --- | --- |'); s.table.forEach(([a, b]) => out.push(`| ${a} | ${String(b).replace(/\|/g, '/')} |`)); out.push(''); }
    s.bullets.forEach((b) => out.push('- ' + b));
    if (s.bullets.length) out.push('');
  }
  return out.join('\n');
}
function docHtml(model) {
  return model.map((s) => `<h2>${esc(s.h)}</h2>` + s.paras.map((p) => `<p>${esc(p)}</p>`).join('')
    + (s.table ? '<table><tbody>' + s.table.map(([a, b]) => `<tr><th>${esc(a)}</th><td>${esc(b)}</td></tr>`).join('') + '</tbody></table>' : '')
    + (s.bullets.length ? '<ul>' + s.bullets.map((b) => `<li>${esc(b)}</li>`).join('') + '</ul>' : '')).join('');
}

/* ------------------------------------------------------------ the engine ------------------------------------------------------------ */

const STAGE_KEYS = ['static', 'whitebox', 'design', 'api', 'ui'];
const newStage = (status = 'pending', note = '') => ({ status, note, runId: null, startedAt: 0, finishedAt: 0, costUsd: 0 });

/**
 * deps: { dir, runs, AGENTS, agentAvailable, startRun, autotestsFromRun, persistRun, uiTest, sources, parseAnalysis, parseDesign, parseReport, cancelRun, now? }
 * Everything the engine touches from the app comes through deps, so tests can drive it without agents.
 */
function create(deps) {
  const { dir, runs, AGENTS, startRun, parseAnalysis, parseReport } = deps;
  const now = deps.now || Date.now;
  const cases = new Map();
  const creds = new Map(); // caseId -> { username, password }: only in memory, never on disk
  let timer = null;
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* created on first save */ }

  const file = (id) => path.join(dir, id + '.json');
  const save = (c) => { c.updatedAt = now(); try { fs.writeFileSync(file(c.id), JSON.stringify(c)); } catch (_) { /* the case stays in memory */ } };
  function load() {
    let names = []; try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')); } catch (_) { return; }
    for (const n of names) { try { const c = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); if (c && c.id) { for (const a of Object.values(c.autotests || {})) if (a.state === 'writing') { a.state = 'failed'; a.error = 'interrupted by a restart'; } cases.set(c.id, c); } } catch (_) { /* skip a damaged file */ } }
  }

  const runMeta = (id) => { const r = id && runs.get(id); return r ? r.meta : null; };
  const available = (key) => { const a = AGENTS[key]; return !!a && deps.agentAvailable(a); };

  /** Creates a case and starts it. opts: { whitebox: 'auto'|'skip', family: 'core'|'svc'|'mcp', api, ui, url, budgetUsd, username, password } */
  function createCase(task, details, opts = {}) {
    const raw = String(task || '').trim();
    if (raw.length < 3) throw Object.assign(new Error('Enter a ticket key or a task description (at least 3 characters).'), { status: 400 });
    // Which phases to run. `opts.stages` is { static, whitebox, design, api, ui } of booleans; the older flat options still work.
    const want = { static: true, whitebox: opts.whitebox !== 'skip', design: true, api: opts.api !== false, ui: !!opts.ui };
    if (opts.stages && typeof opts.stages === 'object') for (const k of STAGE_KEYS) if (opts.stages[k] !== undefined) want[k] = !!opts.stages[k];
    if (!STAGE_KEYS.some((k) => want[k])) throw Object.assign(new Error('Choose at least one phase to run.'), { status: 400 });
    if (want.static && !available('static')) throw Object.assign(new Error('Static cannot run: no CLAUDE.md for it. Check the agents folder.'), { status: 409 });
    if (want.design && !available('design')) throw Object.assign(new Error('Test design cannot run: no CLAUDE.md for it. Check the agents folder.'), { status: 409 });
    const family = ['core', 'svc', 'mcp'].includes(opts.family) ? opts.family : 'core';
    let url = '';
    if (want.ui && String(opts.url || '').trim()) {
      let u; try { u = new URL(String(opts.url).trim()); } catch (_) { throw Object.assign(new Error('The page address is not valid. Use https://host/path.'), { status: 400 }); }
      if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw Object.assign(new Error('Use an http(s) address without a user name or password in it.'), { status: 400 });
      url = u.href;
    }
    const id = new Date(now()).toISOString().replace(/[-:T.Z]/g, '').slice(0, 14) + '-' + crypto.randomBytes(2).toString('hex');
    const short = raw.length > 300 ? raw.slice(0, 299) + '…' : raw;
    const longText = [raw.length > 300 ? raw : '', String(details || '').trim()].filter(Boolean).join('\n\n');
    const c = {
      id, ticket: short, taskText: longText, createdAt: now(), updatedAt: now(), status: 'running', pause: null,
      options: { whitebox: want.whitebox ? 'auto' : 'skip', family, api: want.api, ui: want.ui, static: want.static, design: want.design, url, budgetUsd: Math.max(0, Number(opts.budgetUsd) || 0) },
      stages: { static: newStage(), whitebox: newStage(), design: newStage(), api: newStage(), ui: newStage() },
      ack: { static: false, budget: 0 }, costUsd: 0,
      confirm: { status: 'pending', items: [], note: '', auto: false },
      autotests: {}, docs: null,
    };
    // Tracks that cannot run are known now: say so, so the user sees the plan before anything is spent.
    if (!c.options.api) c.stages.api = newStage('skipped', 'switched off');
    else if (!available('execution')) c.stages.api = newStage('skipped', 'no test environment connected under Sources');
    if (!c.options.ui) c.stages.ui = newStage('skipped', 'switched off');
    else if (!url) c.stages.ui = newStage('skipped', 'no page address given');
    else if (!available('uitest')) c.stages.ui = newStage('skipped', 'UI Tests is not available');
    if (c.options.whitebox === 'skip') c.stages.whitebox = newStage('skipped', 'switched off');
    if (!want.static) c.stages.static = newStage('skipped', 'not selected');
    if (!want.design) c.stages.design = newStage('skipped', 'not selected');
    if (url && (opts.username || opts.password)) creds.set(id, { username: String(opts.username || '').slice(0, 200), password: String(opts.password || '').slice(0, 200) });
    cases.set(id, c); save(c);
    advance(c);
    return view(c);
  }

  function begin(c, key, agentKey, ticketText, extra = {}) {
    const s = c.stages[key];
    try {
      const m = startRun(agentKey, ticketText, '', { source: 'fulltest:' + c.id, ...extra });
      s.runId = m.id; s.status = 'running'; s.startedAt = now(); s.note = '';
    } catch (e) { s.status = 'failed'; s.note = 'Could not start: ' + clip((e && e.message) || e, 200); s.finishedAt = now(); }
  }
  const files = (...f) => f.filter((x) => x && x.text).map((x) => ({ name: x.name, buffer: Buffer.from(x.text, 'utf8'), binary: false }));
  const taskFile = (c) => c.taskText ? { name: 'task.md', text: '# The full task text (data from the tester)\n\n' + c.taskText } : null;

  /** Pulls the state of the runs behind the stages into the case. */
  function refresh(c) {
    let cost = 0;
    for (const k of STAGE_KEYS) {
      const s = c.stages[k];
      if (s.runId) {
        const m = runMeta(s.runId);
        if (!m) { if (s.status === 'running') { s.status = 'failed'; s.note = 'The run was lost (the server restarted).'; s.finishedAt = now(); } }
        else {
          s.costUsd = m.costUsd || 0;
          if (s.status === 'running' && m.status !== 'running') {
            s.finishedAt = m.finishedAt || now();
            s.status = m.status === 'done' ? 'done' : m.status === 'cancelled' ? 'cancelled' : 'failed';
            if (s.status !== 'done') s.note = clip(m.error || m.status, 200);
          }
        }
      }
      cost += s.costUsd || 0;
    }
    c.costUsd = cost;
  }
  const report = (c, k) => { const m = runMeta(c.stages[k].runId); return m ? String(m.report || '') : ''; };
  const usable = (m) => !!m && !!m.report && !/PRZERWANO/i.test(m.reportStatus || '');

  const pause = (c, stage, reason, actions) => { c.status = 'paused'; c.pause = { stage, reason, actions }; };
  const overBudget = (c) => c.options.budgetUsd > 0 && c.costUsd >= c.options.budgetUsd + (c.ack.budget || 0);

  /** One step of the state machine. Idempotent: calling it twice changes nothing the second time. */
  function advance(c) {
    if (TERMINAL.has(c.status) || c.status === 'waiting') return;
    refresh(c);
    if (c.status === 'paused') { save(c); return; }
    const st = c.stages;

    // 1. Static review (optional: when it is not selected, the later phases work from the task text alone).
    let sm = null;
    if (st.static.status === 'skipped') {
      if (!c.static) c.static = { verdict: '', findings: 0, codeChange: c.options.whitebox !== 'skip', skipped: true };
    } else {
      if (st.static.status === 'pending') {
        if (overBudget(c)) { pause(c, 'static', 'The budget is used up.', ['continue', 'stop']); save(c); return; }
        begin(c, 'static', 'static', c.ticket, { dataFiles: files(taskFile(c)) });
      }
      if (st.static.status === 'running') { save(c); return; }
      if (st.static.status !== 'done') { pause(c, 'static', 'Static review ' + st.static.status + (st.static.note ? ': ' + st.static.note : '') + '.', ['retry', 'stop']); save(c); return; }
      sm = runMeta(st.static.runId);
      if (!usable(sm)) { st.static.status = 'failed'; st.static.note = 'The review found no basis to work on.'; pause(c, 'static', st.static.note, ['retry', 'stop']); save(c); return; }
      if (!c.static) {
        const verdict = staticVerdict(sm.report);
        c.static = { verdict, findings: staticFindingCount(sm.report), codeChange: codeChangeFound(sm.report) };
        st.static.note = `${verdict || 'no verdict'}, ${c.static.findings} finding(s)`;
      }
      if (c.static.verdict === 'BLOCKED' && !c.ack.static) {
        pause(c, 'static', 'The review says the task cannot be built as written (BLOCKED). Testing it further may be wasted. Read the findings, then continue or stop.', ['continue', 'stop']); save(c); return;
      }
    }

    // 2. Whitebox: only when the change exists in the code.
    if (st.whitebox.status === 'pending') {
      if (!c.static.codeChange) { st.whitebox.status = 'skipped'; st.whitebox.note = 'no change of this task in the code yet'; }
      else if (!available(c.options.family)) { st.whitebox.status = 'skipped'; st.whitebox.note = 'the Analyses agent is not available'; }
      else if (overBudget(c)) { pause(c, 'whitebox', 'The budget is used up.', ['continue', 'stop']); save(c); return; }
      else begin(c, 'whitebox', c.options.family, c.ticket, { dataFiles: files(sm ? { name: 'static-review.md', text: staticDigest(sm.report) + '\n\nVerify the findings that concern the change against the diff, and do not map the existing logic again: the review above did.' } : null, taskFile(c)) });
    }
    if (st.whitebox.status === 'running') { save(c); return; }
    if ((st.whitebox.status === 'failed' || st.whitebox.status === 'cancelled') && !/design goes on/.test(st.whitebox.note)) st.whitebox.note = (st.whitebox.note || 'did not finish') + '; the design goes on without it';

    // 3. Test design (blackbox), fed by both digests. Optional: without it the execution tracks work from the task itself.
    let dm = null;
    if (st.design.status !== 'skipped') {
      if (st.design.status === 'pending') {
        if (overBudget(c)) { pause(c, 'design', 'The budget is used up.', ['continue', 'stop']); save(c); return; }
        const wm = runMeta(st.whitebox.runId);
        begin(c, 'design', 'design', c.ticket, { dataFiles: files(
          sm ? { name: 'static-review.md', text: staticDigest(sm.report, { requirements: true }) } : null,
          wm && usable(wm) ? { name: 'whitebox-findings.md', text: whiteboxDigest(wm.report, parseAnalysis) } : null,
          taskFile(c)) });
      }
      if (st.design.status === 'running') { save(c); return; }
      if (st.design.status !== 'done') { pause(c, 'design', 'Test design ' + st.design.status + (st.design.note ? ': ' + st.design.note : '') + '.', ['retry', 'stop']); save(c); return; }
      dm = runMeta(st.design.runId);
      if (!usable(dm)) { st.design.status = 'failed'; st.design.note = 'The design returned no report.'; pause(c, 'design', st.design.note, ['retry', 'stop']); save(c); return; }
      if (!st.design.note) st.design.note = `${(String(dm.report).match(/^## \d+\./gm) || []).length} point(s)`;
    }
    // What the execution tracks verify: the design, or (when the design was not selected) the task text itself.
    const plan = dm ? dm.report : ['# The task to verify (no test design was selected: derive the checks from this)', c.ticket, c.taskText, sm ? staticDigest(sm.report, { requirements: true }) : ''].filter(Boolean).join('\n\n');

    // 4. Execution: both tracks together, one run each.
    if (st.api.status === 'pending' || st.ui.status === 'pending') {
      if (overBudget(c)) { pause(c, 'execute', 'The budget is used up.', ['continue', 'stop']); save(c); return; }
      if (st.api.status === 'pending') begin(c, 'api', 'execution', apiProcedure(plan));
      if (st.ui.status === 'pending') {
        const cr = creds.get(c.id);
        begin(c, 'ui', 'uitest', uiProcedure(plan), { url: c.options.url, ...(cr ? { credentials: cr } : {}) });
      }
    }
    if (st.api.status === 'running' || st.ui.status === 'running') { save(c); return; }

    // 5. The user confirms what the tracks found.
    if (c.confirm.status === 'pending') {
      const am = runMeta(st.api.runId), um = runMeta(st.ui.runId);
      const calls = am && deps.callsOf ? deps.callsOf(am.id) : null;
      const items = [...(am && am.report ? apiItems(am.report, am.reportStatus, parseReport, calls) : []), ...(um && um.report ? uiItems(um.report).map((i) => ({ ...i, runId: um.id })) : [])];
      const broken = ['api', 'ui'].filter((k) => st[k].status === 'failed' || st[k].status === 'cancelled');
      st.api.note = st.api.note || (am ? `${am.reportStatus || am.status}, ${items.filter((i) => i.layer === 'api').length} error(s)` : '');
      st.ui.note = st.ui.note || (um ? `${um.reportStatus || um.status}, ${items.filter((i) => i.layer === 'ui').length} failed` : '');
      c.confirm.items = items.map((i) => ({ ...i, decision: '' }));
      if (!items.length && !broken.length) { c.confirm.status = 'done'; c.confirm.auto = true; }
      else { c.confirm.status = 'waiting'; c.status = 'waiting'; save(c); return; }
    }
    c.status = 'done'; save(c);
  }

  /* ---- user actions ---- */
  function get(id) { const c = cases.get(id); if (!c) throw Object.assign(new Error('Not found'), { status: 404 }); return c; }

  function act(id, action, b = {}) {
    const c = get(id);
    if (action === 'stop') { stopCase(c); return view(c); }
    if (action === 'continue') {
      if (c.status !== 'paused') throw Object.assign(new Error('Nothing is waiting for a decision.'), { status: 409 });
      if (c.pause && c.pause.stage === 'static' && c.static) c.ack.static = true;
      if (c.pause && /budget/i.test(c.pause.reason)) c.ack.budget = (c.ack.budget || 0) + (c.options.budgetUsd || 0);
      c.status = 'running'; c.pause = null; advance(c); return view(c);
    }
    if (action === 'retry') {
      if (c.status !== 'paused' || !c.pause || !['static', 'design', 'whitebox', 'execute'].includes(c.pause.stage)) throw Object.assign(new Error('Nothing to retry.'), { status: 409 });
      const keys = c.pause.stage === 'execute' ? ['api', 'ui'] : [c.pause.stage];
      for (const k of keys) if (['failed', 'cancelled'].includes(c.stages[k].status)) c.stages[k] = newStage();
      if (c.pause.stage === 'static') c.static = null;
      if (b.username || b.password) creds.set(c.id, { username: String(b.username || '').slice(0, 200), password: String(b.password || '').slice(0, 200) });
      c.status = 'running'; c.pause = null; advance(c); return view(c);
    }
    if (action === 'confirm') {
      if (c.status !== 'waiting') throw Object.assign(new Error('There is nothing to confirm now.'), { status: 409 });
      const dec = (b.decisions && typeof b.decisions === 'object') ? b.decisions : {};
      c.confirm.items.forEach((i) => { i.decision = dec[i.id] === 'not-defect' ? 'not-defect' : 'defect'; });
      c.confirm.note = clip(b.note, 1000); c.confirm.status = 'done'; c.status = 'done'; save(c);
      // What the tester decided is kept for the next runs (confirmed defects, false alarms).
      if (deps.lessons) { try { deps.lessons.record({ ticket: c.ticket, items: c.confirm.items, note: c.confirm.note }); } catch (_) { /* a lesson is never worth failing the confirmation */ } }
      return view(c);
    }
    throw Object.assign(new Error('Unknown action'), { status: 400 });
  }

  function stopCase(c) {
    for (const k of STAGE_KEYS) {
      const s = c.stages[k];
      if (s.status === 'running') { const r = runs.get(s.runId); if (r && deps.cancelRun) deps.cancelRun(r); s.status = 'cancelled'; s.note = 'stopped'; s.finishedAt = now(); }
    }
    c.status = 'cancelled'; c.pause = null; save(c);
  }

  /** Autotests from the runs the user confirmed. Never automatic: the user presses the button per layer. */
  async function autotests(id, layer, comment = '') {
    const c = get(id);
    if (!['api', 'ui'].includes(layer)) throw Object.assign(new Error('Unknown layer'), { status: 400 });
    if (c.confirm.status !== 'done') throw Object.assign(new Error('Confirm the results first: autotests are written only from confirmed runs.'), { status: 409 });
    if (c.autotests[layer] && ['writing', 'started'].includes(c.autotests[layer].state)) throw Object.assign(new Error('Autotests for this layer are already being written.'), { status: 409 });
    const s = c.stages[layer];
    const src = s.runId && runs.get(s.runId);
    if (!src || s.status !== 'done') throw Object.assign(new Error(`The ${layer.toUpperCase()} track has no finished run to build tests from.`), { status: 409 });
    if (!available('autotest')) throw Object.assign(new Error('Autotests is not available: no autotests/ repository with a README.md.'), { status: 409 });
    const defects = c.confirm.items.filter((i) => i.layer === layer && i.decision === 'defect').map((i) => i.title);
    const notDefects = c.confirm.items.filter((i) => i.layer === layer && i.decision === 'not-defect').map((i) => i.title);
    const note = [
      defects.length ? `Defects confirmed by the tester (the tests must assert the CORRECT behaviour and are expected to fail until the defect is fixed): ${defects.join('; ')}.` : '',
      notDefects.length ? `The tester judged these results as not defects, so do not write tests that fail on them: ${notDefects.join('; ')}.` : '',
      c.confirm.note ? 'Tester note: ' + c.confirm.note : '', comment,
    ].filter(Boolean).join(' ');
    if (layer === 'api') {
      if (!src.events.some((e) => e.type === 'endpoint')) throw Object.assign(new Error('The API run called no endpoints, so there is no flow to turn into tests.'), { status: 409 });
      c.autotests.api = { state: 'writing', runId: null, error: '', at: now() }; save(c);
      deps.autotestsFromRun(src, note, 'api').then((m) => { c.autotests.api = { ...c.autotests.api, state: 'started', runId: m.id }; save(c); },
        (e) => { c.autotests.api = { ...c.autotests.api, state: 'failed', error: clip((e && e.message) || e, 200) }; save(c); });
      return view(c);
    }
    const blocker = deps.uiTest.acceptBlocker(src.meta);
    if (blocker) throw Object.assign(new Error('UI autotests are written only from a fully passed run. ' + blocker), { status: 409 });
    const m = startRun('autotest', String(src.meta.ticket).slice(0, 300), note, { stack: 'ts-playwright', url: src.meta.url, source: src.meta.id, flow: deps.uiTest.buildFlow(src.meta, src.events) });
    src.meta.accepted = { at: now(), testRun: m.id }; if (deps.persistRun) deps.persistRun(src);
    c.autotests.ui = { state: 'started', runId: m.id, error: '', at: now() }; save(c);
    return view(c);
  }

  /** The documentation built from the data, with no model call. */
  function docsDraft(id) {
    const c = get(id);
    const sm = runMeta(c.stages.static.runId), wm = runMeta(c.stages.whitebox.runId), dm = runMeta(c.stages.design.runId);
    const info = {};
    if (sm && sm.report) {
      const s = sections(sm.report);
      info.static = { verdict: staticVerdict(sm.report), findings: (s.findings || '').split('\n').filter((l) => /^\d+\. \[/.test(l)).map((l) => l.replace(/^\d+\.\s*/, '')), open: (s['open questions'] || '').split('\n').filter((l) => /^- /.test(l)).map((l) => l.slice(2)) };
    }
    if (wm && wm.report) { const v = parseAnalysis(wm.report, ''); info.whitebox = v.cases.length ? v.cases.map((x) => `${x.title}${x.proof ? ' (' + x.proof + ')' : ''}`) : [v.none || 'No findings.']; }
    if (dm && dm.report) info.design = String(dm.report).split('\n').filter((l) => /^## \d+\./.test(l)).map((l) => l.replace(/^## \d+\.\s*/, ''));
    const model = docModel(c, info);
    const title = `Full test: ${clip(c.ticket, 120)}`;
    const target = deps.sources ? deps.sources.confluencePublishTarget() : { ready: false, reason: 'Confluence is not available.' };
    return { title, markdown: docMarkdown(title, model), html: docHtml(model), publish: { ready: target.ready, reason: target.reason, space: target.space || '' }, published: c.docs };
  }

  async function publish(id) {
    const c = get(id);
    const d = docsDraft(id);
    if (!d.publish.ready) throw Object.assign(new Error(d.publish.reason), { status: 409 });
    try {
      const r = await deps.sources.confluencePublish({ title: d.title, html: d.html });
      c.docs = { url: r.url, id: r.id, created: r.created, at: now() }; save(c);
      return c.docs;
    } catch (e) { throw Object.assign(new Error((e && e.message) || 'Publishing failed'), { status: 502 }); }
  }

  /* ---- views ---- */
  function view(c) {
    refresh(c);
    return {
      id: c.id, ticket: c.ticket, status: c.status, pause: c.pause, createdAt: c.createdAt, updatedAt: c.updatedAt, options: { ...c.options },
      costUsd: Math.round(c.costUsd * 1e4) / 1e4, stages: c.stages, static: c.static || null, confirm: c.confirm, autotests: c.autotests, docs: c.docs,
      hasLogin: creds.has(c.id),
    };
  }
  const list = () => [...cases.values()].sort((a, b) => b.createdAt - a.createdAt).map((c) => { const v = view(c); return { id: v.id, ticket: v.ticket, status: v.status, createdAt: v.createdAt, costUsd: v.costUsd, stage: currentStage(c) }; });
  function currentStage(c) {
    if (c.status === 'done') return 'done';
    for (const k of STAGE_KEYS) if (['running', 'pending'].includes(c.stages[k].status)) return k;
    return c.status === 'waiting' ? 'confirm' : '';
  }

  function tick() { for (const c of cases.values()) if (c.status === 'running') { try { advance(c); } catch (e) { pause(c, 'internal', 'Internal error: ' + clip((e && e.message) || e, 200), ['stop']); save(c); } } }
  function start(intervalMs = 3000) { load(); if (!timer) { timer = setInterval(tick, intervalMs); if (timer.unref) timer.unref(); } tick(); }
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

  return { createCase, advance, tick, act, autotests, docsDraft, publish, get, view, list, start, stopTimer, load, cases };
}

module.exports = { create, sections, staticVerdict, codeChangeFound, staticFindingCount, staticDigest, whiteboxDigest, apiItems, uiItems, apiProcedure, uiProcedure, docModel, docMarkdown, docHtml };
