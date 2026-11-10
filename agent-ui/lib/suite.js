// Test suite: lista testów z repo (z cache), uruchamianie wybranych, historia wyników, edycja pliku.
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const crypto = require('crypto');
const { AUTOTEST_REPO, DATA_DIR } = require('./config');
const { loadTestSecrets, redact, runGuard, snapTests } = require('./autotest-repo');
const envLock = require('./env-lock');
const environment = require('./environment');

// Treść żądania jako UTF-8 (bez rozcinania znaków wielobajtowych na granicy chunków). Zbyt duże ciało
// kończy się pustym obiektem zamiast wiszącego żądania.
// ---------------------------------------------------------------------------------------------
// Test suite: testy, które JUŻ są w autotests/. Lista z checkboxami, uruchamianie wybranych, historia wyników
// i edycja pliku. Działa na prawdziwym repo (to testy zatwierdzone), bez agenta i bez pętli poprawek.
// ---------------------------------------------------------------------------------------------
const SUITE_FILE = path.join(DATA_DIR, 'suite-results.json');
const suite = { last: {}, runs: [] }; // last: nodeid -> { outcome, at }, runs: podsumowania ostatnich uruchomień
try { Object.assign(suite, JSON.parse(fs.readFileSync(SUITE_FILE, 'utf8'))); } catch (_) { /* pierwszy start */ }
const saveSuite = () => { try { fs.writeFileSync(SUITE_FILE, JSON.stringify(suite)); } catch (_) { /* wyniki są dodatkiem */ } };
let suiteRun = null; // bieżący albo ostatni run: { id, status, startedAt, finishedAt, targets, total, results, messages, output, proc }
let suiteListCache = [];

