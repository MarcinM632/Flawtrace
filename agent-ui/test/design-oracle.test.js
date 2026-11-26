// Wyrocznia i śledzalność Test design (lib/design-oracle.js): źródła rozwiązywane w prawdziwych materiałach,
// pokrycie technik mierzone z "ci:", sprzeczności z wyrocznią i luki w regułach — bez modelu.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const o = require('../lib/design-oracle');
const { correctionPrompt } = require('../lib/report-format');

const doc = { openapi: '3.0.0', paths: { '/orders': { post: { requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['quantity'], properties: { quantity: { type: 'integer', minimum: 1, maximum: 100 } } } } } } } } } };
const models = [{ kind: 'decision-table', id: 'discount', src: 'SHOP-1', conditions: [{ name: 'premium' }, { name: 'total', threshold: 100, op: '>=' }],
  rules: [{ when: { premium: true, total: true }, then: { discount: 10 } }, { when: { premium: true, total: false }, then: { discount: 5 } }, { when: { premium: false, total: true }, then: { discount: 5 } }] }];

const kbDir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-kb-'));
  fs.mkdirSync(path.join(d, 'services'));
  fs.writeFileSync(path.join(d, 'services', 'shop.json'), JSON.stringify({ source: 'shop', sections: { capabilities: { items: [{ name: 'orders' }] }, risks: { items: [] } } }));
  return d;
};
const TICKET = 'SHOP-1 Orders with a discount: a premium customer with a total of 100 or more gets 10%, below 100 gets 5%; other customers get 5% from 100.';
const ctx = (extra = {}) => o.context({ ticket: TICKET, docs: [doc], models, bugs: [{ source: 'jira:SHOP-7' }], knowledgeDir: kbDir(), ...extra });
const codes = (r) => r.issues.map((i) => i.code).sort();

const GOOD = `SHOP-1 — Orders
Business cases: BC1 customer orders a full pallet→§1 | BC2 premium customer gets a discount→§2 | BC3 ordering on a holiday→To confirm
Bug patterns: none for shop
## 1. Customer orders the largest allowed quantity [Boundary value analysis]
- POST /orders quantity=100 => 201 created, GET /orders shows quantity 100 (src: SHOP-1; POST /orders; ci: BVA:post-orders:quantity:max)
- POST /orders quantity=101 => 422 rejected, nothing stored (src: SHOP-1; ci: BVA:post-orders:quantity:max+1)
- POST /orders quantity=0 => 422 rejected, nothing stored (src: bug:SHOP-7; ci: BVA:post-orders:quantity:min-1)
Not covered: BVA:post-orders:quantity:min — the same code path as max, covered above
## 2. Premium customer gets the discount [Decision table]
- premium, total 100 => discount 10 (src: SHOP-1; kb:shop#capabilities; ci: DT:discount:1)
- premium, total 99 => discount 5 (src: SHOP-1; ci: DT:discount:2)
- not premium, total 100 => discount 5 (src: SHOP-1; ci: DT:discount:3)
Not covered: nothing
## Summary
x | y
## To confirm
- DT:discount:4 — no rule for a non-premium customer below 100: no discount or an error?
`;

test('raport zgodny z wyrocznią i źródłami: brak zarzutów, pełne pokrycie, macierz śledzalności', () => {
  const r = o.audit(GOOD, ctx());
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.techniques.byTechnique, { BVA: { required: 4, covered: 3, excused: 1 }, DT: { required: 4, covered: 3, excused: 1 } });
  assert.equal(r.traceability.summary.checks, 6);
  assert.equal(r.traceability.summary.traced, 6);
  assert.deepEqual(r.traceability.rows[0].bc, ['BC1']);
  assert.deepEqual(r.traceability.rows[0].sources.map((s) => s.status), ['resolved', 'resolved']);
  const csv = o.traceabilityCsv(r.traceability).split('\n');
  assert.equal(csv.length, 7);
  assert.match(csv[1], /"BC1","1",.*"BVA:post-orders:quantity:max","traced"/);
});

test('źródło, którego nie ma: obcy klucz, endpoint spoza specyfikacji, bug spoza rejestru, pusta sekcja bazy wiedzy', () => {
  const bad = GOOD
    .replace('(src: SHOP-1; POST /orders; ci: BVA:post-orders:quantity:max)', '(src: PRJ-999; GET /nope; ci: BVA:post-orders:quantity:max)')
    .replace('(src: bug:SHOP-7;', '(src: bug:SHOP-404;')
    .replace('(src: SHOP-1; kb:shop#capabilities;', '(src: kb:shop#risks;');
  const r = o.audit(bad, ctx());
  const u = r.issues.find((i) => i.code === 'oracle-unresolved');
  assert.ok(u, JSON.stringify(r.issues));
  assert.equal(u.items.length, 3); // §1.1, §1.3 i §2.1 (jedyne źródło: pusta sekcja kb:shop#risks; samo ci: nie wystarcza)
  assert.ok(u.items[0].includes('PRJ-999') && u.items[0].includes('GET /nope is not in the imported specification'));
  const row = r.traceability.rows.find((x) => x.check === '§2.1');
  assert.equal(row.sources[0].status, 'unresolved');
  assert.match(row.sources[0].why, /section "risks" of "shop" is empty/);
});

