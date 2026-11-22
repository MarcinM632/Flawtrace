// Runs the TypeScript Playwright project an UI Tests run produced, on the real page, and keeps the evidence:
// a Playwright HTML report with every step, a screenshot after each step, a video and a trace per test.
// The project is copied to <work dir>/ts-run first, so node_modules, reports and the saved session never end up in the
// staging copy that "Save to repo" copies from. The login is given per run and lives only in the environment of the child process.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { persist } = require('./store');
const { scrub } = require('./uitest');

const FOLDER = 'ts-playwright';
const INSTALL_MS = 5 * 60000, BROWSER_MS = 10 * 60000, TEST_MS = Number(process.env.QA_UI_TEST_MIN || 10) * 60000;
const TAIL = 6000;
const active = new Map(); // run id -> { proc }

const httpErr = (code, message) => Object.assign(new Error(message), { code });
const runDir = (meta) => path.join(path.dirname(meta.staging.dir), 'ts-run');
const reportDir = (meta) => path.join(runDir(meta), 'flawtrace-report');

const browsers = require('./browsers');
/** Overrides only the evidence settings of the generated config: everything on, no retries (a flaky test must show).
 *  Runs the chosen desktop browsers (UITEST_BROWSERS) and/or mobile devices (UITEST_DEVICE, e.g. iphone,pixel) — the
 *  same test on Chromium/Firefox/WebKit and on emulated phones/tablets. Accepts a browser list or a projects snippet. */
const configSource = (projectsOrList) => { const projects = Array.isArray(projectsOrList) ? browsers.projectsSnippet(projectsOrList) : String(projectsOrList); return `import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  retries: 0,
  timeout: 20000,            // a failing test should fail in seconds, not wait 30 s per step
  expect: { timeout: 5000 },
  outputDir: 'test-results',
  reporter: [['list'], ['json', { outputFile: 'flawtrace-results.json' }], ['html', { outputFolder: 'flawtrace-report', open: 'never' }]],
  use: { ...base.use, actionTimeout: 8000, screenshot: 'on', video: 'on', trace: 'on' },
  projects: ${projects},
});
`; };
// Domyślny wariant (chromium) — używany przez naprawę testu (ui-fix) i sprawdzany przez testy.
const CONFIG_SOURCE = configSource(['chromium']);

/** Environment of the test process: the page and the login the generated tests read. Never the app's own secrets. */
function testEnv(meta, creds, base = process.env) {
  const env = { ...base, BASE_URL: new URL(meta.url).origin, FORCE_COLOR: '0' };
  delete env.CI;
  if (creds && creds.username) env.E2E_USERNAME = creds.username;
  if (creds && creds.password) env.E2E_PASSWORD = creds.password;
  return env;
}

