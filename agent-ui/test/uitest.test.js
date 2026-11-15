const test = require('node:test');
const assert = require('node:assert');
const ui = require('../lib/uitest');

const REPORT = `[s1] PASS — open the page → heading "Login"
[s2] PASS — fill textbox "Username" and "Password", click button "Log in" → heading "Dashboard"
[a1] PASS — heading "Dashboard" is visible (after s2)
[a2] PASS — URL ends with /dashboard (after s2)`;
const meta = (over = {}) => ({ agent: 'uitest', status: 'done', report: REPORT, reportStatus: 'VERIFIED', url: 'https://t.example.com/login', ticket: 'Log in and see the dashboard', hasLogin: true, ...over });

test('guard stops after too many browser steps', () => {
  const g = ui.guard('https://t.example.com');
  let why = '';
  for (let i = 0; i <= ui.MAX_STEPS && !why; i++) why = g.check('browser_click', { element: 'b' + i });
  assert.match(why, /browser steps/);
});

test('guard stops on the same action three times in a row, but reading the page is not a loop', () => {
  const g = ui.guard('https://t.example.com');
  assert.strictEqual(g.check('browser_snapshot', {}), '');
  assert.strictEqual(g.check('browser_snapshot', {}), '');
  assert.strictEqual(g.check('browser_snapshot', {}), '');
  assert.strictEqual(g.check('browser_click', { ref: 'e1' }), '');
  assert.strictEqual(g.check('browser_click', { ref: 'e1' }), '');
  assert.match(g.check('browser_click', { ref: 'e1' }), /same action/);
});

test('guard stops when the agent navigates to another site', () => {
  const g = ui.guard('https://t.example.com/login');
  assert.strictEqual(g.check('browser_navigate', { url: 'https://t.example.com/app' }), '');
  assert.match(g.check('browser_navigate', { url: 'https://evil.example.org/' }), /leave the page/);
});

test('scrub removes the password from any text', () => {
  assert.strictEqual(ui.scrub('typed hunter2 then hunter2', ['hunter2']), 'typed *** then ***');
  assert.strictEqual(ui.scrub('nothing here', ['hunter2']), 'nothing here');
  assert.strictEqual(ui.scrub('ab', ['ab']), 'ab', 'a secret shorter than 3 characters is not replaced (would mangle text)');
});

test('the prompt carries the login only when it was given', () => {
  const withLogin = ui.uiPrompt({ goal: 'g', url: 'https://t.example.com', username: 'anna', password: 'pw123' });
  assert.match(withLogin, /user name: anna/);
  assert.match(withLogin, /password: pw123/);
  const none = ui.uiPrompt({ goal: 'g', url: 'https://t.example.com' });
  assert.match(none, /no credentials were given/);
  assert.doesNotMatch(none, /password:/);
});

test('playwright server is fast and bounded: no images, timeouts, one origin, secrets file', () => {
  const s = ui.playwrightServer({ origin: 'https://t.example.com', workDir: 'w', secretsFile: 'w/secrets.env' });
  const a = s.args.join(' ');
  assert.match(a, /--image-responses omit/);
  assert.match(a, /--timeout-action 8000/);
  assert.match(a, /--allowed-origins https:\/\/t\.example\.com/);
  assert.match(a, /--secrets w[\\/]secrets\.env/);
  assert.doesNotMatch(ui.playwrightServer({ origin: 'https://t.example.com', workDir: 'w' }).args.join(' '), /--secrets/);
});

test('parseReport counts steps, checks and failures', () => {
  assert.deepStrictEqual(ui.parseReport(REPORT), { steps: 2, checks: 2, fails: 0 });
  assert.strictEqual(ui.parseReport(REPORT.replace('[a2] PASS', '[a2] FAIL')).fails, 1);
});

test('only a fully passed, evidenced run can be accepted', () => {
  assert.strictEqual(ui.acceptBlocker(meta()), '');
  assert.match(ui.acceptBlocker(meta({ reportStatus: 'FAILED' })), /not VERIFIED/);
  assert.match(ui.acceptBlocker(meta({ reportStatus: 'BLOCKED' })), /not VERIFIED/);
  assert.match(ui.acceptBlocker(meta({ status: 'running' })), /Wait/);
  assert.match(ui.acceptBlocker(meta({ report: null })), /no report/);
  assert.match(ui.acceptBlocker(meta({ accepted: { at: 1 } })), /Already/);
  assert.match(ui.acceptBlocker(meta({ report: '[s1] PASS — x' })), /no numbered steps and checks/);
  assert.match(ui.acceptBlocker(meta({ report: REPORT.replace('[a1] PASS', '[a1] FAIL') })), /failed/, 'VERIFIED with a FAIL line inside is still refused');
  assert.match(ui.acceptBlocker(meta({ agent: 'qamcp' })), /Not a UI Tests/);
});

test('the test-writing task has the report, the rules and env-var login, never the password', () => {
  const flow = ui.buildFlow(meta(), [{ type: 'browser', text: 'click · button "Log in"', input: '{"element":"button \\"Log in\\""}' }, { type: 'browser', text: 'snapshot', input: '{}' }]);
  assert.match(flow, /PAGE: https:\/\/t\.example\.com\/login/);
  assert.match(flow, /E2E_USERNAME and E2E_PASSWORD/);
  assert.match(flow, /storageState/);
  assert.match(flow, /\[a1\] PASS/);
  assert.match(flow, /click · button "Log in"/);
  assert.doesNotMatch(flow, /snapshot/, 'reading the page is not an action of the test');
  assert.match(ui.buildFlow(meta({ hasLogin: false }), []), /LOGIN: none/);
});
