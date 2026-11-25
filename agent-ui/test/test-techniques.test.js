// Silnik technik ISTQB (lib/test-techniques.js): elementy pokrycia liczone deterministycznie ze specyfikacji
// i z modeli reguł, ze stałymi identyfikatorami, oczekiwanym wynikiem i wyrocznią.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const t = require('../lib/test-techniques');

const doc = {
  openapi: '3.0.0',
  paths: {
    '/orders': {
      post: {
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } } },
      },
    },
  },
  components: {
    schemas: {
      Order: {
        type: 'object', required: ['customerId', 'quantity'],
        properties: {
          customerId: { type: 'string', minLength: 1, maxLength: 20 },
          quantity: { type: 'integer', minimum: 1, maximum: 100 },
          price: { type: 'number', exclusiveMinimum: 0, maximum: 999.99, multipleOf: 0.01 },
          currency: { type: 'string', enum: ['PLN', 'EUR'] },
          email: { type: 'string', format: 'email' },
          address: { type: 'object', properties: { zip: { type: 'string', maxLength: 6 } } },
        },
      },
    },
  },
};
const ids = (r) => r.items.map((x) => x.id);

test('BVA 2-punktowa: min-1, min, max, max+1 z oczekiwanym wynikiem i wyrocznią ze specyfikacji', () => {
  const r = t.build({ docs: [doc], endpoints: ['POST /orders'] });
  const q = r.items.filter((x) => x.target === 'BVA:post-orders:quantity');
  assert.deepEqual(q.map((x) => [x.label, x.value, x.expect]), [['min-1', 0, 'reject'], ['min', 1, 'accept'], ['max', 100, 'accept'], ['max+1', 101, 'reject']]);
  assert.equal(q[3].oracle, 'spec:POST /orders#quantity.maximum=100');
});

test('BVA 3-punktowa dodaje min+1 i max-1; liczby z krokiem multipleOf i exclusiveMinimum', () => {
  const r = t.build({ docs: [doc], endpoints: ['POST /orders'], bva: 3 });
  assert.deepEqual(r.items.filter((x) => x.target === 'BVA:post-orders:quantity').map((x) => x.label), ['min-1', 'min', 'min+1', 'max-1', 'max', 'max+1']);
  const p = r.items.filter((x) => x.target === 'BVA:post-orders:price');
  assert.deepEqual(p.map((x) => [x.label, x.value]), [['min-1', 0], ['min', 0.01], ['min+1', 0.02], ['max-1', 999.98], ['max', 999.99], ['max+1', 1000]]);
});

test('EP: partycje enum, poza enum, brak wymaganego, null, zły typ, zły format; długość tekstu jako BVA', () => {
  const r = t.build({ docs: [doc], endpoints: ['POST /orders'] });
  const all = ids(r);
  for (const id of ['EP:post-orders:currency:enum=PLN', 'EP:post-orders:currency:enum=EUR', 'EP:post-orders:currency:not-in-enum',
    'EP:post-orders:quantity:missing', 'EP:post-orders:quantity:null', 'EP:post-orders:quantity:wrong-type', 'EP:post-orders:quantity:non-integer',
    'EP:post-orders:email:bad-format', 'BVA:post-orders:customerId:len-max+1', 'BVA:post-orders:address.zip:len-max+1']) assert.ok(all.includes(id), id);
  assert.ok(!all.includes('EP:post-orders:currency:missing'), 'pole opcjonalne nie ma partycji "missing"');
  assert.equal(r.items.find((x) => x.id === 'BVA:post-orders:customerId:len-max+1').value.length, 21);
});

test('identyfikatory są stabilne: ten sam wejściowy model daje te same elementy w tej samej kolejności', () => {
  const a = t.build({ docs: [doc], endpoints: ['POST /orders'] }), b = t.build({ docs: [doc], endpoints: ['POST /orders'] });
  assert.deepEqual(ids(a), ids(b));
  assert.ok(t.build({ docs: [doc], endpoints: ['POST /nope'] }).problems[0].includes('not in the imported specification'));
});

