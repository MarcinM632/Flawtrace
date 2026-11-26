#!/usr/bin/env node
// Benchmark AGENTA Test design: ocenia raport projektu testów względem wzorca (bench/design-cases.js), bez modelu.
// Mierzy to, czego benchmark silnika (functional-bench.js) nie mierzy — pracę agenta:
//   recall     — ile reguł wymagania projekt przetestował,
//   wrong      — ile checków testuje właściwą sytuację z błędnym oczekiwanym wynikiem,
//   invented   — ile checków twierdzi wynik, którego wymaganie nie podaje,
//   gaps       — ile celowych luk agent zgłosił w "To confirm" zamiast je domyślić,
//   + audyt wyroczni aplikacji (lib/design-oracle.js) na tym samym raporcie: źródła, sprzeczności, pokrycie technik.
//
// Użycie:
//   node bench/design-bench.js --reports <katalog>     ocena gotowych raportów <katalog>/<id przypadku>.md
//   node bench/design-bench.js --live http://localhost:3000 [--token T] [--out bench/out]
//        prawdziwy przebieg: POST /api/runs dla każdego przypadku (agent "design"), czekanie na koniec, zapis i ocena.
//        Serwer musi mieć zaimportowaną specyfikację sklepu (node bench/design-bench.js --spec > shop.json, potem
//        Sources → OpenAPI) i działający model. Wynik zależy od modelu i promptów — o to właśnie chodzi.
//   --json  wynik jako JSON
const fs = require('fs');
const path = require('path');
const { CASES } = require('./design-cases');
const oracle = require('../lib/design-oracle');
const shop = require('./shop-app');

const all = (res, text) => res.every((re) => re.test(text));

/** Ocena jednego raportu względem przypadku. */
function score(c, report, { workDir = '', models = c.models || [], audit = null } = {}) {
  const d = oracle.parse(report);
  const checks = d.sections.flatMap((s) => s.checks.map((k) => ({ ...k, section: s.n })));
  const confirm = d.confirm + '\n' + d.sections.map((s) => s.notCovered).join('\n');
  const rules = c.rules.map((r) => {
    const cand = checks.filter((k) => all(r.action, k.action));
    const ok = cand.filter((k) => all(r.expected, k.expected));
    const wrong = r.wrongIf ? cand.filter((k) => r.wrongIf.match.test(k.expected) && !(r.wrongIf.unless && r.wrongIf.unless.test(k.expected))) : [];
    return { id: r.id, what: r.what, covered: ok.length > 0, by: ok.map((k) => k.ref), wrong: wrong.map((k) => `${k.ref}: ${k.expected.slice(0, 100)}`) };
  });
  const asks = c.mustAsk.map((q) => ({ id: q.id, what: q.what, asked: all(q.match, confirm) }));
  const invented = c.mustNotClaim.map((n) => {
    const hit = checks.filter((k) => all(n.action, k.action) && all(n.expected, k.expected));
    return { id: n.id, what: n.what, checks: hit.map((k) => `${k.ref}: ${k.expected.slice(0, 100)}`) };
  });
  // Audyt wyroczni: w przebiegu na żywo ten, który aplikacja już policzyła (zna modele z WORK_DIR agenta); przy ocenie
  // gotowego raportu liczony tu, z modelami z <raport>.models.json albo z modelami sklepu.
  const od = audit || oracle.audit(report, oracle.context({ ticket: `${c.ticket}\n${c.notes}`, notes: '', workDir, docs: [shop.SPEC], models }));
  const n = (x) => x.length;
  const covered = rules.filter((r) => r.covered).length;
  const wrongN = rules.reduce((a, r) => a + r.wrong.length, 0);
  const inventedN = invented.reduce((a, x) => a + x.checks.length, 0);
  const asked = asks.filter((a) => a.asked).length;
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 100);
  // Wynik łączny: recall reguł i zgłoszone luki na plus; każdy błędny lub wymyślony wynik odejmuje (nie da się go
  // "nadrobić" dodatkowymi checkami — fałszywy wynik testu jest gorszy niż brak testu).
  const penalty = Math.min(1, (wrongN + inventedN) / Math.max(1, n(c.rules)));
  const total = Math.max(0, Math.round(((covered / n(c.rules)) * 0.6 + (n(asks) ? asked / n(asks) : 1) * 0.4 - penalty * 0.5) * 1000) / 10);
  return {
    id: c.id, checks: checks.length,
    recall: pct(covered, n(c.rules)), rules, wrong: wrongN, invented: inventedN, inventedDetail: invented,
    gaps: pct(asked, n(asks)), asks,
    oracle: { issues: od.issues.map((i) => i.code), traced: od.traceability.summary, techniques: od.techniques.byTechnique },
    score: total,
  };
}