test('bez danego źródła odwołanie jest "unchecked", a nie błędne', () => {
  const r = o.audit(GOOD, o.context({ ticket: '', docs: [], models: [] }));
  assert.ok(!r.issues.some((i) => i.code === 'oracle-unresolved'), JSON.stringify(r.issues));
  assert.equal(o.resolveRef('conf:Order rules', o.context({})).status, 'unchecked');
  assert.equal(o.resolveRef('src/FeeCalc.kt:41', o.context({})).status, 'code');
  assert.equal(o.resolveRef('something vague', o.context({})).kind, 'unknown');
});

test('wynik sprzeczny z wyrocznią: sukces dla wartości poza zakresem, zły rabat, wymyślony wynik kolumny bez reguły', () => {
  const bad = GOOD
    .replace('quantity=101 => 422 rejected, nothing stored', 'quantity=101 => 201 created')
    .replace('not premium, total 100 => discount 5', 'not premium, total 100 => discount 0')
    .replace('Not covered: nothing', '- not premium, total 99 => discount 0 (src: SHOP-1; ci: DT:discount:4)\nNot covered: nothing')
    .replace('- DT:discount:4 — no rule for a non-premium customer below 100: no discount or an error?', '- nothing');
  const r = o.audit(bad, ctx());
  const c = r.issues.find((i) => i.code === 'oracle-contradiction');
  assert.equal(c.items.length, 3, JSON.stringify(c.items));
  assert.match(c.items[0], /§1\.2 BVA:post-orders:quantity:max\+1: the source says the value is rejected/);
  assert.match(c.items[1], /§2\.3 DT:discount:3: the rule says discount = 5/);
  assert.match(c.items[2], /DT:discount:4: no rule in the source/);
  assert.ok(codes(r).includes('requirement-gap'));
});

test('niepełne pokrycie, technika bez elementów pokrycia i nieznany identyfikator wracają do agenta', () => {
  const bad = GOOD
    .replace('Not covered: BVA:post-orders:quantity:min — the same code path as max, covered above\n', '')
    .replace('(src: SHOP-1; ci: DT:discount:2)', '(src: SHOP-1; ci: DT:discount:9)')
    .replace('## Summary', '## 3. Order moves to shipped [State transition]\n- ship a paid order => status shipped (src: SHOP-1)\n## Summary');
  const r = o.audit(bad, ctx());
  assert.deepEqual(codes(r), ['technique-incomplete', 'technique-unknown-item', 'technique-untraced']);
  const inc = r.issues.find((i) => i.code === 'technique-incomplete');
  assert.deepEqual(inc.items.sort(), ['BVA:post-orders:quantity:min', 'DT:discount:2']);
  assert.match(r.issues.find((i) => i.code === 'technique-untraced').text, /§3 \[State transition\] \(no model in technique-models.json\)/);
  // Tura korekty dostaje instrukcję o technikach i o wyroczni.
  const p = correctionPrompt('design', r.issues);
  assert.match(p, /TECHNIKI LICZY APLIKACJA/);
  assert.match(p, /mcp__sources__test_design_items/);
});

test('modele z WORK_DIR/technique-models.json i teksty z WORK_DIR rozwiązują odwołania', () => {
  const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-wd-'));
  fs.writeFileSync(path.join(wd, 'technique-models.json'), JSON.stringify(models));
  fs.writeFileSync(path.join(wd, 'ticket.md'), 'Subtask SHOP-2: express shipping');
  const c = o.context({ ticket: TICKET, workDir: wd, docs: [doc] });
  assert.equal(c.models.length, 1);
  assert.equal(o.resolveRef('SHOP-2', c).status, 'resolved');
  assert.equal(o.resolveRef('SHOP-3', c).status, 'unresolved');
});

