// Benchmark testów funkcjonalnych (bench/functional-bench.js) na celu ze znanymi błędami (bench/shop-app.js):
// wszystkie wszczepione błędy wykryte, zero fałszywych alarmów na poprawnej aplikacji, a kontrola negatywna
// (błąd, którego poprawnej wartości nie podaje żadne źródło) NIE wykryta — inaczej silnik zgadywałby wyrocznię.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runBench } = require('../bench/functional-bench');
const exec = require('../lib/technique-exec');
const tech = require('../lib/test-techniques');
const shop = require('../bench/shop-app');

test('benchmark: 100% wykrytych błędów, 0 fałszywych alarmów, kontrola negatywna niewykryta', async () => {
  const r = await runBench();
  assert.equal(r.falseAlarms.length, 0, JSON.stringify(r.falseAlarms));
  for (const b of r.bugs.filter((x) => !x.blindSpot)) assert.ok(b.detected, `${b.id} ${b.title} not detected`);
  assert.equal(r.ddp, 100);
  assert.deepEqual(r.blindSpots.map((b) => [b.id, b.detected]), [['B14', false]]);
  // Asercje na stanie (odczyt zwrotny, "nic nie zapisano", stan po przejściu) łapią to, czego sam kod statusu nie widzi.
  assert.deepEqual(r.statusOnly.missed.sort(), ['B11', 'B13', 'B7']);
  assert.ok(r.byTechnique.EP && r.byTechnique.BVA && r.byTechnique.DT && r.byTechnique.ST && r.byTechnique.PW);
});

test('wykonawca: 5xx to zawsze defekt, brak wiązania to "skip", element bez wyroczni nie jest wykonywany', async () => {
  const app = await shop.start({ bugs: new Set(['B12']) });
  try {
    const items = [
      ...tech.build({ docs: [shop.SPEC], models: [{ kind: 'pairwise', id: 'shipping', endpoint: 'POST /shipping/quote', fields: ['method', 'country', 'payment'] }] }).items,
      { id: 'DT:x:1', technique: 'DT', expect: 'unknown' },
    ];
    const noBind = await exec.runItems({ baseUrl: app.url, docs: [shop.SPEC], items });
    assert.ok(noBind.results.every((x) => x.verdict === 'skip'));
    const r = await exec.runItems({ baseUrl: app.url, docs: [shop.SPEC], items: items.filter((x) => x.id !== 'DT:x:1'), bind: { PW: async (it, { call }) => { const res = await call('POST', '/shipping/quote', it.inputs); return res.status === 200 ? { verdict: 'pass' } : { verdict: 'fail', why: String(res.status) }; } } });
    assert.ok(r.results.some((x) => x.verdict === 'fail' && x.why === '500'));
  } finally { await app.close(); }
});
