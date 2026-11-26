// Mutation testing autotestów (lib/mutation-proxy.js): proxy mutuje odpowiedzi API, suita biegnie dla każdego
// mutanta. Suita sprawdzająca pola i stan zabija mutanty; suita sprawdzająca tylko kody statusu je przepuszcza.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const shop = require('../bench/shop-app');
const mut = require('../lib/mutation-proxy');

// Dwie suity tej samej aplikacji: te same wywołania, różne asercje.
const SUITE = (strong) => `
const B = process.env.BASE_URL;
const j = (m, p, b) => fetch(B + p, { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b) }).then(async (r) => ({ s: r.status, b: await r.json() }));
const ok = (c, msg) => { if (!c) { console.error('FAIL ' + msg); process.exit(1); } };
(async () => {
  const o = await j('POST', '/orders', { customerId: 'C1', quantity: 5, currency: 'EUR', note: 'leave at door', express: true });
  ok(o.s === 201, 'create');
  const g = await j('GET', '/orders/' + o.b.id);
  ok(g.s === 200, 'get');
  ${strong ? "ok(g.b.quantity === 5 && g.b.currency === 'EUR' && g.b.note === 'leave at door' && g.b.express === true && g.b.state === 'created' && g.b.customerId === 'C1', 'stored order');" : ''}
  const bad = await j('POST', '/orders', { customerId: 'C1', quantity: 101, currency: 'EUR' });
  ${strong ? "ok(bad.s === 400, 'reject 101');" : "ok(bad.s < 500, 'no crash');"}
  const d = await j('POST', '/discounts/quote', { premium: true, total: 100 });
  ok(d.s === 200, 'quote');
  ${strong ? "ok(d.b.discount === 10, 'discount');" : ''}
  const l = await j('GET', '/orders');
  ${strong ? "ok(Array.isArray(l.b) && l.b.some((x) => x.id === o.b.id && x.quantity === 5), 'list');" : "ok(l.s === 200, 'list');"}
})();
`;

test('mutation testing: mocna suita zabija mutanty, suita "tylko status" je przepuszcza i dostaje listę luk', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-'));
  fs.writeFileSync(path.join(dir, 'strong.js'), SUITE(true));
  fs.writeFileSync(path.join(dir, 'weak.js'), SUITE(false));
  const scores = {};
  for (const kind of ['strong', 'weak']) {
    const app = await shop.start({ bugs: false });
    try {
      const r = await mut.run({ target: app.url, cmd: `node ${kind}.js`, cwd: dir, timeoutMs: 20000, max: 30 });
      scores[kind] = r;
    } finally { await app.close(); }
  }
  const s = scores.strong, w = scores.weak;
  assert.ok(s.baseline.ok && w.baseline.ok);
  assert.ok(s.mutants.length >= 20, String(s.mutants.length));
  // Wynik mówi prawdę o asercjach, nie o "sile" suity w ogóle:
  const res = (r, ep) => r.mutants.filter((m) => m.endpoint === ep).map((m) => m.result);
  // — mocna suita sprawdza zapisane zamówienie (GET /orders/{id}) i rabat: każdy mutant tych odpowiedzi zabity,
  for (const ep of ['GET /orders/{id}', 'POST /discounts/quote']) assert.ok(res(s, ep).length && res(s, ep).every((x) => x === 'killed'), `${ep}: ${res(s, ep)}`);
  // — ale nie sprawdza ciała odpowiedzi POST /orders (tylko status), więc te mutanty przeżywają i są wypisane,
  assert.ok(s.survivors['POST /orders'].some((x) => /quantity: 5 → 6/.test(x)), JSON.stringify(s.survivors));
  assert.ok(!s.survivors['POST /orders'].some((x) => /400 error → 200 OK/.test(x)), 'odrzucenie 101 jest sprawdzane');
  // — suita "tylko status" nie zabija niczego: każda zmiana danych przechodzi niezauważona.
  assert.equal(w.score, 0);
  assert.ok(s.score > 40 && s.score > w.score + 40, `strong ${s.score} weak ${w.score}`);
  assert.ok(w.survivors['POST /orders'].some((x) => /400 error → 200 OK/.test(x)));
});

test('mutanty: pola identyfikatorów i dat nie są mutowane, kolejność stała, szablon ścieżki', () => {
  const rec = { 'GET /orders/{id}': { ok: { status: 200, body: { id: '7', createdAt: 'x', total: 3, items: [{ sku: 'a', qty: 1 }], paid: false } } } };
  const a = mut.generate(rec), b = mut.generate(rec);
  assert.deepEqual(a, b);
  assert.ok(!a.some((m) => /^(id|createdAt)$/.test(m.path)));
  assert.ok(a.some((m) => m.op === 'num+1' && m.path === 'items[0].qty'));
  assert.equal(mut.template('/orders/42/items/3fa85f64-5717-4562-b3fc-2c963f66afa6?x=1'), '/orders/{id}/items/{id}');
  assert.deepEqual(mut.apply({ op: 'num+1', path: '[0].qty' }, 200, [{ qty: 1 }, { qty: 2 }]).body, [{ qty: 2 }, { qty: 3 }]);
  assert.equal(mut.apply({ op: 'num+1', path: 'total' }, 404, { total: 1 }), null);
});

test('suita zależna od stanu danych (pada przy powtórce): brak wyniku zamiast zawyżonej liczby', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-state-'));
  fs.writeFileSync(path.join(dir, 'stateful.js'), `fetch(process.env.BASE_URL + '/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ customerId: 'C', quantity: 1, currency: 'PLN' }) })
    .then(() => fetch(process.env.BASE_URL + '/orders')).then((r) => r.json()).then((l) => process.exit(l.length === 1 ? 0 : 1));`);
  const app = await shop.start({ bugs: false });
  try {
    const r = await mut.run({ target: app.url, cmd: 'node stateful.js', cwd: dir, timeoutMs: 10000 });
    assert.equal(r.baseline.repeatable, false);
    assert.match(r.error, /depends on state left by an earlier run/);
  } finally { await app.close(); }
});

test('suita czerwona bez mutantów: brak wyniku zamiast mylącej liczby', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-red-'));
  fs.writeFileSync(path.join(dir, 'red.js'), 'process.exit(1)');
  const app = await shop.start({ bugs: false });
  try {
    const r = await mut.run({ target: app.url, cmd: 'node red.js', cwd: dir, timeoutMs: 10000 });
    assert.equal(r.baseline.ok, false);
    assert.match(r.error, /fails without any mutant/);
  } finally { await app.close(); }
});