test('tablica decyzyjna: kolumny, wartości na progu warunku, luka i sprzeczność reguł', () => {
  const r = t.decisionTable({
    id: 'discount', src: 'SHOP-1',
    conditions: [{ name: 'premium' }, { name: 'total', threshold: 100, op: '>=' }],
    rules: [
      { when: { premium: true, total: true }, then: { discount: 10 } },
      { when: { premium: true, total: false }, then: { discount: 5 } },
      { when: { premium: '-', total: true }, then: { discount: 5 } }, // nakłada się na regułę 1 z innym wynikiem
    ],
  });
  assert.equal(r.items.length, 4);
  assert.deepEqual(r.items[0].inputs, { premium: true, total: 100 });
  assert.deepEqual(r.items[1].inputs, { premium: true, total: 99 });
  assert.equal(r.items[0].expect, 'unknown'); // sprzeczność → brak jednego wyniku
  assert.deepEqual(r.items[2].expect, { action: { discount: 5 } });
  assert.equal(r.items[3].expect, 'unknown');
  assert.ok(r.problems.some((p) => /column 1 .*contradict/.test(p)));
  assert.ok(r.problems.some((p) => /column 4 .*no rule/.test(p)));
  assert.deepEqual(t.decisionTable({ id: 'x', conditions: [{ name: 'a', threshold: 10, op: '>' }], rules: [] }).items.map((x) => x.inputs.a), [11, 10]);
});

test('maszyna stanów: poprawne przejścia wymagane, ścieżka dojścia, niepoprawne opcjonalne, stan nieosiągalny', () => {
  const r = t.stateMachine({ id: 'order', initial: 'created', states: ['archived'], transitions: [
    { from: 'created', event: 'pay', to: 'paid' }, { from: 'paid', event: 'ship', to: 'shipped' }, { from: 'paid', event: 'cancel', to: 'cancelled' }] });
  const ship = r.items.find((x) => x.id === 'ST:order:paid+ship');
  assert.deepEqual(ship.path, ['pay']);
  assert.deepEqual(ship.expect, { state: 'shipped' });
  const bad = r.items.find((x) => x.id === 'ST:order:shipped+cancel');
  assert.equal(bad.required, false);
  assert.equal(bad.expect, 'reject');
  assert.deepEqual(bad.path, ['pay', 'ship']);
  assert.equal(r.items.filter((x) => x.required).length, 3);
  assert.ok(r.problems.some((p) => /"archived" cannot be reached/.test(p)));
});

test('pairwise: każda para wartości pokryta, mniej wierszy niż pełny iloczyn, pary wykluczone pomijane, wartości z enum', () => {
  const params = { ship: ['std', 'exp', 'pick'], country: ['PL', 'DE', 'CZ'], pay: ['card', 'blik', 'wire'], gift: [true, false] };
  const r = t.pairwise({ id: 'q', parameters: params, excluded: [{ ship: 'pick', country: 'CZ' }] });
  const n = Object.keys(params);
  for (let i = 0; i < n.length; i++) for (let j = i + 1; j < n.length; j++) for (const a of params[n[i]]) for (const b of params[n[j]]) {
    if (n[i] === 'ship' && a === 'pick' && n[j] === 'country' && b === 'CZ') { assert.ok(!r.items.some((x) => x.inputs.ship === 'pick' && x.inputs.country === 'CZ')); continue; }
    assert.ok(r.items.some((x) => x.inputs[n[i]] === a && x.inputs[n[j]] === b), `${n[i]}=${a} ${n[j]}=${b}`);
  }
  assert.ok(r.items.length < 54 && r.items.length <= 12, `rows ${r.items.length}`);
  const fromSpec = t.pairwise({ id: 'cur', endpoint: 'POST /orders', fields: ['currency', 'quantity'] }, [doc]);
  assert.ok(fromSpec.problems.some((p) => /"quantity" has no enum/.test(p)));
});

test('pokrycie: przywołane, świadomie pominięte, brakujące i nieznane identyfikatory', () => {
  const r = t.build({ docs: [doc], endpoints: ['POST /orders'] });
  const c = t.coverage(r, ['BVA:post-orders:quantity:min', 'BVA:post-orders:quantity:max', 'BVA:x:y:z'], new Set(['BVA:post-orders:quantity:min-1']));
  assert.equal(c.targets.length, 1);
  assert.deepEqual(c.targets[0].missing, ['BVA:post-orders:quantity:max+1']);
  assert.deepEqual(c.targets[0].excused, ['BVA:post-orders:quantity:min-1']);
  assert.deepEqual(c.byTechnique.BVA, { required: 4, covered: 2, excused: 1 });
  assert.deepEqual(c.unknown, ['BVA:x:y:z']);
  assert.deepEqual(t.ciRefs('(src: SHOP-1; ci: BVA:post-orders:quantity:max+1, DT:discount:3, ST:order:paid+ship)'), ['BVA:post-orders:quantity:max+1', 'DT:discount:3', 'ST:order:paid+ship']);
  assert.ok(t.render(r).includes('`BVA:post-orders:quantity:max+1` quantity=101 → rejected'));
});
