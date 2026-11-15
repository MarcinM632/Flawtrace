const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fix = require('../lib/ui-fix');

const write = (root, rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
function project() {
  const orig = fs.mkdtempSync(path.join(os.tmpdir(), 'fix-o-')), mod = fs.mkdtempSync(path.join(os.tmpdir(), 'fix-n-'));
  for (const root of [orig, mod]) {
    write(root, 'pages/SecureAreaPage.ts', "this.logoutLink = page.getByRole('link', { name: 'Sign out' });\n");
    write(root, 'tests/logout.spec.ts', "await expect(page).toHaveURL(/login/);\n");
  }
  return { orig, mod, done: () => [orig, mod].forEach((d) => fs.rmSync(d, { recursive: true, force: true })) };
}
const SELECTOR = [{ test: 't', class: 'SELECTOR' }];

test('parseVerdicts reads the block, also in a code fence, and drops malformed rows', () => {
  const ok = 'text\nFIX_RESULT_JSON\n```json\n[{"test":"a","class":"SELECTOR","why":"w","evidence":"e"},{"test":"b","class":"WHATEVER"},{"class":"APP_BUG"}]\n```\nEND_FIX_RESULT_JSON';
  assert.deepStrictEqual(fix.parseVerdicts(ok), [{ test: 'a', class: 'SELECTOR', why: 'w', evidence: 'e' }]);
  assert.deepStrictEqual(fix.parseVerdicts('no block'), []);
  assert.deepStrictEqual(fix.parseVerdicts('FIX_RESULT_JSON\nnot json\nEND_FIX_RESULT_JSON'), []);
});

test('a locator change in a page object is allowed when a test was judged SELECTOR, and the diff shows it', () => {
  const p = project();
  write(p.mod, 'pages/SecureAreaPage.ts', "this.logoutLink = page.getByRole('link', { name: 'Logout' });\n");
  const files = fix.reviewPatch(p.orig, p.mod, SELECTOR);
  assert.strictEqual(files.length, 1);
  assert.strictEqual(files[0].path, 'pages/SecureAreaPage.ts');
  assert.strictEqual(files[0].problem, '');
  assert.match(files[0].diff, /-this\.logoutLink = .*Sign out/);
  assert.match(files[0].diff, /\+this\.logoutLink = .*Logout/);
  p.done();
});

test('tests, assertions and config can never be changed by a repair', () => {
  const p = project();
  write(p.mod, 'tests/logout.spec.ts', "await expect(page).toHaveURL(/home/);\n");
  write(p.mod, 'playwright.config.ts', 'export default {};\n');
  const files = fix.reviewPatch(p.orig, p.mod, SELECTOR);
  assert.strictEqual(files.length, 2);
  for (const f of files) assert.match(f.problem, /Only page objects/);
  p.done();
});

test('a patch that adds a sleep, a forced click or a networkidle wait is refused', () => {
  for (const bad of ['await page.waitForTimeout(3000);', "await this.logoutLink.click({ force: true });", "await page.waitForLoadState('networkidle');"]) {
    const p = project();
    write(p.mod, 'pages/SecureAreaPage.ts', "this.logoutLink = page.getByRole('link', { name: 'Logout' });\n" + bad + '\n');
    const files = fix.reviewPatch(p.orig, p.mod, SELECTOR);
    assert.match(files[0].problem, /makes a test slow or hides a real problem/, bad);
    p.done();
  }
});

test('with no SELECTOR verdict (only APP_BUG or UNCLEAR) no change goes through, even in a page object', () => {
  const p = project();
  write(p.mod, 'pages/SecureAreaPage.ts', "this.logoutLink = page.getByRole('link', { name: 'Logout' });\n");
  for (const cls of ['APP_BUG', 'UNCLEAR']) {
    const files = fix.reviewPatch(p.orig, p.mod, [{ test: 't', class: cls }]);
    assert.match(files[0].problem, /No test was judged to have an outdated locator/);
  }
  p.done();
});

test('a new file in pages/ is not a repair, and an untouched copy gives no files', () => {
  const p = project();
  assert.deepStrictEqual(fix.reviewPatch(p.orig, p.mod, SELECTOR), []);
  write(p.mod, 'pages/NewPage.ts', 'export class NewPage {}\n');
  const files = fix.reviewPatch(p.orig, p.mod, SELECTOR);
  assert.match(files[0].problem, /New files are not part of a repair/);
  p.done();
});

test('only pages/*.ts passes the path rule, and a path cannot climb out of pages/', () => {
  for (const ok of ['pages/A.ts', 'pages/sub/B.ts', 'pages/Login-Page.ts']) assert.ok(fix.ALLOWED.test(ok), ok);
  for (const no of ['tests/a.spec.ts', 'pages/../tests/a.ts', 'pages/./a.ts', 'pages/a.js', '../pages/a.ts', 'playwright.config.ts', 'pages/a b.ts', 'pages/a.ts.js', 'pages//a.ts']) assert.ok(!fix.ALLOWED.test(no), no);
});

test('apply and reject need a patch that is waiting, and say so otherwise', () => {
  const code = (fn, meta) => { try { fn({ meta }); return null; } catch (e) { return e.code; } };
  assert.strictEqual(code(fix.applyFix, {}), 409);
  assert.strictEqual(code(fix.rejectFix, { testFix: { state: 'applied' } }), 409);
  assert.strictEqual(code(fix.applyFix, { testFix: { state: 'ready', files: [{ path: 'pages/A.ts', problem: 'x' }] } }), 409);
});

test('startFix refuses what cannot be analysed', () => {
  const code = (meta) => { try { fix.startFix({ meta }, {}); return null; } catch (e) { return e.code; } };
  assert.strictEqual(code({ id: 'a', agent: 'qamcp' }), 400);
  assert.strictEqual(code({ id: 'a', agent: 'autotest', stack: 'ts-playwright', testRun: { state: 'passed', stats: { failed: 0 } } }), 409);
  assert.strictEqual(code({ id: 'a', agent: 'autotest', stack: 'ts-playwright', testRun: { state: 'failed', stats: { failed: 1 } }, staging: { dir: path.join(os.tmpdir(), 'no-such-xyz') } }), 410);
});

test('reconcile marks an analysis interrupted by a restart', () => {
  const meta = { id: 'z', testFix: { state: 'analyzing', startedAt: 1 } };
  fix.reconcile(meta);
  assert.strictEqual(meta.testFix.state, 'error');
  assert.match(meta.testFix.error, /restarted/);
});

test('the helper files the app writes for the agent are not listed as changes', () => {
  const p = project();
  write(p.mod, 'failures.md', '# Failing tests\n');
  write(p.mod, 'verified-report.md', '## Steps\n');
  write(p.mod, 'evidence/1/error-context.md', 'x');
  assert.deepStrictEqual(fix.reviewPatch(p.orig, p.mod, SELECTOR), []);
  p.done();
});