test('model reguł niezgodny ze źródłem: zły próg i wymyślony wynik wracają do agenta; poprawny przechodzi', () => {
  const wrong = [{ ...models[0], conditions: [{ name: 'premium' }, { name: 'total', threshold: 150, op: '>=' }], rules: [...models[0].rules.slice(0, 2), { when: { premium: false, total: true }, then: { discount: 7 } }] },
    { kind: 'state-machine', id: 'order', src: 'SHOP-1', initial: 'created', transitions: [{ from: 'created', event: 'pay', to: 'paid' }] },
    { kind: 'pairwise', id: 'p', parameters: { a: ['x', 'y'], b: ['1', '2'] } }];
  const r = o.audit(GOOD, ctx({ models: wrong }));
  const m = r.issues.find((i) => i.code === 'model-unverified');
  assert.ok(m, JSON.stringify(r.issues.map((i) => i.code)));
  assert.match(m.items[0], /model "discount".*threshold of "total".*result discount=7 of rule 3.*not found/);
  assert.match(m.items[1], /model "order".*state "created".*state "paid"/);
  assert.match(m.items[2], /model "p" has no "src"/);
  assert.deepEqual(r.techniques.modelCheck.map((x) => x.status), ['mismatch', 'mismatch', 'no-source']);
  assert.match(require('../lib/report-format').correctionPrompt('design', r.issues), /MODELE REGUŁ/);
  assert.deepEqual(o.audit(GOOD, ctx()).techniques.modelCheck, [{ id: 'discount', status: 'verified', missing: [] }]);
  // Źródło, którego nie da się przeczytać (strona Confluence nie zapisana), nie jest zarzutem.
  assert.equal(o.verifyModels(o.context({ models: [{ ...models[0], src: 'conf:Discount rules' }] })).report[0].status, 'unchecked');
});

test('cytat modelu: wartości sprawdzane w cytacie, cytat musi stać w źródle słowo w słowo', () => {
  const quote = 'a premium customer with a total of 100 or more gets 10%, below 100 gets 5%; other customers get 5% from 100.';
  assert.equal(o.verifyModels(ctx({ models: [{ ...models[0], quote }] })).report[0].status, 'verified');
  const fake = o.verifyModels(ctx({ models: [{ ...models[0], quote: 'premium customers get 10% from 100' }] }));
  assert.equal(fake.report[0].status, 'quote-mismatch');
  // Cytat z Confluence (strona niezapisana): sprawdzamy przynajmniej wartości w samym cytacie.
  const conf = o.verifyModels(o.context({ models: [{ ...models[0], src: 'conf:Discount rules', quote: 'premium from 100 gets 10%, otherwise 5%' }] }));
  assert.equal(conf.report[0].status, 'verified');
});

test('wyniki Static: ustalenie Critical/Major i otwarte pytanie bez odpowiedzi w projekcie wracają do agenta', () => {
  const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-static-'));
  fs.writeFileSync(path.join(wd, 'static-review.md'), `# Static review of the task
Verdict: NEEDS REWORK
## Findings
1. [Inconsistency] [Major] Discount threshold differs between the ticket and Confluence
Requirement: R2
Task says: from 100 PLN (src: SHOP-1)
System or source says: from 150 PLN (src: conf:Pricing)
Why it matters: customers get a wrong discount
Question for the author: is the threshold 100 PLN or 150 PLN?
2. [Gap] [Critical] Refund on cancellation is not described
Requirement: R5
Question for the author: is a cancelled paid order refunded automatically?
3. [Wording] [Minor] Typo in the title
## Scenarios that did not match
none
## Open questions
- Does the discount apply to the shipping cost too?
`);
  const c = ctx({ workDir: wd });
  const r = o.audit(GOOD, c);
  const st = r.issues.filter((i) => i.code === 'static-unaddressed');
  assert.equal(st.length, 2);
  assert.deepEqual(st[0].items, ['static #1 [Major] Discount threshold differs between the ticket and Confluence', 'static #2 [Critical] Refund on cancellation is not described']);
  assert.match(st[1].items[0], /shipping cost/);
  assert.deepEqual(r.techniques.static, { findings: 2, questions: 1, unaddressed: [1, 2], questionsMissing: 1 });
  // Odpowiedź wprost (static #1), własnymi słowami (zwrot przy anulowaniu) i pytanie przepisane do To confirm.
  const fixed = GOOD.replace('## To confirm\n', '## To confirm\n- static #1: is the discount threshold 100 PLN or 150 PLN?\n- Is a cancelled paid order refunded automatically (refund on cancellation)?\n- Does the discount apply to the shipping cost?\n');
  const r2 = o.audit(fixed, c);
  assert.ok(!r2.issues.some((i) => i.code === 'static-unaddressed'), JSON.stringify(r2.issues.filter((i) => i.code === 'static-unaddressed')));
  assert.match(require('../lib/report-format').correctionPrompt('design', r.issues), /WYNIKI STATIC/);
  // Bez przeglądu Static nic się nie zmienia.
  assert.equal(o.audit(GOOD, ctx()).techniques.static, null);
});
