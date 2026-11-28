// Benchmark agenta Test design (bench/design-bench.js): ocena raportu względem wzorca bez modelu.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const bench = require('../bench/design-bench');

const REF = path.join(__dirname, '..', 'bench', 'design-reference');
const ref = (id) => fs.readFileSync(path.join(REF, `${id}.md`), 'utf8');
const kase = (id) => bench.CASES.find((c) => c.id === id);

test('wzorcowe raporty: 100 punktów, każda reguła pokryta, każda luka zgłoszona, audyt aplikacji bez zarzutów', () => {
  const r = bench.fromReports(REF);
  assert.equal(r.length, bench.CASES.length);
  for (const x of r) {
    assert.equal(x.score, 100, `${x.id}: ${JSON.stringify(x.rules.filter((y) => !y.covered || y.wrong.length))}`);
    assert.deepEqual(x.oracle.issues, [], `${x.id}: ${x.oracle.issues}`);
  }
  assert.equal(bench.summarize(r).score, 100);
});

test('typowe błędy agenta obniżają wynik: domyślona luka, zły rabat na progu, brak pytania', () => {
  const bad = ref('discount-rules')
    .replace('premium=true, total=100 => discount 10%', 'premium=true, total=100 => discount 5%')
    .replace('Not covered: DT:discount:4 — no rule in SHOP-11, see To confirm', '- POST /discounts/quote regular customer (premium=false), total=99 => no discount, 0% (src: SHOP-11; ci: DT:discount:4)\nNot covered: nothing')
    .replace(/## To confirm[\s\S]*$/, '## To confirm\n- nothing\n');
  const r = bench.score(kase('discount-rules'), bad);
  assert.equal(r.wrong, 1);
  assert.equal(r.invented, 1);
  assert.equal(r.gaps, 0);
  assert.equal(r.recall, 66.7);
  assert.ok(r.score < 30, String(r.score));
  // Audyt aplikacji widzi to samo z drugiej strony: wynik sprzeczny z regułą i wymyślony wynik kolumny bez reguły.
  assert.ok(r.oracle.issues.includes('oracle-contradiction'));
});

test('pominięta reguła obniża recall, a sukces dla wartości poza zakresem liczy się jako błędny wynik', () => {
  const life = bench.score(kase('order-lifecycle'), ref('order-lifecycle').replace(/- for a shipped order POST \/orders\/\{id\}\/cancel.*\r?\n/, ''));
  assert.equal(life.recall, 80);
  assert.deepEqual(life.rules.filter((x) => !x.covered).map((x) => x.id), ['R5']);
  const val = bench.score(kase('order-validation'), ref('order-validation').replace('quantity=101 => 400 rejected, the order list count is unchanged (nothing stored)', 'quantity=101 => 201 created'));
  assert.equal(val.wrong, 1);
  assert.match(val.rules.find((x) => x.id === 'R2').wrong[0], /§1\.2: 201 created/);
});

test('tryb live: uruchamia przebieg design przez API, czeka na koniec, zapisuje i ocenia raport', async () => {
  const runs = new Map();
  let n = 0;
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const send = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.method === 'POST' && req.url === '/api/runs') {
        const j = JSON.parse(b);
        assert.equal(j.agent, 'design');
        const c = bench.CASES.find((x) => x.ticket === j.ticket);
        const id = 'r' + (++n);
        runs.set(id, { id, polls: 0, report: ref(c.id) });
        return send(200, { id });
      }
      const m = req.url.match(/^\/api\/runs\/(\w+)$/);
      if (m) { const r = runs.get(m[1]); r.polls++; return send(200, r.polls < 2 ? { id: r.id, status: 'running' } : { id: r.id, status: 'done', report: r.report, costUsd: 0.12 }); }
      send(404, {});
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'design-live-'));
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, Math.min(ms, 5), ...a); // bez 5-sekundowych odstępów w teście
  try {
    const r = await bench.live(`http://127.0.0.1:${server.address().port}`, { out });
    assert.equal(r.length, bench.CASES.length);
    assert.ok(r.every((x) => x.score === 100 && x.costUsd === 0.12));
    assert.ok(fs.existsSync(path.join(out, 'discount-rules.md')));
  } finally { global.setTimeout = realSetTimeout; server.close(); }
});