const ANSI = /\x1b\[[0-9;]*m/g;
/** Playwright JSON report -> counts and one row per test. */
function parseResults(json) {
  const tests = [];
  const walk = (suite, file) => {
    for (const spec of suite.specs || []) {
      for (const t of spec.tests || []) {
        const results = t.results || [];
        const last = results[results.length - 1] || {};
        tests.push({
          title: spec.title, file: spec.file || file || suite.file || '', project: t.projectName || '',
          status: t.status, ms: results.reduce((s, x) => s + (x.duration || 0), 0),
          error: last.error && last.error.message ? String(last.error.message).replace(ANSI, '').split('\n').slice(0, 6).join('\n').slice(0, 600) : '',
        });
      }
    }
    for (const s of suite.suites || []) walk(s, s.file || file);
  };
  for (const s of (json && json.suites) || []) walk(s, s.file);
  const st = (json && json.stats) || {};
  return { stats: { passed: st.expected || 0, failed: st.unexpected || 0, flaky: st.flaky || 0, skipped: st.skipped || 0, total: tests.length }, tests };
}

/** One child process with a time limit; stdout and stderr go to onData. Resolves { code, timedOut }. */
function exec(cmd, args, { cwd, env, ms, onData, onProc }) {
  return new Promise((resolve) => {
    const win = process.platform === 'win32';
    const proc = spawn(win ? 'cmd' : cmd, win ? ['/c', cmd, ...args] : args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    if (onProc) onProc(proc);
    let timedOut = false, done = false;
    const kill = () => { if (win) spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); else proc.kill('SIGKILL'); };
    const timer = setTimeout(() => { timedOut = true; kill(); }, ms);
    const end = (code) => { if (done) return; done = true; clearTimeout(timer); resolve({ code, timedOut }); };
    proc.stdout.on('data', (c) => onData(c.toString('utf8')));
    proc.stderr.on('data', (c) => onData(c.toString('utf8')));
    proc.on('error', (e) => { onData(`\n[could not start ${cmd}: ${e.message}]\n`); end(-1); });
    proc.on('close', (code) => end(code));
  });
}

/** Starts the run in the background; progress is in meta.testRun, which the UI polls. */
function startTestRun(r, creds) {
  const m = r.meta;
  if (m.agent !== 'autotest' || m.stack !== 'ts-playwright') throw httpErr(400, 'Only a TypeScript Playwright project can be run here.');
  if (m.status !== 'done') throw httpErr(409, 'Wait until the test is written.');
  const project = m.staging && path.join(m.staging.dir, FOLDER);
  if (!project || !fs.existsSync(project)) throw httpErr(410, 'The staged project is gone, so there is nothing to run. Accept the UI run again.');
  if (!m.url) throw httpErr(400, 'This run has no page address.');
  if (active.has(m.id)) throw httpErr(409, 'The test is already running.');
  const secrets = creds && creds.password ? [creds.password] : [];
  m.testFix = null; // a new run starts a new question; an older patch no longer belongs to it
  const tr = m.testRun = { state: 'preparing', startedAt: Date.now(), finishedAt: null, stats: null, tests: [], tail: '', error: null, hasReport: false, withLogin: !!(creds && (creds.username || creds.password)) };
  const entry = { proc: null, cancelled: false };
  active.set(m.id, entry);
  const log = (s) => { tr.tail = scrub((tr.tail + s).replace(ANSI, ''), secrets).slice(-TAIL); };
  const set = (state) => { tr.state = state; persist(r); };
  const fail = (msg) => { tr.error = msg; tr.state = 'error'; };

  (async () => {
    try {
      const dir = runDir(m);
      fs.mkdirSync(dir, { recursive: true });
      // Fresh sources every time, but keep node_modules; old evidence is replaced by the new run.
      for (const f of fs.readdirSync(project)) {
        if (['node_modules', 'test-results', 'playwright-report', 'flawtrace-report', 'playwright'].includes(f)) continue;
        fs.cpSync(path.join(project, f), path.join(dir, f), { recursive: true, force: true });
      }
      for (const old of ['flawtrace-report', 'test-results', 'flawtrace-results.json', 'playwright']) fs.rmSync(path.join(dir, old), { recursive: true, force: true });
      // Desktop (UITEST_BROWSERS) i/lub mobile (UITEST_DEVICE, np. "iphone,pixel"). Natywne apki iOS/Android to osobny
      // silnik (Appium/symulatory, farma urządzeń) — tu testujemy aplikację webową na emulowanych urządzeniach.
      const plan = browsers.devicePlan({ browsers: process.env.UITEST_BROWSERS || '', devices: m.device || process.env.UITEST_DEVICE || '', browsersSet: 'UITEST_BROWSERS' in process.env });
      const browserList = plan.install;
      fs.writeFileSync(path.join(dir, 'flawtrace.config.ts'), configSource(plan.projectsSnippet));
      const env = testEnv(m, creds);
      const base = { cwd: dir, env, onData: log, onProc: (p) => { entry.proc = p; } };

      if (!fs.existsSync(path.join(dir, 'node_modules'))) {
        set('installing'); log('> npm install\n');
        const i = await exec('npm', ['install', '--no-audit', '--no-fund'], { ...base, ms: INSTALL_MS });
        if (entry.cancelled) return;
        if (i.code !== 0) return fail(i.timedOut ? 'npm install timed out.' : 'npm install failed. See the output.');
      }
      set('installing'); log('> npx playwright install ' + browserList.join(' ') + '\n');
      const b = await exec('npx', ['playwright', 'install', ...browserList], { ...base, ms: BROWSER_MS });
      if (entry.cancelled) return;
      if (b.code !== 0) return fail(b.timedOut ? 'Downloading the browser timed out.' : 'Could not install the browser. See the output.');

      set('running'); log('> npx playwright test\n');
      const t = await exec('npx', ['playwright', 'test', '-c', 'flawtrace.config.ts'], { ...base, ms: TEST_MS });
      if (entry.cancelled) return;
      let parsed = null;
      try { parsed = parseResults(JSON.parse(fs.readFileSync(path.join(dir, 'flawtrace-results.json'), 'utf8'))); } catch (_) { /* no JSON: the run did not get as far as running tests */ }
      tr.hasReport = fs.existsSync(path.join(reportDir(m), 'index.html'));
      if (!parsed) return fail(t.timedOut ? `The test run timed out after ${TEST_MS / 60000} min.` : 'The tests did not run. See the output.');
      Object.assign(tr, parsed);
      tr.state = parsed.stats.failed || t.timedOut || !parsed.stats.total ? 'failed' : 'passed';
      // Samonaprawianie: gdy test padł, klasyfikacja awarii doradza odtworzyć z intencji (zmiana UI) albo załatać.
      if (tr.state === 'failed' && parsed.stats.failed) {
        const bad = (parsed.tests || []).filter((x) => x.status !== 'passed' && x.error).map((x) => x.error);
        tr.selfHeal = require('./self-heal').recommend({ failures: bad, hasIntent: !!require('./self-heal').intentFrom(m) });
      }
      if (t.timedOut) tr.error = `Stopped after ${TEST_MS / 60000} min (QA_UI_TEST_MIN).`;
      else if (!parsed.stats.total) tr.error = 'No tests were found to run.';
    } catch (e) {
      fail('Could not run the test: ' + ((e && e.message) || e));
    } finally {
      active.delete(m.id);
      if (!entry.cancelled) { tr.finishedAt = Date.now(); persist(r); }
    }
  })();
  return tr;
}

/** A run saved as busy by a server that has since restarted is not running: say so instead of showing it forever. */
function reconcile(meta) {
  const tr = meta.testRun;
  if (tr && ['preparing', 'installing', 'running'].includes(tr.state) && !active.has(meta.id)) { tr.state = 'error'; tr.error = tr.error || 'Interrupted: the server restarted while the test was running.'; tr.finishedAt = tr.finishedAt || Date.now(); }
}

function cancelTestRun(r) {
  const e = active.get(r.meta.id);
  if (!e) throw httpErr(409, 'No test is running.');
  e.cancelled = true;
  if (e.proc) { if (process.platform === 'win32') spawn('taskkill', ['/pid', String(e.proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); else e.proc.kill('SIGKILL'); }
  const tr = r.meta.testRun; tr.state = 'cancelled'; tr.finishedAt = Date.now(); active.delete(r.meta.id); persist(r);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webm': 'video/webm', '.zip': 'application/zip', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

/** The file of the HTML report for a relative URL path, or '' when it is outside the report folder or missing. */
function reportFile(meta, rel) {
  if (!meta.staging) return '';
  const base = path.resolve(reportDir(meta));
  let r; try { r = decodeURIComponent(rel || ''); } catch (_) { return ''; }
  const file = path.resolve(base, r.replace(/^\/+/, '') || 'index.html');
  if (file !== base && !file.startsWith(base + path.sep)) return '';
  try { return fs.statSync(file).isFile() ? file : ''; } catch (_) { return ''; }
}

/** Serves one report file, with Range support (a video cannot be seeked without it). Returns false when there is no such file. */
function serveReport(req, res, meta, rel) {
  const file = reportFile(meta, rel);
  const type = file && MIME[path.extname(file).toLowerCase()];
  if (!file || !type) return false;
  const size = fs.statSync(file).size;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return true; }
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file, { start, end }).pipe(res);
    return true;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
  return true;
}

module.exports = { CONFIG_SOURCE, configSource, cancelTestRun, exec, parseResults, reconcile, reportFile, serveReport, startTestRun, testEnv };
