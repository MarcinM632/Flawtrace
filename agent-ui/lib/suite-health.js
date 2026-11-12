// Zdrowie zestawu autotestów (TAE, rozdz. 6 i 8): trend wyników, niestabilne testy, stale padające,
// podział na poziomy ISTQB. Liczone na świeżo z historii uruchomień (suite.runs), nic nie jest przechowywane osobno.
const LEVELS = ['SMOKE', 'INTEGRATION', 'SYSTEM'];
const bad = (o) => o === 'failed' || o === 'error';

/**
 * @param {{runs: Array, last: Object}} suite  historia uruchomień (najnowsze pierwsze) i ostatni wynik per test
 * @param {Array<{id:string, file:string, name:string, markers:string[]}>} tests  lista testów z repo (może być pusta)
 */
function buildHealth(suite, tests = []) {
  const runs = (suite.runs || []).filter((r) => r && r.results && Object.keys(r.results).length);
  const trend = runs.slice(0, 20).reverse().map((r) => {
    const vals = Object.values(r.results);
    const passed = vals.filter((o) => o === 'passed').length;
    const failed = vals.filter(bad).length;
    const counted = passed + failed;
    return {
      id: r.id, at: r.startedAt, passed, failed, total: vals.length,
      passRate: counted ? Math.round((passed / counted) * 100) : null,
      seconds: r.finishedAt && r.startedAt ? Math.round((r.finishedAt - r.startedAt) / 1000) : null,
    };
  });

  // Historia wyników per test, od najnowszego.
  const hist = new Map();
  for (const r of runs) for (const [id, o] of Object.entries(r.results)) {
    if (o !== 'passed' && !bad(o)) continue;
    if (!hist.has(id)) hist.set(id, []);
    hist.get(id).push({ o, runId: r.id, at: r.startedAt });
  }
  const flaky = [];
  const alwaysFailing = [];
  for (const [id, h] of hist) {
    if (h.length < 2) continue;
    const fails = h.filter((x) => bad(x.o)).length;
    if (fails === h.length) { alwaysFailing.push({ id, runs: h.length }); continue; }
    if (fails === 0) continue;
    let flips = 0;
    for (let i = 1; i < h.length; i++) if (bad(h[i].o) !== bad(h[i - 1].o)) flips++;
    flaky.push({ id, runs: h.length, fails, flips, latest: h[0].o });
  }
  flaky.sort((a, b) => b.flips - a.flips || b.fails - a.fails);

  const latest = runs[0] || null;
  const failingNow = Object.entries(suite.last || {}).filter(([, v]) => bad(v.outcome))
    .map(([id, v]) => ({ id, at: v.at, message: ((latest && latest.messages && latest.messages[id]) || '').split('\n')[0].slice(0, 240) }));

  const levels = LEVELS.map((lv) => {
    const ids = tests.filter((t) => t.markers.includes(lv)).map((t) => t.id);
    const outs = ids.map((id) => (suite.last[id] || {}).outcome).filter(Boolean);
    const passed = outs.filter((o) => o === 'passed').length;
    const failed = outs.filter(bad).length;
    return { level: lv, tests: ids.length, passed, failed, notRun: ids.length - passed - failed };
  });
  const known = tests.length;
  const everRun = tests.filter((t) => suite.last[t.id]).length;
  const lastPass = trend.length && trend[trend.length - 1].passRate != null ? trend[trend.length - 1].passRate : null;

  // Jedna liczba do szybkiego odczytu: wynik ostatniego przebiegu (60), stabilność (25), ile testów w ogóle uruchomiono (15).
  let score = null;
  if (lastPass != null) {
    const stability = hist.size ? 1 - flaky.length / hist.size : 1;
    const coverage = known ? everRun / known : 1;
    score = Math.round(lastPass * 0.6 + stability * 100 * 0.25 + coverage * 100 * 0.15);
  }
  return {
    runs: runs.length, score, lastPassRate: lastPass, tests: known, everRun, trend, levels,
    flaky: flaky.slice(0, 15), alwaysFailing: alwaysFailing.slice(0, 15), failingNow: failingNow.slice(0, 25),
    slowestRuns: trend.filter((t) => t.seconds != null).sort((a, b) => b.seconds - a.seconds).slice(0, 3),
  };
}

module.exports = { buildHealth };
