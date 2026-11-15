// Repair of a failing UI test, with the user in control.
// A test that passed when the page was verified now fails. The agent reads what Playwright recorded at the failure
// (error and page snapshot) and the verified report, and decides per test:
//   SELECTOR - the page still offers the same thing under another role or name: the locator in a page object is outdated.
//   APP_BUG  - a fact from the verified report is no longer true on the page: a possible defect, the test is NOT touched.
//   UNCLEAR  - not enough evidence: nothing is touched.
// The agent edits a COPY of the project; the app computes the diff itself, lets only page objects through, refuses
// sleeps and forced clicks, runs the patched copy to prove it works, and changes the real project only on the user's click.
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { MODEL } = require('./config');
const { persist, runs } = require('./store');
const { CONFIG_SOURCE, exec, parseResults, testEnv } = require('./ui-run');

const FOLDER = 'ts-playwright';
const ALLOWED = /^pages\/(?:[\w-]+\/)*[\w-]+\.ts$/;       // only page objects may change; no dots in folder names, so no ../
const FORBIDDEN = /waitForTimeout|setTimeout|\bsleep\(|force:\s*true|networkidle|page\.pause/;
const FIX_MS = 10 * 60000;
const active = new Set();
// Generated folders and the helper files the app writes for the agent: they are not part of the project and never part of a patch.
const SKIP = ['node_modules', 'test-results', 'playwright-report', 'flawtrace-report', 'flawtrace-results.json', 'playwright', 'evidence', 'failures.md', 'verified-report.md'];

const httpErr = (code, message) => Object.assign(new Error(message), { code });
const dirs = (meta) => { const work = path.dirname(meta.staging.dir); return { work, run: path.join(work, 'ts-run'), fix: path.join(work, 'ts-fix'), verify: path.join(work, 'ts-fix-run') }; };

const FIX_SYSTEM = `APP MODE: UI TEST REPAIR (overrides everything else in this session)

ROLE
A Playwright UI test that passed when the page was verified now fails. For each failing test you decide whether the TEST is
outdated or the APP changed. You fix only the first kind. The user reads your verdict and a diff before anything is applied.

FILES IN THE CURRENT FOLDER
- verified-report.md: what was verified on the page. It is the truth about the expected behaviour.
- failures.md: every failing test with its error and the folder of its evidence.
- evidence/<n>/error-context.md: the error and the page snapshot (accessibility tree) at the moment of the failure.
- the test project: pages/*.ts (page objects), tests/*.ts, fixtures, utils.

CLASSES (one per failing test)
- SELECTOR: the snapshot shows the same thing the verified report describes (same text, same function) under another role,
  name, label or structure, so only the locator is outdated. Fix: edit the locator in the page object.
- APP_BUG: a fact from the verified report is no longer true in the snapshot (the text, the URL, the state, the element is
  gone and nothing equivalent is there). Do NOT edit anything for it. It is a possible defect and the user must see it.
- UNCLEAR: the snapshot does not show enough, or the failure is a login problem, a timeout with an empty page, or an
  environment error. Do NOT edit anything for it.

RULES FOR EDITS
1. Edit only files in pages/. Never change tests, fixtures, config, expected texts, URLs, counts or any assertion.
2. Change a locator only when you can quote the replacement element from the snapshot. Do not guess.
3. Prefer getByRole, getByLabel, getByTestId. Never add sleeps, waitForTimeout, networkidle waits or force: true.
4. If the same page object serves a SELECTOR test and an APP_BUG test, change only what the SELECTOR test needs.
5. If you edit nothing, that is a valid answer.

FINAL ANSWER: only this block, one object per failing test, the test name exactly as in failures.md.
FIX_RESULT_JSON
[{"test":"...","class":"SELECTOR|APP_BUG|UNCLEAR","why":"one or two plain sentences","evidence":"an exact quote from the error or the snapshot"}]
END_FIX_RESULT_JSON`;

/** The verdicts from the agent's final text; [] when the block is missing or broken. */
function parseVerdicts(text) {
  const m = String(text || '').match(/FIX_RESULT_JSON\s*([\s\S]*?)\s*END_FIX_RESULT_JSON/);
  if (!m) return [];
  let arr; try { arr = JSON.parse(m[1].replace(/^```(?:json)?|```$/gm, '').trim()); } catch (_) { return []; }
  if (!Array.isArray(arr)) return [];
  return arr.filter((v) => v && typeof v.test === 'string' && ['SELECTOR', 'APP_BUG', 'UNCLEAR'].includes(v.class))
    .map((v) => ({ test: v.test.slice(0, 300), class: v.class, why: String(v.why || '').slice(0, 600), evidence: String(v.evidence || '').slice(0, 600) }));
}

/** All files under a folder (relative, forward slashes), skipping generated folders. */
function walk(root, skip = SKIP) {
  const out = [];
  const rec = (dir) => {
    let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      if (skip.includes(e.name) && dir === root) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) rec(p); else out.push(path.relative(root, p).split(path.sep).join('/'));
    }
  };
  rec(root);
  return out;
}