/** Markery (@pytest.mark.XYZ) per funkcja testowa, z samego kodu — pytest --collect-only ich nie wypisuje. */
function markersOf(file) {
  const out = {};
  let src = '';
  try { src = fs.readFileSync(path.join(AUTOTEST_REPO, file), 'utf8'); } catch (_) { return out; }
  let pending = [];
  for (const line of src.split(/\r?\n/)) {
    const mk = line.match(/^\s*@pytest\.mark\.([A-Za-z_]\w*)/);
    if (mk) { if (/^[A-Z][A-Z0-9_]*$/.test(mk[1])) pending.push(mk[1]); continue; }
    const fn = line.match(/^\s*def\s+(test_\w+)/);
    if (fn) { out[fn[1]] = pending; pending = []; } else if (!/^\s*(@|\)|$|#)/.test(line) && !/^\s/.test(line)) pending = [];
  }
  return out;
}

/**
 * Lista testów z cache. Zebranie ich przez pytest trwa kilka sekund (import pytest, requests, plików testów), a lista
 * zmienia się tylko, gdy zmieni się któryś plik .py, więc odpowiedź jest ważna, dopóki zgadza się podpis plików.
 */
let suiteListSig = null;
let suiteListVal = null;
let suiteListInflight = null;
function listSuite() {
  const sig = [...snapTests()].map(([k, v]) => k + '=' + v).join('|');
  if (suiteListVal && sig === suiteListSig) return Promise.resolve(suiteListVal);
  if (suiteListInflight && suiteListInflight.sig === sig) return suiteListInflight.p;
  const p = listSuiteUncached().then((v) => {
    if (!v.error) { suiteListSig = sig; suiteListVal = v; }
    if (suiteListInflight && suiteListInflight.p === p) suiteListInflight = null;
    return v;
  });
  suiteListInflight = { sig, p };
  return p;
}

/** Lista wszystkich testów z repo (pytest --collect-only), z markerami. */
function listSuiteUncached() {
  return new Promise((resolve) => {
    const proc = spawn('python', ['-m', 'pytest', '--collect-only', '-q', '--color=no', '-p', 'no:cacheprovider'],
      { cwd: AUTOTEST_REPO, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    const timer = setTimeout(() => { proc.kill(); resolve({ tests: [], error: 'Listing the tests timed out' }); }, 60000);
    proc.stdout.on('data', (c) => { out += c; });
    proc.stderr.on('data', (c) => { out += c; });
    proc.on('error', () => { clearTimeout(timer); resolve({ tests: [], error: 'Python is not available' }); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      const marks = {};
      const tests = [];
      for (const line of out.split(/\r?\n/)) {
        const m = line.match(/^(tests\/[^\s:]+\.py)::(.+)$/);
        if (!m) continue;
        const file = m[1];
        const rest = m[2];
        const fnName = rest.split('::').pop().replace(/\[.*$/, '');
        if (!marks[file]) marks[file] = markersOf(file);
        const br = rest.match(/\[(.*)\]$/);
        tests.push({ id: line.trim(), file, name: rest.split('::').pop().replace(/\[.*$/, ''), param: br ? br[1] : '', markers: marks[file][fnName] || [] });
      }
      suiteListCache = tests;
      resolve({ tests, error: code !== 0 && !tests.length ? out.trim().slice(-1200) : (code !== 0 && code !== 5 ? 'Some files could not be collected:\n' + out.trim().slice(-900) : null) });
    });
  });
}

const targetOk = (t) => typeof t === 'string' && t.length < 400 && /^tests\//.test(t) && !t.includes('..') && !/[\x00-\x1f]/.test(t)
  && fs.existsSync(path.join(AUTOTEST_REPO, t.split('::')[0]));
const suiteSummary = (r) => r && ({ id: r.id, status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt, total: r.total, environment: r.environment,
  passed: Object.values(r.results).filter((o) => o === 'passed').length, failed: Object.values(r.results).filter((o) => o === 'failed' || o === 'error').length,
  done: Object.keys(r.results).length, targets: r.targets.length });

async function startSuiteRun(targets) {
  if (suiteRun && suiteRun.status === 'running') throw Object.assign(new Error('A test run is already in progress'), { code: 409 });
  if (!Array.isArray(targets) || !targets.length) throw Object.assign(new Error('Select at least one test'), { code: 400 });
  if (targets.length > 400 || !targets.every(targetOk)) throw Object.assign(new Error('The selection contains something that is not a test in autotests/tests'), { code: 400 });
  if (targets.join(' ').length > 24000) throw Object.assign(new Error('The selection is too long. Select whole files instead of single tests.'), { code: 400 });
  // Zamrożone na ten jeden run: środowisko może się przełączyć w UI, zanim ten przebieg się skończy.
  const env = environment.profile();
  const sec = await loadTestSecrets(env.vaultProfile);
  if (!sec.ok) throw Object.assign(new Error(sec.reason), { code: 409 });
  const release = envLock.tryAcquire('Test suite run');
  if (!release) throw Object.assign(new Error(`The environment is busy: ${envLock.current().label} is running tests on it. Try again when it finishes.`), { code: 409 });
  // Strażnik reguły Hedge AUTOTEST jak w weryfikacji Autotests: migawka przed, porównanie i przywrócenie po.
  const guardFile = path.join(DATA_DIR, 'hedge-rule-autotest.suite.snapshot.json');
  const guarded = process.env.QA_HEDGE_GUARD !== '0' && !(await runGuard('snapshot', guardFile)).error;
  const matches = (id, t) => id === t || id.startsWith(t + '::') || id.startsWith(t.replace(/\/?$/, '/'));
  const total = suiteListCache.length ? suiteListCache.filter((x) => targets.some((t) => matches(x.id, t))).length : null;
  const id = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14) + '-' + crypto.randomBytes(2).toString('hex');
  const run = { id, status: 'running', startedAt: Date.now(), finishedAt: null, targets, total, environment: env.key, results: {}, messages: {}, output: '', proc: null };
  suiteRun = run;
  const proc = spawn('python', ['-m', 'pytest', '-v', '--tb=short', '--color=no', '-p', 'no:cacheprovider', ...targets],
    { cwd: AUTOTEST_REPO, env: { ...process.env, ...sec.values, PLAT_ENV_FILE: env.envFile, PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  run.proc = proc;
  let buf = '';
  const onLine = (line) => {
    const m = line.match(/^(tests\/\S+?::.+?)\s+(PASSED|FAILED|ERROR|SKIPPED|XFAIL|XPASS)\b/);
    if (m) run.results[m[1]] = m[2].toLowerCase();
  };
  const onData = (chunk) => {
    const text = redact(chunk.toString('utf8'), sec.values);
    run.output = (run.output + text).slice(-60000);
    buf += text;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); }
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  const timer = setTimeout(() => { run.timedOut = true; spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); }, 20 * 60 * 1000);
  const end = async (status, error) => {
    if (run.finishedAt || run.ending) return;
    run.ending = true;
    if (guarded) {
      const g = await runGuard('restore', guardFile);
      if (g.error) error = `Restoring Hedge rule AUTOTEST failed: ${g.error}. Check the rule by hand.`;
      else if (g.changed) error = `The tests left Hedge rule AUTOTEST changed (${g.diff.slice(0, 8).join('; ')}); `
        + (g.restored ? 'the app restored it.' : `the app could NOT fully restore it: ${(g.left || []).join('; ')}.`);
    }
    release();
    clearTimeout(timer);
    if (buf.trim()) onLine(buf.replace(/\r$/, ''));
    // Komunikaty błędów: bloki "____ nazwa testu ____" z sekcji FAILURES / ERRORS.
    const parts = run.output.split(/^_{3,} (.+?) _{3,}\s*$/m);
    for (let k = 1; k < parts.length; k += 2) {
      const name = parts[k].trim();
      const id2 = Object.keys(run.results).find((x) => x.endsWith('::' + name));
      if (id2) {
        const block = parts[k + 1].split(/\n={3,} /)[0].trim();
        const why = block.split('\n').filter((l) => /^E\s/.test(l)).slice(-1)[0];
        run.messages[id2] = ((why ? why.replace(/^E\s+/, '').slice(0, 300) + '\n\n' : '') + block).slice(0, 2500);
      }
    }
    run.status = run.timedOut ? 'failed' : status;
    run.error = run.timedOut ? 'The run took longer than 20 minutes and was stopped' : error || null;
    run.finishedAt = Date.now();
    const at = run.finishedAt;
    for (const [tid, outcome] of Object.entries(run.results)) suite.last[tid] = { outcome, at, runId: id };
    suite.runs.unshift({ ...suiteSummary(run), error: run.error, results: run.results, messages: run.messages, output: run.output.slice(-8000) });
    suite.runs = suite.runs.slice(0, 30);
    saveSuite();
  };
  proc.on('error', () => end('failed', 'Python is not available'));
  proc.on('close', (code) => end(run.status === 'cancelling' ? 'cancelled' : 'done', null));
  return run;
}

function cancelSuiteRun() {
  if (!suiteRun || suiteRun.status !== 'running') throw Object.assign(new Error('No test run in progress'), { code: 404 });
  suiteRun.status = 'cancelling';
  spawn('taskkill', ['/pid', String(suiteRun.proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
}

const suiteFileOk = (p) => typeof p === 'string' && /^(tests|utils)\/[\w\-\/]+\.py$/.test(p) && !p.includes('..');

module.exports = {
  cancelSuiteRun,
  listSuite,
  startSuiteRun,
  suite,
  suiteFileOk,
  suiteSummary,
  get suiteRun() { return suiteRun; },
};
