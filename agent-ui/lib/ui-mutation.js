// Does the generated UI test catch a broken app? Mutation testing of a TypeScript Playwright project, from the app.
//
// The project already passed on the page (lib/ui-run). Now it runs again through lib/mutation-proxy: the proxy sits
// between the browser and the page (BASE_URL = proxy), records the answers of the app, then breaks ONE thing per run
// (a number, a text, a flag, a missing field, a shorter list, an error turned into success). A test that still passes
// with the app broken does not check that thing. The result goes to meta.mutation:
//   score    killed / (killed + survived), in %
//   survivors per endpoint: what the tests never look at
//   verdict  strong (>= 60%), weak (< 60%), or none when no mutant reached the tests (they do not use BASE_URL, or
//            the page makes no API call the proxy could change)
// Fast settings: one browser, no screenshots, video or trace, a small number of mutants (QA_UI_MUTANTS, default 12).
const fs = require('fs');
const path = require('path');
const { persist } = require('./store');
const { scrub } = require('./uitest');
const uiRun = require('./ui-run');
const mutation = require('./mutation-proxy');

const STRONG = 60;
const active = new Map(); // run id -> true
const httpErr = (code, message) => Object.assign(new Error(message), { code });
const runDir = (meta) => path.join(path.dirname(meta.staging.dir), 'ts-run');

const CONFIG = `import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

// Written by Flawtrace for the mutation check: the same tests, fast, one browser, no evidence files.
export default defineConfig({
  ...base,
  retries: 0,
  timeout: 20000,
  expect: { timeout: 5000 },
  outputDir: 'mutation-results',
  reporter: 'line',
  use: { ...base.use, actionTimeout: 8000, screenshot: 'off', video: 'off', trace: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
`;

const verdictOf = (res) => (res.score == null ? 'none' : res.score >= STRONG ? 'strong' : 'weak');

/** Starts the mutation check of a passed ts-playwright run. creds: the page login, only for this process. */
function startMutation(r, creds, { max = Number(process.env.QA_UI_MUTANTS) || 12, runner = mutation.run } = {}) {
  const m = r.meta;
  if (m.agent !== 'autotest' || m.stack !== 'ts-playwright') throw httpErr(400, 'Only a TypeScript Playwright project can be checked here.');
  if (!m.testRun || m.testRun.state !== 'passed') throw httpErr(409, 'Run the test on the page first: only a passing test can be checked against a broken app.');
  if (!m.url) throw httpErr(400, 'This run has no page address.');
  if (active.has(m.id)) throw httpErr(409, 'The mutation check is already running.');
  const dir = runDir(m);
  if (!fs.existsSync(path.join(dir, 'node_modules'))) throw httpErr(409, 'The project is not installed any more. Run the test on the page again first.');
  const secrets = creds && creds.password ? [creds.password] : [];
  const mu = m.mutation = { state: 'running', startedAt: Date.now(), finishedAt: null, done: 0, total: null, score: null, killed: 0, survived: 0, notReached: 0, survivors: {}, verdict: '', error: null, log: '' };
  active.set(m.id, true);
  persist(r);
  (async () => {
    try {
      fs.writeFileSync(path.join(dir, 'flawtrace-mutation.config.ts'), CONFIG);
      const res = await runner({
        target: new URL(m.url).origin, cmd: 'npx playwright test -c flawtrace-mutation.config.ts', cwd: dir, envVar: 'BASE_URL',
        env: uiRun.testEnv(m, creds), max, timeoutMs: Number(process.env.QA_UI_TEST_MIN || 10) * 60000,
        log: (line) => { mu.log = scrub((mu.log + line + '\n'), secrets).slice(-4000); const n = /^M\d+\s/.test(line); if (n) mu.done += 1; const t = line.match(/(\d+) mutant\(s\)/); if (t) mu.total = Number(t[1]); },
      });
      if (res.error) { mu.state = 'error'; mu.error = res.error; return; }
      Object.assign(mu, { score: res.score, killed: res.killed, survived: res.survived, notReached: res.notReached, survivors: res.survivors || {}, endpoints: res.baseline.endpoints });
      mu.verdict = verdictOf(res);
      mu.state = 'done';
      if (mu.verdict === 'none') mu.error = res.baseline.endpoints ? 'No mutant reached the tests.' : 'The tests made no API call through the proxy: either the page has no API answers to change, or the tests do not open the page through BASE_URL.';
    } catch (e) {
      mu.state = 'error'; mu.error = 'The mutation check failed: ' + ((e && e.message) || e);
    } finally {
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
  if (mu && mu.state === 'running' && !active.has(meta.id)) { mu.state = 'error'; mu.error = 'Interrupted by a restart of the app.'; }
}

module.exports = { startMutation, reconcile, verdictOf, CONFIG, STRONG };