/** Unified diff of one file, made by git (the app needs it anyway). Empty when equal. */
function fileDiff(rel, oldFile, newFile) {
  const a = fs.existsSync(oldFile) ? oldFile : (process.platform === 'win32' ? 'NUL' : '/dev/null');
  const r = spawnSync('git', ['diff', '--no-index', '--no-color', '-U3', '--', a, newFile], { encoding: 'utf8', windowsHide: true });
  const text = String(r.stdout || '');
  const at = text.indexOf('@@');
  return at < 0 ? '' : text.slice(at).slice(0, 8000);
}

/** What changed between the project and the agent's copy, and which of it may go through. */
function reviewPatch(origRoot, newRoot, verdicts) {
  const files = [];
  for (const rel of walk(newRoot)) {
    const o = path.join(origRoot, rel), n = path.join(newRoot, rel);
    if (fs.existsSync(o) && fs.readFileSync(o, 'utf8') === fs.readFileSync(n, 'utf8')) continue;
    const diff = fileDiff(rel, o, n);
    let problem = '';
    if (!ALLOWED.test(rel)) problem = 'Only page objects (pages/*.ts) may change. This file is left alone.';
    else if (!fs.existsSync(o)) problem = 'New files are not part of a repair.';
    else {
      const added = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n');
      const bad = added.match(FORBIDDEN);
      if (bad) problem = `The patch adds "${bad[0]}", which makes a test slow or hides a real problem.`;
    }
    files.push({ path: rel, diff, problem });
  }
  const hasSelector = (verdicts || []).some((v) => v.class === 'SELECTOR');
  if (!hasSelector) for (const f of files) f.problem = f.problem || 'No test was judged to have an outdated locator, so this change is not wanted.';
  return files;
}

