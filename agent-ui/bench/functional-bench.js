#!/usr/bin/env node
// Benchmark testów funkcjonalnych: czy elementy pokrycia policzone przez silnik technik (lib/test-techniques.js)
// i wykonane przez lib/technique-exec.js wykrywają ZNANE błędy (bench/shop-app.js), i czy nie dają fałszywych alarmów.
//
// Metoda (jak w testach mutacyjnych):
// 1. Przebieg na poprawnej aplikacji (bugs: false): każda porażka to fałszywy alarm silnika.
// 2. Dla każdego wszczepionego błędu osobny przebieg z tylko tym jednym błędem: wykryty, gdy padnie któryś z jego
//    elementów pokrycia (GROUND_TRUTH.detectedBy). Osobno, bo jeden defekt potrafi zamaskować drugi (np. zły stan
//    po "ship" blokuje dojście do "shipped").
// 3. To samo w trybie "tylko kod statusu" (bez odczytu zwrotnego i bez sprawdzenia, że nic się nie zapisało),
//    żeby zmierzyć, ile błędów łapie dopiero asercja na stanie.
// Wynik: odsetek wykrytych defektów (DDP), fałszywe alarmy, pokrycie per technika. `node bench/functional-bench.js`.
const tech = require('../lib/test-techniques');
const exec = require('../lib/technique-exec');
const shop = require('./shop-app');

/** Wiązania DT/ST/PW dla sklepu: jak ustawić warunki elementu i odczytać jego wynik. W prawdziwym projekcie to
 * robi agent w kroku testu; w benchmarku jest stałe, żeby mierzyć silnik, a nie model. */
const bind = {
  DT: async (it, { call }) => {
    const r = await call('POST', '/discounts/quote', { premium: it.inputs.premium, total: it.inputs.total });
    if (r.status !== 200) return { verdict: 'fail', why: `quote answered ${r.status}`, status: r.status };
    const want = it.expect.action.discount;
    return r.json && r.json.discount === want ? { verdict: 'pass' } : { verdict: 'fail', why: `discount ${r.json && r.json.discount} instead of ${want} for ${JSON.stringify(it.inputs)}`, observed: r.json && r.json.discount };
  },
  ST: async (it, { call, readBack }) => {
    const c = await call('POST', '/orders', exec.validBody(tech.endpointFields(tech.findOperation([shop.SPEC], 'POST /orders'))));
    if (c.status !== 201) return { verdict: 'blocked', why: `could not create an order (${c.status})` };
    const id = c.json.id;
    for (const ev of it.path || []) await call('POST', `/orders/${id}/${ev}`);
    const now = await call('GET', `/orders/${id}`);
    if (!now.json || now.json.state !== it.from) return { verdict: 'blocked', why: `setup reached "${now.json && now.json.state}" instead of "${it.from}"` };
    const r = await call('POST', `/orders/${id}/${it.event}`);
    const after = readBack ? (await call('GET', `/orders/${id}`)).json : r.json;
    if (r.status >= 500) return { verdict: 'fail', why: `server error ${r.status}` };
    if (it.valid) {
      if (r.status < 200 || r.status >= 300) return { verdict: 'fail', why: `"${it.event}" in "${it.from}" was refused (${r.status})` };
      if (readBack && (!after || after.state !== it.expect.state)) return { verdict: 'fail', why: `state is "${after && after.state}" instead of "${it.expect.state}"` };
      return { verdict: 'pass' };
    }
    if (r.status >= 200 && r.status < 300) return { verdict: 'fail', why: `"${it.event}" in "${it.from}" was allowed (moved to "${after && after.state}")` };
    if (readBack && after && after.state !== it.from) return { verdict: 'fail', why: `refused, but the state changed to "${after.state}"` };
    return { verdict: 'pass' };
  },
  PW: async (it, { call }) => {
    const r = await call('POST', '/shipping/quote', it.inputs);
    if (r.status !== 200 || !r.json || typeof r.json.price !== 'number') return { verdict: 'fail', why: `${JSON.stringify(it.inputs)} answered ${r.status}` };
    return { verdict: 'pass' };
  },
};

