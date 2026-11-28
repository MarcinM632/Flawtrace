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

test('mobile: a device emulates a phone (sets --device, drops the desktop viewport); default stays desktop', () => {
  const mobile = ui.playwrightServer({ origin: 'https://t.example.com', workDir: 'w', device: 'iPhone 13' }).args.join(' ');
  assert.match(mobile, /--device iPhone 13/);
  assert.doesNotMatch(mobile, /--viewport-size/);
  const desktop = ui.playwrightServer({ origin: 'https://t.example.com', workDir: 'w' }).args.join(' ');
  assert.match(desktop, /--viewport-size 1280x720/);
  assert.doesNotMatch(desktop, /--device/);
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

test('auditReport: status must follow the lines, FAIL needs Findings, sections are required', () => {
  const ok = 'STATUS: VERIFIED\n--- TREŚĆ ---\n## Steps\n[s1] PASS — open → heading "Login"\n## Checks\n[a1] PASS — heading "Login" (after s1)\n## Findings\nNone\n--- KONIEC TREŚCI ---';
  assert.deepEqual(ui.auditReport(ok, 'VERIFIED', { seen: ['- heading "Login" [ref=e1]'], actions: 1 }), []);
  const codes = (r, st, o) => ui.auditReport(r, st, o).map((i) => i.code).sort();
  assert.deepEqual(codes(ok.replace('[a1] PASS', '[a1] FAIL'), 'VERIFIED', { seen: ['heading "Login"'], actions: 1 }), ['status-mismatch', 'ui-findings-empty']);
  assert.deepEqual(codes(ok, 'FAILED', { seen: ['heading "Login"'], actions: 1 }), ['status-mismatch']);
  assert.deepEqual(codes('STATUS: VERIFIED\n[s1] PASS — x\n[a1] PASS — y', 'VERIFIED', { actions: 1 }), ['missing-section']);
});

test('auditReport: quoted texts of PASS lines must have been shown by the browser or typed by the agent', () => {
  const r = '## Steps\n[s1] PASS — fill textbox "Email" with "a@b.test" → heading "Welcome"\n[s2] FAIL — click "Next" → page "Nowhere"\n## Checks\n[a1] PASS — text "Order 42 placed" (after s1)\n## Findings\n- Next is broken';
  const seen = ['- textbox "Email" [ref=e2]\n- heading "Welcome" [level=1]', '{"element":"Email","text":"a@b.test"}'];
  const iss = ui.auditReport(r, 'FAILED', { seen, actions: 3 });
  assert.deepEqual(iss.map((i) => i.code), ['ui-text-not-seen']);
  assert.deepEqual(iss[0].items, ['[a1] "Order 42 placed"'], 'FAIL lines are not checked: they quote what was expected');
  assert.deepEqual(ui.auditReport(r, 'FAILED', { seen: [], actions: 3, seenRecorded: false }), [], 'no snapshots recorded (older runner): no claim check');
});

test('auditReport: steps without browser actions are caught', () => {
  const r = '## Steps\n' + Array.from({ length: 9 }, (_, i) => `[s${i + 1}] PASS — step`).join('\n') + '\n## Checks\n[a1] PASS — ok\n## Findings\nNone';
  assert.deepEqual(ui.auditReport(r, 'VERIFIED', { actions: 0 }).map((i) => i.code), ['ui-no-actions']);
  assert.deepEqual(ui.auditReport(r, 'VERIFIED', { actions: 2 }).map((i) => i.code), ['ui-steps-without-actions']);
  assert.deepEqual(ui.auditReport(r, 'VERIFIED', { actions: 4 }), []);
});

test('correction prompt for a UI report names the problems and keeps the format', () => {
  const p = require('../lib/report-format').correctionPrompt('uitest', [{ code: 'ui-text-not-seen', text: '1 quoted text never appeared' }]);
  assert.match(p, /never appeared/); assert.match(p, /take a snapshot now/); assert.match(p, /Never write the password/);
});