function startFix(r, creds) {
  const m = r.meta;
  if (m.agent !== 'autotest' || m.stack !== 'ts-playwright') throw httpErr(400, 'Only a TypeScript Playwright project can be repaired here.');
  const tr = m.testRun;
  if (!tr || tr.state !== 'failed' || !tr.stats || !tr.stats.failed) throw httpErr(409, 'There is no failing test run to analyse. Run the test first.');
  if (!m.staging || !fs.existsSync(path.join(m.staging.dir, FOLDER))) throw httpErr(410, 'The staged project is gone.');
  if (active.has(m.id)) throw httpErr(409, 'The analysis is already running.');
  const d = dirs(m);
  const tf = m.testFix = { state: 'analyzing', startedAt: Date.now(), finishedAt: null, verdicts: [], files: [], verify: null, costUsd: null, error: null };
  active.add(m.id);
  const set = (state) => { tf.state = state; persist(r); };

  (async () => {
    try {
      // 1. The agent's workspace: a copy of the project, the verified report and the evidence of every failure.
      fs.rmSync(d.fix, { recursive: true, force: true });
      fs.mkdirSync(d.fix, { recursive: true });
      const project = path.join(m.staging.dir, FOLDER);
      for (const f of fs.readdirSync(project)) if (!SKIP.includes(f)) fs.cpSync(path.join(project, f), path.join(d.fix, f), { recursive: true });
      const src = m.source && runs.get(m.source);
      fs.writeFileSync(path.join(d.fix, 'verified-report.md'), (src && src.meta.report) || '(the verified report is not available)');
      const failing = (tr.tests || []).filter((t) => t.status === 'unexpected');
      const results = path.join(d.run, 'test-results');
      const evid = [];
      let n = 0;
      for (const dir of fs.existsSync(results) ? fs.readdirSync(results) : []) {
        const f = path.join(results, dir, 'error-context.md');
        if (!fs.existsSync(f)) continue;
        n++;
        fs.mkdirSync(path.join(d.fix, 'evidence', String(n)), { recursive: true });
        fs.writeFileSync(path.join(d.fix, 'evidence', String(n), 'error-context.md'), fs.readFileSync(f, 'utf8').slice(0, 12000));
        evid.push({ n, dir });
      }
      fs.writeFileSync(path.join(d.fix, 'failures.md'), '# Failing tests\n\n' + failing.map((t, i) => `## ${t.title}\nFile: ${t.file}\nError:\n${t.error || '(none)'}\n`).join('\n')
        + '\n# Evidence folders\n' + (evid.map((e) => `- evidence/${e.n}/error-context.md (test-results folder: ${e.dir})`).join('\n') || '(no snapshots were recorded)') + '\n');

      // 2. The agent edits the copy.
      const out = await runClaude(d.fix, 'Analyse the failing tests in failures.md as the system prompt says and return the result block.', tf);
      if (!out.ok) { tf.error = out.error; return set('error'); }
      tf.verdicts = parseVerdicts(out.text);
      if (!tf.verdicts.length) { tf.error = 'The agent returned no verdicts in the required format.'; return set('error'); }

      // 3. The app, not the agent, decides what may go through.
      tf.files = reviewPatch(project, d.fix, tf.verdicts);
      const good = tf.files.filter((f) => !f.problem);

      // 4. Prove the patch: run the patched copy on the page. Needs the login again, because it is never stored.
      if (good.length && creds && fs.existsSync(path.join(d.run, 'node_modules'))) {
        set('verifying');
        fs.rmSync(d.verify, { recursive: true, force: true });
        fs.mkdirSync(d.verify, { recursive: true });
        for (const f of fs.readdirSync(d.run)) if (!['test-results', 'flawtrace-report', 'flawtrace-results.json', 'playwright'].includes(f)) fs.cpSync(path.join(d.run, f), path.join(d.verify, f), { recursive: true });
        for (const f of good) fs.copyFileSync(path.join(d.fix, f.path), path.join(d.verify, f.path));
        fs.writeFileSync(path.join(d.verify, 'flawtrace.config.ts'), CONFIG_SOURCE);
        const t = await exec('npx', ['playwright', 'test', '-c', 'flawtrace.config.ts'], { cwd: d.verify, env: testEnv(m, creds), ms: 8 * 60000, onData: () => {} });
        let parsed = null;
        try { parsed = parseResults(JSON.parse(fs.readFileSync(path.join(d.verify, 'flawtrace-results.json'), 'utf8'))); } catch (_) { /* did not run */ }
        tf.verify = parsed ? { ...parsed.stats, fixed: parsed.stats.failed === 0 && parsed.stats.total > 0 && !t.timedOut } : { error: t.timedOut ? 'The check timed out.' : 'The patched tests did not run.', fixed: false };
      }
      set('ready');
    } catch (e) {
      tf.error = 'Analysis failed: ' + ((e && e.message) || e); tf.state = 'error';
    } finally {
      active.delete(m.id); tf.finishedAt = Date.now(); persist(r);
    }
  })();
  return tf;
}