function summarize(results) {
  const avg = (k) => Math.round((results.reduce((a, r) => a + r[k], 0) / Math.max(1, results.length)) * 10) / 10;
  return { cases: results.length, score: avg('score'), recall: avg('recall'), gaps: avg('gaps'), wrong: results.reduce((a, r) => a + r.wrong, 0), invented: results.reduce((a, r) => a + r.invented, 0) };
}

async function live(base, { token = '', out = path.join(__dirname, 'out'), timeoutMs = 30 * 60000, log = () => {} } = {}) {
  fs.mkdirSync(out, { recursive: true });
  const h = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const results = [];
  for (const c of CASES) {
    const r = await fetch(`${base}/api/runs`, { method: 'POST', headers: h, body: JSON.stringify({ agent: 'design', ticket: c.ticket, notes: c.notes }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${c.id}: ${r.status} ${j.error || ''}`);
    const id = j.id || (j.meta && j.meta.id);
    log(`${c.id}: run ${id} started`);
    const t0 = Date.now();
    let meta = null;
    while (Date.now() - t0 < timeoutMs) {
      await new Promise((res) => setTimeout(res, 5000));
      const g = await fetch(`${base}/api/runs/${id}`, { headers: h }).then((x) => x.json()).catch(() => null);
      meta = g && (g.meta || g);
      if (meta && meta.status && meta.status !== 'running' && meta.status !== 'queued') break;
    }
    if (!meta || !meta.report) throw new Error(`${c.id}: the run did not finish with a report (status ${meta && meta.status})`);
    fs.writeFileSync(path.join(out, `${c.id}.md`), meta.report);
    const audit = meta.traceability && meta.techniques ? { issues: (meta.audit && meta.audit.issues || []).filter((i) => /^(oracle-|technique-|model-|requirement-gap)/.test(i.code)), traceability: meta.traceability, techniques: meta.techniques } : null;
    results.push({ ...score(c, meta.report, { audit }), costUsd: meta.costUsd, runId: id });
    log(`${c.id}: score ${results[results.length - 1].score}`);
  }
  return results;
}

function fromReports(dir) {
  return CASES.filter((c) => fs.existsSync(path.join(dir, `${c.id}.md`))).map((c) => {
    const mf = path.join(dir, `${c.id}.models.json`);
    const models = fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, 'utf8')) : c.models || [];
    return score(c, fs.readFileSync(path.join(dir, `${c.id}.md`), 'utf8'), { models });
  });
}

function print(results) {
  for (const r of results) {
    console.log(`\n${r.id}: score ${r.score} | rules ${r.recall}% | gaps asked ${r.gaps}% | wrong ${r.wrong} | invented ${r.invented} | checks ${r.checks}`);
    for (const x of r.rules) if (!x.covered || x.wrong.length) console.log(`  ${x.covered ? 'WRONG ' : 'MISSED'} ${x.id} ${x.what}${x.wrong.length ? ' — ' + x.wrong.join(' | ') : ''}`);
    for (const a of r.asks) if (!a.asked) console.log(`  NOT ASKED ${a.id} ${a.what}`);
    for (const i of r.inventedDetail) if (i.checks.length) console.log(`  INVENTED ${i.id} ${i.what} — ${i.checks.join(' | ')}`);
    if (r.oracle.issues.length) console.log(`  app audit: ${r.oracle.issues.join(', ')}`);
  }
  const s = summarize(results);
  console.log(`\nTOTAL ${s.cases} case(s): score ${s.score} | rules ${s.recall}% | gaps ${s.gaps}% | wrong ${s.wrong} | invented ${s.invented}`);
}

if (require.main === module) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const json = process.argv.includes('--json');
  (async () => {
    if (process.argv.includes('--spec')) { process.stdout.write(JSON.stringify(shop.SPEC, null, 2)); return; }
    const results = arg('--live') ? await live(arg('--live').replace(/\/+$/, ''), { token: arg('--token') || '', out: arg('--out') || undefined, log: json ? () => {} : console.log })
      : arg('--reports') ? fromReports(arg('--reports'))
      : (console.error('Use --reports <dir> or --live <url>. See the header of this file.'), process.exit(2));
    if (!results.length) { console.error('No reports to score.'); process.exit(2); }
    json ? console.log(JSON.stringify({ summary: summarize(results), results }, null, 2)) : print(results);
  })().catch((e) => { console.error(e.message || e); process.exit(1); });
}

module.exports = { score, summarize, live, fromReports, CASES };
