// Do the API autotests (pytest) catch a broken backend? The same mutation check as for UI tests (lib/ui-mutation.js),
// for the Python suite written by the Autotests agent.
//
// The tests already passed twice on the environment (meta.verify.state === 'passed'). Now they run again through
// lib/mutation-proxy: the proxy stands in front of the test environment (Sources > API base URL) and breaks one answer
// per run. The suite does not have to know about it: its environment file (PLAT_ENV_FILE) is copied with every mention of
// the environment's address replaced by the proxy's, and BASE_URL / API_BASE_URL point at the proxy as well. A suite that
// reads its address from somewhere else is not reached by any mutant, and the result says so ("not measurable").
// The environment lock is held for the whole check, so no other run writes to the environment meanwhile.
const fs = require('fs');
const path = require('path');
const { persist } = require('./store');
const { RUNS_DIR, PLAT_ENV_FILE } = require('./config');
const mutation = require('./mutation-proxy');
const { verdictOf } = require('./ui-mutation');

const active = new Set();
const httpErr = (code, message) => Object.assign(new Error(message), { code });
const isTestFile = (p) => /(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(String(p).replace(/\\/g, '/'));

/** The suite's environment file with the test environment's address replaced by the proxy's. Pure. */
function rewriteEnv(text, origin, proxyUrl) {
  const o = String(origin).replace(/\/+$/, '');
  const host = o.replace(/^https?:\/\//, '');
  return String(text || '')
    .split(o).join(proxyUrl)
    // The same host written without the scheme (HOST=..., or inside another URL form).
    .split(host).join(proxyUrl.replace(/^https?:\/\//, ''));
}

/**
 * Starts the check. deps (for tests): runner, sources ({ read() }), loadSecrets(), lock ({ acquire }), envFile.
 */
function startApiMutation(r, deps = {}) {
  const m = r.meta;
  const runner = deps.runner || mutation.run;
  const sources = deps.sources || require('./sources');
  const lock = deps.lock || require('./env-lock');
  const loadSecrets = deps.loadSecrets || (async () => { const env = require('./environment').profile(); return require('./autotest-repo').loadTestSecrets(env.vaultProfile); });
  const envFile = deps.envFile !== undefined ? deps.envFile : (require('./environment').profile().envFile || PLAT_ENV_FILE);
  if (m.agent !== 'autotest' || m.stack) throw httpErr(400, 'Only the Python API autotests can be checked here.');
  if (!m.verify || m.verify.state !== 'passed') throw httpErr(409, 'Only tests that passed on the environment can be checked against a broken backend.');
  if (!m.staging || !m.staging.dir || !fs.existsSync(m.staging.dir)) throw httpErr(410, 'The staged copy is gone. Write the tests again.');
  const files = (m.files || []).map((f) => (typeof f === 'string' ? f : f.path)).filter(isTestFile);
  if (!files.length) throw httpErr(409, 'This run wrote no test file to check.');
  const base = String((sources.read().api || {}).baseUrl || '').trim();
  if (!/^https?:\/\//.test(base)) throw httpErr(409, 'No test environment address under Sources > API, so there is nothing to put the proxy in front of.');
  if (active.has(m.id)) throw httpErr(409, 'The mutation check is already running.');
  const origin = new URL(base).origin;
  const mu = m.mutation = { kind: 'api', state: 'running', startedAt: Date.now(), finishedAt: null, done: 0, total: null, score: null, killed: 0, survived: 0, notReached: 0, survivors: {}, verdict: '', error: null, log: '' };
  active.add(m.id);
  persist(r);
  (async () => {
    let release = null;
    try {
      const sec = await loadSecrets();
      if (sec && sec.ok === false) { mu.state = 'error'; mu.error = sec.reason || 'No credentials for the environment.'; return; }
      release = await lock.acquire(`Mutation check ${m.id}`, () => { mu.log = 'Waiting for the environment: another run is using it.\n'; });
      const work = path.join(RUNS_DIR, 'work', m.id);
      fs.mkdirSync(work, { recursive: true });
      const res = await runner({
        target: origin, cwd: m.staging.dir, max: Number(process.env.QA_API_MUTANTS) || 20, timeoutMs: Number(process.env.QA_PYTEST_MIN || 15) * 60000,
        cmd: 'python -m pytest -q --tb=no --color=no -p no:cacheprovider ' + files.map((f) => JSON.stringify(f)).join(' '),
        envFor: (proxyUrl) => {
          const env = { ...process.env, ...((sec && sec.values) || {}), BASE_URL: proxyUrl, API_BASE_URL: proxyUrl, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' };
          if (envFile && fs.existsSync(envFile)) {
            const copy = path.join(work, 'mutation.env');
            fs.writeFileSync(copy, rewriteEnv(fs.readFileSync(envFile, 'utf8'), origin, proxyUrl));
            env.PLAT_ENV_FILE = copy;
          }
          return env;
        },
        log: (line) => { mu.log = (mu.log + line + '\n').slice(-4000); if (/^M\d+\s/.test(line)) mu.done += 1; const t = line.match(/(\d+) mutant\(s\)/); if (t) mu.total = Number(t[1]); },
      });
      if (res.error) { mu.state = 'error'; mu.error = res.error; return; }
      Object.assign(mu, { score: res.score, killed: res.killed, survived: res.survived, notReached: res.notReached, survivors: res.survivors || {}, endpoints: res.baseline.endpoints });
      mu.verdict = verdictOf(res);
      mu.state = 'done';
      if (mu.verdict === 'none') mu.error = res.baseline.endpoints ? 'No mutant reached the tests.' : 'The tests made no call through the proxy: the suite reads the environment address from somewhere other than its .env file, BASE_URL or API_BASE_URL.';
    } catch (e) {
      mu.state = 'error'; mu.error = 'The mutation check failed: ' + ((e && e.message) || e);
    } finally {
      if (release) release();
      active.delete(m.id);
      mu.finishedAt = Date.now();
      persist(r);
    }
  })();
  return mu;
}

/** A check saved as running by a server that has since restarted is not running. */
function reconcile(meta) {
  const mu = meta.mutation;
  if (mu && mu.kind === 'api' && mu.state === 'running' && !active.has(meta.id)) { mu.state = 'error'; mu.error = 'Interrupted by a restart of the app.'; }
}

module.exports = { startApiMutation, reconcile, rewriteEnv, isTestFile };