/** One claude -p run in the workspace folder: read and grep freely, edit only pages/ there. No browser, no other tools. */
function runClaude(cwd, prompt, tf) {
  return new Promise((resolve) => {
    const rule = cwd.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, dl) => '//' + dl.toLowerCase());
    const args = ['-p', '--output-format', 'json', '--model', MODEL, '--permission-mode', 'dontAsk', '--strict-mcp-config', '--no-session-persistence',
      '--tools', 'Read,Grep,Glob,Edit', '--allowedTools', 'Read', 'Grep', 'Glob', `Edit(${rule}/pages/**)`, '--append-system-prompt', FIX_SYSTEM];
    let proc;
    try { proc = spawn('claude', args, { cwd, env: { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); }
    catch (e) { return resolve({ ok: false, error: 'Could not start claude: ' + e.message }); }
    let out = '', err = '', done = false;
    const end = (v) => { if (done) return; done = true; clearTimeout(timer); resolve(v); };
    const timer = setTimeout(() => { if (process.platform === 'win32') spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); else proc.kill('SIGKILL'); end({ ok: false, error: 'The analysis timed out.' }); }, FIX_MS);
    proc.stdout.on('data', (c) => { out += c; });
    proc.stderr.on('data', (c) => { err += c; });
    proc.on('error', (e) => end({ ok: false, error: 'Could not start claude: ' + e.message }));
    proc.on('close', (code) => {
      let j = null; try { j = JSON.parse(out.trim().split('\n').filter(Boolean).pop()); } catch (_) { /* not JSON */ }
      if (j && typeof j.total_cost_usd === 'number') tf.costUsd = j.total_cost_usd;
      if (j && !j.is_error && typeof j.result === 'string') return end({ ok: true, text: j.result });
      end({ ok: false, error: (j && j.result) || err.trim().slice(-500) || `claude exited with code ${code}` });
    });
    proc.stdin.on('error', () => {});
    proc.stdin.end(prompt);
  });
}

/** Copies the allowed files of the patch into the staged project. Only on the user's click. */
function applyFix(r) {
  const m = r.meta, tf = m.testFix;
  if (!tf || tf.state !== 'ready') throw httpErr(409, 'There is no patch waiting for a decision.');
  const good = (tf.files || []).filter((f) => !f.problem);
  if (!good.length) throw httpErr(409, 'There is nothing to apply.');
  const d = dirs(m);
  const project = path.join(m.staging.dir, FOLDER);
  if (!fs.existsSync(d.fix) || !fs.existsSync(project)) throw httpErr(410, 'The patch or the project is gone. Analyse again.');
  for (const f of good) {
    if (!ALLOWED.test(f.path)) continue;   // belt and braces: the list is stored, so check again
    const to = path.join(project, f.path);
    if (!to.startsWith(project + path.sep)) continue;
    fs.copyFileSync(path.join(d.fix, f.path), to);
  }
  tf.state = 'applied'; tf.appliedAt = Date.now();
  persist(r);
  return tf;
}

function rejectFix(r) {
  const tf = r.meta.testFix;
  if (!tf || tf.state !== 'ready') throw httpErr(409, 'There is no patch waiting for a decision.');
  tf.state = 'rejected'; persist(r);
  return tf;
}

/** Same restart rule as for the test run. */
function reconcile(meta) {
  const tf = meta.testFix;
  if (tf && ['analyzing', 'verifying'].includes(tf.state) && !active.has(meta.id)) { tf.state = 'error'; tf.error = tf.error || 'Interrupted: the server restarted during the analysis.'; tf.finishedAt = tf.finishedAt || Date.now(); }
}

module.exports = { ALLOWED, FORBIDDEN, applyFix, parseVerdicts, reconcile, rejectFix, reviewPatch, startFix, walk };