const failed = (run) => new Set(run.results.filter((x) => x.verdict === 'fail').map((x) => x.id));
const hits = (gt, set) => [...set].filter((id) => gt.detectedBy.some((p) => (p.endsWith('*') ? id.startsWith(p.slice(0, -1)) : id === p)));

async function once({ bugs, readBack, items }) {
  const app = await shop.start({ bugs });
  try { return await exec.runItems({ baseUrl: app.url, docs: [shop.SPEC], items, bind, readBack }); } finally { await app.close(); }
}

async function runBench({ bva = 2, log = () => {} } = {}) {
  const res = tech.build({ docs: [shop.SPEC], endpoints: 'all', models: shop.MODELS, bva });
  const items = res.items; // wymagane i opcjonalne (niepoprawne przejścia też wykonujemy)
  const clean = await once({ bugs: false, readBack: true, items });
  const falseAlarms = clean.results.filter((x) => x.verdict !== 'pass');
  log(`clean app: ${clean.summary.pass}/${clean.summary.total} pass, ${falseAlarms.length} false alarm(s)`);
  const perBug = [];
  for (const gt of shop.GROUND_TRUTH) {
    const full = await once({ bugs: new Set([gt.id]), readBack: true, items });
    const status = await once({ bugs: new Set([gt.id]), readBack: false, items });
    const f = failed(full), s = failed(status);
    const by = hits(gt, f);
    perBug.push({ ...gt, detected: by.length > 0, by, statusOnly: hits(gt, s).length > 0, collateral: [...f].filter((id) => !by.includes(id)), why: full.results.filter((x) => by.includes(x.id)).map((x) => x.why) });
    log(`${gt.id} ${by.length ? 'DETECTED' : gt.blindSpot ? 'missed (expected: blind spot)' : 'missed  '} ${gt.title}${by.length ? ` — ${by[0]}: ${full.results.find((x) => x.id === by[0]).why}` : ''}`);
  }
  const real = perBug.filter((b) => !b.blindSpot), blind = perBug.filter((b) => b.blindSpot);
  const n = real.length, det = real.filter((b) => b.detected).length, det2 = real.filter((b) => b.statusOnly).length;
  const byTechnique = {};
  for (const it of items) { const b = byTechnique[it.technique] || (byTechnique[it.technique] = { items: 0, required: 0 }); b.items++; if (it.required) b.required++; }
  return {
    items: items.length, byTechnique, problems: res.problems,
    clean: clean.summary, falseAlarms,
    bugs: perBug, detected: det, total: n, ddp: Math.round((det / n) * 1000) / 10,
    statusOnly: { detected: det2, ddp: Math.round((det2 / n) * 1000) / 10, missed: real.filter((b) => b.detected && !b.statusOnly).map((b) => b.id) },
    blindSpots: blind.map((b) => ({ id: b.id, title: b.title, detected: b.detected })),
  };
}

if (require.main === module) {
  runBench({ log: (s) => console.log(s) }).then((r) => {
    console.log('');
    console.log(`coverage items: ${r.items} (${Object.entries(r.byTechnique).map(([k, v]) => `${k} ${v.items}`).join(', ')})`);
    console.log(`defect detection percentage: ${r.detected}/${r.total} = ${r.ddp}%   false alarms on the correct app: ${r.falseAlarms.length}`);
    console.log(`status-code-only assertions: ${r.statusOnly.detected}/${r.total} = ${r.statusOnly.ddp}% (state assertions add: ${r.statusOnly.missed.join(', ') || 'nothing'})`);
    console.log(`negative control (no source states the right value): ${r.blindSpots.map((b) => `${b.id} ${b.detected ? 'DETECTED — the engine is guessing!' : 'not detected, as it must be'}`).join('; ')}`);
    if (r.problems.length) console.log('model problems: ' + r.problems.join(' | '));
    process.exit(r.detected === r.total && !r.falseAlarms.length && !r.blindSpots.some((b) => b.detected) ? 0 : 1);
  }).catch((e) => { console.error(e); process.exit(2); });
}

module.exports = { runBench, bind };
