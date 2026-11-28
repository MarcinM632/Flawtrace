// The benchmark itself: every seeded defect must really be in the shop, every trap must really behave as the ticket says,
// the git repo must carry the change on its branch, and the scorer must tell a good report from a shallow or noisy one.
// No model is called here; the live run is scripts/eval.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { build, BRANCH } = require('../eval/build-shop');
const { DEFECTS, TRAPS, TICKETS } = require('../eval/expected');
const { score, findings, summary } = require('../lib/eval-score');

const built = build();
const { server } = require(path.join(built.app, 'server.js'));
let base = '';
test.before(() => new Promise((r) => server.listen(0, '127.0.0.1', () => { base = 'http://127.0.0.1:' + server.address().port; r(); })));
test.after(() => { server.close(); fs.rmSync(built.outDir, { recursive: true, force: true }); });

async function call(method, p, body, token) {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
let n = 0;
const uniq = () => `u${Date.now()}${++n}@shop.test`;
async function signIn() {
  const email = uniq();
  await call('POST', '/api/auth/register', { email, password: 'Secret123', name: 'Tester' });
  return (await call('POST', '/api/auth/login', { email, password: 'Secret123' })).body.token;
}
const lamp = 7, notebook = 8, coffeeGrinder = 16, backpack = 12;

test('the repo has develop and the change branch, and the change touches the discount files and the shipping threshold', () => {
  const branches = execFileSync('git', ['-C', built.origin, 'branch', '--list'], { encoding: 'utf8' });
  assert.match(branches, /develop/); assert.ok(branches.includes(BRANCH));
  const diff = execFileSync('git', ['-C', built.app, 'diff', '--stat', 'origin/develop...HEAD'], { encoding: 'utf8' });
  for (const f of ['src/discounts.js', 'src/cart.js', 'src/config.js', 'server.js', 'public/app.js', 'openapi.json']) assert.ok(diff.includes(f), f + ' in the diff');
  assert.ok(!diff.includes('src/orders.js'), 'orders.js is the consumer the change forgot (W6)');
});

test('every ticket file exists and every defect and trap points at a known ticket', () => {
  for (const t of Object.values(TICKETS)) assert.ok(fs.existsSync(path.join(__dirname, '..', 'eval', 'tickets', t.file)));
  for (const d of [...DEFECTS, ...TRAPS]) assert.ok(TICKETS[d.ticket], d.id);
  assert.ok(DEFECTS.length >= 25, 'at least 25 seeded defects');
  assert.strictEqual(new Set(DEFECTS.map((d) => d.id)).size, DEFECTS.length, 'unique ids');
});

// ---- the seeded defects are really there (one probe per defect that the running shop can show)
test('R1 duplicate check is case-sensitive', async () => {
  const e = uniq();
  assert.strictEqual((await call('POST', '/api/auth/register', { email: e, password: 'Secret123', name: 'A' })).status, 201);
  assert.strictEqual((await call('POST', '/api/auth/register', { email: e.toUpperCase(), password: 'Secret123', name: 'A' })).status, 201);
  assert.strictEqual((await call('POST', '/api/auth/register', { email: e, password: 'Secret123', name: 'A' })).status, 409, 'exact duplicates are still caught');
});
test('R2 an 8-character password is rejected, 9 is accepted', async () => {
  assert.strictEqual((await call('POST', '/api/auth/register', { email: uniq(), password: 'Secret12', name: 'A' })).status, 400);
  assert.strictEqual((await call('POST', '/api/auth/register', { email: uniq(), password: 'Secret123', name: 'A' })).status, 201);
});
test('R3 the registration response has passwordHash; T1 the email is saved in lower case', async () => {
  const r = await call('POST', '/api/auth/register', { email: 'Mixed' + uniq(), password: 'Secret123', name: 'A' });
  assert.ok(r.body.passwordHash);
  assert.strictEqual(r.body.email, r.body.email.toLowerCase());
});
test('R4 an unknown email gets 404 User not found; a wrong password gets 401', async () => {
  const u = await call('POST', '/api/auth/login', { email: uniq(), password: 'Whatever1' });
  assert.deepStrictEqual([u.status, u.body.error], [404, 'User not found']);
  const w = await call('POST', '/api/auth/login', { email: 'demo@shop.test', password: 'Wrong1234' });
  assert.deepStrictEqual([w.status, w.body.error], [401, 'Invalid email or password']);
});
test('R5 the account never locks; T2 expiresIn is 3600', async () => {
  const email = uniq();
  await call('POST', '/api/auth/register', { email, password: 'Secret123', name: 'A' });
  for (let i = 0; i < 6; i++) assert.strictEqual((await call('POST', '/api/auth/login', { email, password: 'Wrong1234' })).status, 401);
  const ok = await call('POST', '/api/auth/login', { email, password: 'Secret123' });
  assert.strictEqual(ok.status, 200, 'no 423 after 6 failures');
  assert.strictEqual(ok.body.expiresIn, 3600);
});
test('R6 R7 P5 P6 P7 U1 the front end has the seeded UI defects', () => {
  const ui = fs.readFileSync(path.join(built.app, 'public', 'app.js'), 'utf8');
  assert.match(ui, /at least 6 characters/);          // R6
  assert.match(ui, /esc\(s\.user\.email\)/);            // R7
  assert.ok(!/No products found/.test(ui));             // P5
  assert.match(ui, /const money = \(n\) => n \+ ' PLN'/); // P6
  assert.match(ui, /page > pages \? 'disabled'/);       // P7
  assert.match(ui, /'Code applied: ' \+ code/);         // U1: shown whatever the answer was
});
test('P1 search is case-sensitive; T3 a one-character query lists everything', async () => {
  assert.strictEqual((await call('GET', '/api/products?q=MUG')).body.items.length, 0);
  assert.ok((await call('GET', '/api/products?q=mug')).body.items.length > 0);
  assert.strictEqual((await call('GET', '/api/products?q=m&pageSize=50')).body.items.length, 23);
});
test('P2 pageSize 51..100 is accepted, 101 is not', async () => {
  assert.strictEqual((await call('GET', '/api/products?pageSize=51')).status, 200);
  assert.strictEqual((await call('GET', '/api/products?pageSize=101')).status, 400);
  assert.strictEqual((await call('GET', '/api/products?page=0')).status, 400);
});
test('P3 total is the whole catalogue; P4 sorting puts "eco bag" last', async () => {
  const r = (await call('GET', '/api/products?q=mug')).body;
  assert.strictEqual(r.total, 23); assert.ok(r.items.length < 23);
  const all = (await call('GET', '/api/products?pageSize=50')).body.items.map((p) => p.name);
  assert.strictEqual(all[all.length - 1], 'eco bag');
});
test('W1 W7 the percentage is taken off subtotal + shipping and rounded down', async () => {
  const t = await signIn();
  await call('POST', '/api/cart/items', { productId: lamp, quantity: 1 }, t); // 129.99 + 15.00 shipping
  const c = (await call('POST', '/api/cart/discount', { code: 'SAVE10' }, t)).body;
  assert.strictEqual(c.discount, 14, 'floor(10% of 144.99); the ticket says 13.00');
});
test('W3 codes stack; W4 codes are case-sensitive', async () => {
  const t = await signIn();
  await call('POST', '/api/cart/items', { productId: coffeeGrinder, quantity: 1 }, t); // 219.00
  await call('POST', '/api/cart/discount', { code: 'FIXED20' }, t);
  const c = (await call('POST', '/api/cart/discount', { code: 'FIXED20' }, t)).body;
  assert.deepStrictEqual([c.codes.length, c.discount], [2, 40]);
  assert.strictEqual((await call('POST', '/api/cart/discount', { code: 'fixed20' }, t)).status, 404);
});
test('W5 shipping is charged up to 300; W6 the order drops the discount', async () => {
  const t = await signIn();
  await call('POST', '/api/cart/items', { productId: coffeeGrinder, quantity: 1 }, t); // 219.00 >= 200, below 300
  const c = (await call('POST', '/api/cart/discount', { code: 'FIXED20' }, t)).body;
  assert.strictEqual(c.shipping, 15);
  assert.strictEqual(c.total, 214);
  const o = (await call('POST', '/api/orders', null, t)).body;
  assert.strictEqual(o.total, 234, 'subtotal + shipping, discount lost');
  assert.strictEqual(o.code, undefined);
});
test('W2 the last day is excluded in the code (whitebox only)', () => {
  const src = fs.readFileSync(path.join(built.app, 'src', 'discounts.js'), 'utf8');
  assert.match(src, /now < new Date\(def\.validUntil\)\.getTime\(\)/);
  const { isValid, CODES } = require(path.join(built.app, 'src', 'discounts.js'));
  assert.strictEqual(isValid(CODES.SAVE10, new Date('2026-12-31T12:00:00Z').getTime()), false);
});
test('T4 an expired code is 422; T5 FIXED20 at exactly 150.00 is accepted', async () => {
  const t = await signIn();
  await call('POST', '/api/cart/items', { productId: backpack, quantity: 1 }, t); // 199.00
  assert.deepStrictEqual(Object.values(await call('POST', '/api/cart/discount', { code: 'OLD5' }, t)).map((x) => x.error || x), [422, 'Code expired']);
  const t2 = await signIn();
  await call('POST', '/api/cart/items', { productId: notebook, quantity: 12 }, t2); // 12 x 12.50 = 150.00
  assert.strictEqual((await call('POST', '/api/cart/discount', { code: 'FIXED20' }, t2)).status, 200);
});

// ---- the scorer
const STATIC_GOOD = `STATUS: STATIC OK
--- TREŚĆ ---
## Verdict
NEEDS REWORK
## Findings
1. [Consistency] [Major] The lock duration is 15 minutes in the description and 30 minutes in the acceptance criteria.
2. [Testability] [Minor] "Sign-in must be secure" is vague: no measurable criterion.
## Open questions
- What is the maximum length of the name?
--- KONIEC TREŚCI ---`;
const API_GOOD = `STATUS: BŁĄD
--- TREŚĆ ---
WYNIK: 3 errors.
KROKI:
1. Registered a@x.com [c1].
BŁĘDY:
### Duplicate email in upper case is accepted
KROK: 2
ENDPOINT: \`register\`
OCZEKIWANO: 409 for A@X.COM after a@x.com (case-insensitive)
OTRZYMANO: 201 [c2]
RODZAJ: PRODUKT
### Registration response leaks the password hash
KROK: 3
ENDPOINT: \`register\`
OCZEKIWANO: no password data
OTRZYMANO: passwordHash present [c3]
RODZAJ: PRODUKT
### The email is saved in lower case instead of as typed
KROK: 4
ENDPOINT: \`register\`
OCZEKIWANO: email as typed
OTRZYMANO: lower-cased [c4]
RODZAJ: PRODUKT
STAN KOŃCOWY: nothing to clean.
--- KONIEC TREŚCI ---`;
const UI_GOOD = `STATUS: FAILED
--- TREŚĆ ---
## Steps
[s1] PASS — filled textbox "Password" with 7 characters → message shown
[s2] FAIL — clicked "Create account" → the message says "Password must be at least 6 characters", the rule is 8
## Checks
[a1] PASS — heading "Create an account"
## Findings
- After sign-in the header shows the email demo@shop.test instead of the name "Demo Customer".
--- KONIEC TREŚCI ---`;

test('scorer: finds the defects in good reports, counts the trap as a false alarm, and per phase', () => {
  const s = score({ 'BENCH-1': { static: STATIC_GOOD, whitebox: '', api: API_GOOD, ui: UI_GOOD } }, { DEFECTS, TRAPS });
  const ids = s.foundList.map((d) => d.id).sort();
  assert.deepStrictEqual(ids, ['R1', 'R3', 'R6', 'R7', 'S1', 'S2', 'S3']);
  assert.strictEqual(s.total, 10);
  assert.deepStrictEqual(s.falseAlarmList.map((f) => f.id), ['T1']);
  assert.deepStrictEqual([s.phase.static.found, s.phase.static.expected], [3, 3]);
  assert.deepStrictEqual([s.phase.api.found, s.phase.api.expected], [2, 5]);
  assert.strictEqual(s.phase.whitebox.ran, false);
  assert.match(summary(s), /Detected 7\/10/);
});

test('scorer: an empty or shallow run finds nothing, and a design report is never scored as findings', () => {
  const s = score({ 'BENCH-2': { static: 'STATUS: STATIC OK\n## Findings\nNone', whitebox: '', api: 'STATUS: SUKCES\n--- TREŚĆ ---\nWYNIK: all good\nKROKI:\n1. ok [c1]\n--- KONIEC TREŚCI ---', ui: '' } }, { DEFECTS, TRAPS });
  assert.strictEqual(s.found, 0); assert.strictEqual(s.total, 9); assert.strictEqual(s.falseAlarms, 0);
  assert.deepStrictEqual(findings('design', '## 1. Search is case-insensitive'), []);
});

test('scorer: a PASS line that mentions the fact is not a finding; a JSON findings block wins over the text', () => {
  const pass = '## Steps\n[s1] PASS — searched "MUG", case does not matter\n## Findings\nNone';
  assert.deepStrictEqual(findings('ui', pass), []);
  const j = 'STATUS: FAILED\n```json\n{"findings":[{"title":"Search is case-sensitive","detail":"q=MUG returns no result"}]}\n```';
  const s = score({ 'BENCH-2': { static: '', whitebox: '', api: j, ui: '' } }, { DEFECTS, TRAPS });
  assert.deepStrictEqual(s.foundList.map((d) => d.id), ['P1']);
});

test('scorer: whitebox findings are read from the Analyses format, including the outside-the-change line', () => {
  const wb = `BENCH-3
1. Percentage discount includes shipping
Co się dzieje: amountOf computes (subtotal + shipping) * value
Powinno być: discount on the item subtotal only
Dowód: src/discounts.js:17
2. Discount rounded down with Math.floor
Co się dzieje: 10% of 129.99 becomes 12
Dowód: src/discounts.js:17
Poza zmianą: FREE_SHIPPING_FROM changed from 200 to 300 in src/config.js`;
  const s = score({ 'BENCH-3': { static: '', whitebox: wb, api: '', ui: '' } }, { DEFECTS, TRAPS });
  assert.deepStrictEqual(s.foundList.map((d) => d.id).sort(), ['W1', 'W5', 'W7']);
  assert.deepStrictEqual([s.phase.whitebox.found, s.phase.whitebox.expected], [3, 4]);
});

test('stability: over rounds, a defect found every time, only sometimes, or never', () => {
  const { stability } = require('../lib/eval-score');
  const a = score({ 'BENCH-1': { static: STATIC_GOOD, whitebox: '', api: API_GOOD, ui: UI_GOOD } }, { DEFECTS, TRAPS });
  const b = score({ 'BENCH-1': { static: STATIC_GOOD, whitebox: '', api: '', ui: '' } }, { DEFECTS, TRAPS });
  const st = stability([a, b]);
  assert.deepStrictEqual(st.always.map((d) => d.id).sort(), ['S1', 'S2', 'S3']);
  assert.deepStrictEqual(st.sometimes.map((d) => d.id).sort(), ['R1', 'R3', 'R6', 'R7']);
  assert.deepStrictEqual(st.never.map((d) => d.id).sort(), ['R2', 'R4', 'R5']);
  assert.strictEqual(st.sometimes[0].rounds, 2);
});

test('patterns credit the right finding (cases seen in the first live run)', () => {
  const { matches } = require('../lib/eval-score');
  const byId = Object.fromEntries([...DEFECTS, ...TRAPS].map((d) => [d.id, d]));
  // R2 is the 8-character case, not the duplicate-email finding or a 7-character check.
  assert.ok(matches(byId.R2, 'High: a valid 8-character password is rejected\nexpected: Abcdef12 returns 201\ngot: 400'));
  assert.ok(!matches(byId.R2, 'High: the same email can be registered more than once\nexpected: 409 for a mixed-case repeat, also for 8 accounts'));
  assert.ok(!matches(byId.R2, 'Comparison: with 7 characters, POST /api/auth/register returned 400 and the alert showed the 8-characters-and-a-digit rule.'));
  // S3 is a limit of the name, not a finding about the 6-character rule of the form.
  assert.ok(matches(byId.S3, 'Are there maximum lengths for name, email and password? No source gives one.'));
  assert.ok(!matches(byId.S3, '[Inconsistency] [Major] Existing behaviour: the registration form shows a 6-character rule. Name of the file: app.js'));
  // T2 is a complaint about the token lifetime, not a login answer that happens to show expiresIn.
  assert.ok(!matches(byId.T2, 'Critical: five wrong passwords do not lock the account. expected: 423. got: Status 200 with a token and expiresIn 3600'));
  assert.ok(matches(byId.T2, 'The token expiresIn 3600 is too short for a working day'));
});
