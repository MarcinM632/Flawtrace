// Metrics generation: pick a statistic, a period, apps/services and (for release stats) a Jira
// release, and get a chart built from the bug registry / run history / cached Jira releases that
// already exist in this app (bugs.json, run records, lib/test-monitor.js) — no new data source,
// just new ways to slice what is already collected. A generated chart is a frozen snapshot, not a
// live query: "Generate" computes once and saves the result, so a saved chart keeps reading the
// same the day after, even if the underlying registry changes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./config');
const bugsLib = require('./bugs');
const store = require('./store');
const testMonitor = require('./test-monitor');
const suiteLib = require('./suite');
const defectLifecycle = require('./defect-lifecycle');
const econometrics = require('./econometrics');
const { claudeOnce } = require('./claude-once');

const METRICS_FILE = path.join(DATA_DIR, 'metrics.json');
let saved = [];
try { saved = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf8')); } catch (_) { saved = []; }
const save = () => { try { fs.writeFileSync(METRICS_FILE, JSON.stringify(saved)); } catch (_) { /* nieistotne */ } };

const SEVW = { krytyczny: 5, wazny: 3, drobny: 1 };
const SEVL = { krytyczny: 'Critical', wazny: 'Major', drobny: 'Minor' };
const PRODUCT_APPS = testMonitor.PROJECTS; // { core:{jiraKey,label}, svc:{...}, mcp:{...} }
const appKeys = () => Object.keys(PRODUCT_APPS);
const labelFor = (key) => (PRODUCT_APPS[key] ? PRODUCT_APPS[key].label : key);
const PALETTE = ['var(--acc)', 'var(--ok)', 'var(--bad)', 'var(--info)', 'var(--warn)', 'var(--app-2)', 'var(--app-1)', 'var(--app-3)'];
const fmtSecs = (s) => s >= 3600 ? Math.floor(s / 3600) + 'h ' + String(Math.floor(s % 3600 / 60)).padStart(2, '0') + 'm'
  : Math.floor(s / 60) + 'm ' + String(Math.round(s % 60)).padStart(2, '0') + 's';

const STATS = [
  { key: 'bugs_by_severity', label: 'Bugs by severity', chartType: 'donut', needsRelease: false, desc: 'How findings split across critical / major / minor.' },
  { key: 'bugs_by_app', label: 'Bugs by app', chartType: 'donut', needsRelease: false, desc: 'Raw finding count, split across CORE / SVC / mcp-server.' },
  { key: 'bugs_by_service', label: 'Bugs by service', chartType: 'bars', needsRelease: false, desc: 'Raw finding count, ranked by service.' },
  { key: 'avg_bugs_per_task', label: 'Average bugs per task, by service', chartType: 'bars', needsRelease: false, desc: 'Findings ÷ distinct tickets touched, per service.' },
  { key: 'risk_score', label: 'Risk score by service', chartType: 'bars', needsRelease: false, desc: 'Severity-weighted damage per ticket touched (likelihood × impact, ISTQB CTFL §5.2).' },
  { key: 'bugs_trend', label: 'Bugs over time', chartType: 'trend', needsRelease: false, desc: 'Finding count per period bucket, across the selected range.' },
  { key: 'testing_time', label: 'Testing time by app', chartType: 'bars', needsRelease: false, desc: 'Median finished-run duration, with the middle-50% range, per app.' },
  { key: 'release_status', label: 'Release: issues by status', chartType: 'donut', needsRelease: true, desc: 'Status breakdown for one Jira release.' },
  { key: 'release_type', label: 'Release: issues by type', chartType: 'donut', needsRelease: true, desc: 'Issue-type breakdown for one Jira release.' },
  { key: 'defect_density_pareto', label: 'Defect density Pareto (by service)', chartType: 'pareto', needsRelease: false, desc: 'Findings per service, ranked, with the cumulative share — the 80/20 view of where defects concentrate.' },
  { key: 'defects_opened_vs_closed', label: 'Defects opened vs closed (cumulative)', chartType: 'multiline', needsRelease: false, desc: 'Cumulative flow of Bug issues created vs resolved in Jira — the gap between the lines is the open backlog.' },
  { key: 'defect_resolution_time', label: 'Defect resolution time (MTTR / age)', chartType: 'boxplot', needsRelease: false, desc: 'Days from report to resolution for closed bugs, and age of still-open ones, per app. From Jira created/resolutiondate.' },
  { key: 'test_results', label: 'Test suite results (pass/fail/skip)', chartType: 'donut', needsRelease: false, desc: 'Outcome breakdown across Test suite runs (pytest): passed / failed / error / skipped / xfail / xpass.' },
  { key: 'test_pass_rate_trend', label: 'Test suite pass rate over time', chartType: 'trend', needsRelease: false, desc: 'Share of passed tests, one point per Test suite run, in run order.' },
  { key: 'build_success_rate_trend', label: 'Suite stability: cumulative build success rate', chartType: 'trend', needsRelease: false, desc: 'Share of all Test suite runs so far with zero failures or errors — whether the suite can be trusted as a gate.' },
  { key: 'flaky_tests', label: 'Flaky tests', chartType: 'bars', needsRelease: false, desc: 'Tests whose outcome (pass vs not-pass) flipped between Test suite runs — the ones you cannot trust on a single result.' },
  { key: 'test_planned_vs_executed', label: 'Tests planned vs executed', chartType: 'multiline', needsRelease: false, desc: 'Per Test suite run: tests selected (planned) vs tests the run actually completed (executed).' },
];

function inPeriod(ts, period) {
  if (!period || (!period.from && !period.to)) return true;
  if (!ts) return false;
  if (period.from && ts < period.from) return false;
  if (period.to && ts > period.to) return false;
  return true;
}
function filterBugs(filters) {
  const apps = filters.apps && filters.apps.length ? filters.apps : appKeys();
  const services = filters.services && filters.services.length ? new Set(filters.services) : null;
  return bugsLib.bugs.filter((b) => apps.includes(b.agent) && inPeriod(b.createdAt, filters.period) && (!services || services.has(b.service)));
}
function filterRuns(filters) {
  const apps = filters.apps && filters.apps.length ? filters.apps : appKeys();
  return [...store.runs.values()].map((r) => r.meta)
    .filter((m) => apps.includes(m.agent) && m.status === 'done' && m.finishedAt && inPeriod(m.startedAt, filters.period));
}
function quantile(sorted, p) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))] : 0; }

function computeBugsBySeverity(filters) {
  const rows = filterBugs(filters);
  const counts = { krytyczny: 0, wazny: 0, drobny: 0 };
  rows.forEach((b) => { counts[b.severity] = (counts[b.severity] || 0) + 1; });
  const COLOR = { krytyczny: 'var(--bad)', wazny: 'var(--warn)', drobny: 'var(--ok)' };
  const parts = Object.entries(counts).filter(([, v]) => v > 0).map(([k, v]) => ({ label: SEVL[k] || k, value: v, color: COLOR[k] }));
  return { chartType: 'donut', parts, centerSub: 'findings', total: rows.length };
}
function computeBugsByApp(filters) {
  const rows = filterBugs(filters);
  const COLOR = { core: 'var(--app-1)', svc: 'var(--app-2)', mcp: 'var(--app-3)' };
  const counts = {};
  rows.forEach((b) => { counts[b.agent] = (counts[b.agent] || 0) + 1; });
  const parts = Object.entries(counts).map(([k, v]) => ({ label: labelFor(k), value: v, color: COLOR[k] || 'var(--muted)' }));
  return { chartType: 'donut', parts, centerSub: 'findings', total: rows.length };
}
function computeBugsByService(filters) {
  const rows = filterBugs(filters);
  const svc = {};
  rows.forEach((b) => { const k = b.agent + '|' + b.service; (svc[k] = svc[k] || { name: b.service, app: labelFor(b.agent), n: 0 }).n++; });
  const list = Object.values(svc).sort((a, b) => b.n - a.n).slice(0, 15);
  return { chartType: 'bars', rows: list.map((s) => ({ label: s.name, value: s.n, vlabel: String(s.n), sub: s.app })), total: rows.length };
}
/** Per-service rollup, uncapped — shared by the Risk-tab-style chart computations below AND by
 * the Planning agent's risk-metrics.md (lib/run-agent.js): that digest must cover every service
 * a task might touch, not just the top 15 that make it into a chart. */
function serviceAggregates(filters) {
  const rows = filterBugs(filters);
  const svc = {};
  rows.forEach((b) => {
    const k = b.agent + '|' + b.service;
    if (!svc[k]) svc[k] = { name: b.service, app: labelFor(b.agent), appKey: b.agent, n: 0, score: 0, k: 0, w: 0, d: 0, tickets: new Set() };
    svc[k].n++;
    svc[k].score += SEVW[b.severity] || 1;
    if (b.severity === 'krytyczny') svc[k].k++; else if (b.severity === 'wazny') svc[k].w++; else svc[k].d++;
    if (b.ticket) svc[k].tickets.add(b.ticket);
  });
  return Object.values(svc).map((s) => ({
    ...s, tick: s.tickets.size,
    avg: s.tickets.size ? s.n / s.tickets.size : 0,
    per: s.tickets.size ? s.score / s.tickets.size : 0,
  }));
}
function computeAvgBugsPerTask(filters) {
  const list = serviceAggregates(filters).filter((s) => s.tick > 0).sort((a, b) => b.avg - a.avg).slice(0, 15);
  return { chartType: 'bars', rows: list.map((s) => ({ label: s.name, value: Math.round(s.avg * 100) / 100, vlabel: s.avg.toFixed(2), sub: s.app + (s.tick <= 2 ? ' · low n' : '') })) };
}
function computeRiskScore(filters) {
  const list = serviceAggregates(filters).filter((s) => s.tick > 0).sort((a, b) => b.per - a.per).slice(0, 15);
  return { chartType: 'bars', rows: list.map((s) => ({ label: s.name, value: Math.round(s.per * 10) / 10, vlabel: s.per.toFixed(1), sub: s.app + (s.tick <= 2 ? ' · low n' : '') })) };
}
function computeBugsTrend(filters) {
  const rows = filterBugs(filters).filter((b) => b.createdAt);
  if (!rows.length) return { chartType: 'trend', points: [], total: 0 };
  const ts = rows.map((b) => b.createdAt);
  const from = (filters.period && filters.period.from) || Math.min(...ts);
  const to = (filters.period && filters.period.to) || Math.max(...ts);
  const span = Math.max(1, to - from);
  const DAY = 86400000;
  const bucketMs = span > 365 * DAY ? 30 * DAY : span > 60 * DAY ? 7 * DAY : DAY;
  const buckets = new Map();
  rows.forEach((b) => { const i = Math.floor((b.createdAt - from) / bucketMs); buckets.set(i, (buckets.get(i) || 0) + 1); });
  const n = Math.min(120, Math.max(1, Math.ceil(span / bucketMs) + 1)); // cap: a chart with hundreds of points is noise, not a trend
  const points = [];
  for (let i = 0; i < n; i++) points.push({ t: from + i * bucketMs, label: new Date(from + i * bucketMs).toISOString().slice(0, 10), value: buckets.get(i) || 0 });
  return { chartType: 'trend', points, total: rows.length, bucketDays: Math.round(bucketMs / DAY) };
}
function computeTestingTime(filters) {
  const rows = filterRuns(filters);
  const byApp = {};
  rows.forEach((r) => { (byApp[r.agent] = byApp[r.agent] || []).push(Math.max(0, Math.round((r.finishedAt - r.startedAt) / 1000))); });
  const list = Object.entries(byApp).map(([k, durs]) => {
    const v = [...durs].sort((a, b) => a - b);
    return { name: labelFor(k), n: v.length, p25: quantile(v, .25), med: quantile(v, .5), p75: quantile(v, .75) };
  }).filter((a) => a.n > 0).sort((a, b) => b.med - a.med);
  return { chartType: 'bars', rows: list.map((a) => ({ label: a.name, value: a.med, vlabel: fmtSecs(a.med), sub: a.n >= 3 ? `± ${fmtSecs(a.p25)}–${fmtSecs(a.p75)}` : 'low n' })) };
}
// Same semantic colors as Monitoring & control (public/js/15-tfmonitor.js) — "Done" is always
// green and "Blocked" is always red here too, not whatever color a rank-based palette hands it.
const statusFamily = (s) => /block|wstrzym|hold|impediment/i.test(s || '') ? 'blocked'
  : /^done$|gotow|zrobion|zakończon|closed|resolved|release/i.test(s || '') ? 'done'
  : /progress|toku|review|test/i.test(s || '') ? 'active' : 'todo';
const FAMILY_COLOR = { done: 'var(--ok)', blocked: 'var(--bad)', active: 'var(--acc)', todo: 'var(--info)' };
const TYPE_COLOR = { story: 'var(--acc)', 'user story': 'var(--acc)', task: 'var(--app-1)', zadanie: 'var(--app-1)',
  epic: 'var(--info)', bug: 'var(--bad)', 'błąd': 'var(--bad)', 'sub-task': 'var(--app-2)', subtask: 'var(--app-2)', podzadanie: 'var(--app-2)' };
function computeRelease(filters, byType) {
  if (!filters.release || !filters.release.app || !filters.release.name) throw new Error('Pick an app and a release first');
  const snap = testMonitor.snapshot(filters.release.app);
  const rel = snap && (snap.releases || []).find((r) => r.name === filters.release.name);
  if (!rel) throw new Error('Release not found — open Monitoring & control for this app once to fetch it, then try again');
  const raw = byType ? rel.metrics.byType.map((x) => ({ label: x.type, value: x.count })) : rel.metrics.byStatus.map((x) => ({ label: x.status, value: x.count }));
  const sorted = raw.sort((a, b) => b.value - a.value);
  const parts = sorted.map((p, i) => ({ ...p, color: byType ? (TYPE_COLOR[String(p.label).toLowerCase()] || PALETTE[i % PALETTE.length]) : FAMILY_COLOR[statusFamily(p.label)] }));
  return { chartType: 'donut', parts, centerSub: 'issues', total: rel.metrics.total };
}

// ---------------------------------------------------------------------------------------------
// Defect density Pareto, defect lifecycle (Jira) and Test suite (pytest) stats added below.
// ---------------------------------------------------------------------------------------------
function computeDefectDensityPareto(filters) {
  const list = serviceAggregates(filters).sort((a, b) => b.n - a.n);
  const totalAll = list.reduce((s, x) => s + x.n, 0) || 1;
  let cum = 0;
  const rows = list.slice(0, 15).map((s) => {
    cum += s.n;
    return { label: s.name, value: s.n, vlabel: String(s.n), sub: s.app, cumPct: Math.round((cum / totalAll) * 1000) / 10 };
  });
  return { chartType: 'pareto', rows, total: totalAll };
}
function computeDefectsOpenedVsClosed(filters) {
  defectLifecycle.refresh(false).catch(() => {});
  const { opened, closed } = defectLifecycle.cumulativeFlow(filters);
  return {
    chartType: 'multiline',
    series: [
      { label: 'Opened (cumulative)', color: 'var(--bad)', points: opened },
      { label: 'Closed (cumulative)', color: 'var(--ok)', points: closed },
    ],
    areaBetween: opened.length ? [0, 1] : null,
    total: opened.length ? opened[opened.length - 1].value : 0,
    jira: { fetchedAt: defectLifecycle.state.fetchedAt, ok: defectLifecycle.state.ok, error: defectLifecycle.state.error, busy: defectLifecycle.state.busy },
  };
}
function computeDefectResolutionTime(filters) {
  defectLifecycle.refresh(false).catch(() => {});
  const perApp = defectLifecycle.resolutionStats(filters);
  const rows = perApp.filter((a) => a.resolved.length).map((a) => {
    const v = a.resolved;
    return {
      label: a.label,
      min: Math.round(v[0] * 10) / 10, p25: Math.round(quantile(v, .25) * 10) / 10,
      median: Math.round(quantile(v, .5) * 10) / 10, p75: Math.round(quantile(v, .75) * 10) / 10,
      max: Math.round(v[v.length - 1] * 10) / 10, n: v.length,
      sub: `MTTR ${a.mttrDays.toFixed(1)}d · ${a.openCount} still open` + (a.medianAgeDays != null ? ` (median age ${a.medianAgeDays.toFixed(1)}d)` : ''),
    };
  });
  return { chartType: 'boxplot', unit: 'days', rows, jira: { fetchedAt: defectLifecycle.state.fetchedAt, ok: defectLifecycle.state.ok, error: defectLifecycle.state.error, busy: defectLifecycle.state.busy } };
}
function filterSuiteRuns(filters) {
  return suiteLib.suite.runs.filter((r) => inPeriod(r.startedAt, filters.period));
}
const TEST_OUTCOME_COLOR = { passed: 'var(--ok)', failed: 'var(--bad)', error: 'var(--bad)', skipped: 'var(--muted)', xfail: 'var(--info)', xpass: 'var(--warn)' };
const TEST_OUTCOME_LABEL = { passed: 'Passed', failed: 'Failed', error: 'Error', skipped: 'Skipped', xfail: 'Expected failure', xpass: 'Unexpected pass' };
function computeTestResults(filters) {
  const runs = filterSuiteRuns(filters);
  const counts = {};
  let total = 0;
  runs.forEach((r) => Object.values(r.results).forEach((o) => { counts[o] = (counts[o] || 0) + 1; total++; }));
  const parts = Object.entries(counts).map(([k, v]) => ({ label: TEST_OUTCOME_LABEL[k] || k, value: v, color: TEST_OUTCOME_COLOR[k] || 'var(--muted)' }));
  return { chartType: 'donut', parts, centerSub: 'results', total, runs: runs.length };
}
function computeTestPassRateTrend(filters) {
  const runs = filterSuiteRuns(filters).slice().sort((a, b) => a.startedAt - b.startedAt);
  const points = runs.map((r, i) => {
    const vals = Object.values(r.results);
    const passed = vals.filter((o) => o === 'passed' || o === 'xfail').length;
    const rate = vals.length ? Math.round((passed / vals.length) * 1000) / 10 : 0;
    return { t: r.startedAt, label: new Date(r.startedAt).toISOString().slice(0, 10) + ` (run ${i + 1})`, value: rate };
  });
  return { chartType: 'trend', points, total: runs.length };
}
function computeBuildSuccessRateTrend(filters) {
  const runs = filterSuiteRuns(filters).slice().sort((a, b) => a.startedAt - b.startedAt);
  let successes = 0;
  const points = runs.map((r, i) => {
    if ((r.failed || 0) === 0 && (r.done || 0) > 0) successes++;
    const rate = Math.round((successes / (i + 1)) * 1000) / 10;
    return { t: r.startedAt, label: new Date(r.startedAt).toISOString().slice(0, 10) + ` (run ${i + 1})`, value: rate };
  });
  return { chartType: 'trend', points, total: runs.length };
}
/** A test is "flaky" here if its outcome category (pass-like vs not) is not the same across every
 * run it appeared in. A single flip is enough to flag it — a test you cannot trust on one result
 * is exactly the thing this metric exists to surface, not something to average away. */
function computeFlakyTests(filters) {
  const runs = filterSuiteRuns(filters).slice().sort((a, b) => a.startedAt - b.startedAt);
  const byTest = new Map();
  const passLike = (o) => o === 'passed' || o === 'xfail';
  runs.forEach((r) => Object.entries(r.results).forEach(([id, outcome]) => {
    if (!byTest.has(id)) byTest.set(id, []);
    byTest.get(id).push(outcome);
  }));
  const rows = [];
  for (const [id, outcomes] of byTest) {
    if (outcomes.length < 2) continue;
    let flips = 0;
    for (let i = 1; i < outcomes.length; i++) if (passLike(outcomes[i]) !== passLike(outcomes[i - 1])) flips++;
    if (flips > 0) rows.push({ label: id.replace(/^tests\//, ''), value: flips, vlabel: String(flips), sub: `${outcomes.length} runs · last: ${outcomes[outcomes.length - 1]}` });
  }
  rows.sort((a, b) => b.value - a.value);
  return { chartType: 'bars', rows: rows.slice(0, 20), total: rows.length };
}
function computeTestPlannedVsExecuted(filters) {
  const runs = filterSuiteRuns(filters).slice().sort((a, b) => a.startedAt - b.startedAt);
  const planned = [], executed = [];
  runs.forEach((r, i) => {
    const label = new Date(r.startedAt).toISOString().slice(0, 10) + ` (run ${i + 1})`;
    planned.push({ t: r.startedAt, label, value: r.total != null ? r.total : Object.keys(r.results).length });
    executed.push({ t: r.startedAt, label, value: Object.keys(r.results).length });
  });
  return { chartType: 'multiline', series: [{ label: 'Planned', color: 'var(--info)', points: planned }, { label: 'Executed', color: 'var(--acc)', points: executed }], total: runs.length };
}

function computeStat(key, filters) {
  switch (key) {
    case 'bugs_by_severity': return computeBugsBySeverity(filters);
    case 'bugs_by_app': return computeBugsByApp(filters);
    case 'bugs_by_service': return computeBugsByService(filters);
    case 'avg_bugs_per_task': return computeAvgBugsPerTask(filters);
    case 'risk_score': return computeRiskScore(filters);
    case 'bugs_trend': return computeBugsTrend(filters);
    case 'testing_time': return computeTestingTime(filters);
    case 'release_status': return computeRelease(filters, false);
    case 'release_type': return computeRelease(filters, true);
    case 'defect_density_pareto': return computeDefectDensityPareto(filters);
    case 'defects_opened_vs_closed': return computeDefectsOpenedVsClosed(filters);
    case 'defect_resolution_time': return computeDefectResolutionTime(filters);
    case 'test_results': return computeTestResults(filters);
    case 'test_pass_rate_trend': return computeTestPassRateTrend(filters);
    case 'build_success_rate_trend': return computeBuildSuccessRateTrend(filters);
    case 'flaky_tests': return computeFlakyTests(filters);
    case 'test_planned_vs_executed': return computeTestPlannedVsExecuted(filters);
    default: throw new Error('Unknown statistic: ' + key);
  }
}

/** One factual line, built from the actual filters and result — no generated prose. */
function captionFor(filters, result) {
  const parts = [];
  if (result.total != null) parts.push(result.total + (result.total === 1 ? ' item' : ' items'));
  if (filters.period && (filters.period.from || filters.period.to)) {
    const f = filters.period.from ? new Date(filters.period.from).toISOString().slice(0, 10) : 'start';
    const t = filters.period.to ? new Date(filters.period.to).toISOString().slice(0, 10) : 'now';
    parts.push(f + ' → ' + t);
  } else parts.push('all time');
  if (filters.apps && filters.apps.length && filters.apps.length < appKeys().length) parts.push(filters.apps.map(labelFor).join(', '));
  if (filters.services && filters.services.length) parts.push(filters.services.length + ' service' + (filters.services.length === 1 ? '' : 's') + ' selected');
  if (filters.release && filters.release.name) parts.push(filters.release.name);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------------------------
// Econometric analysis: pick a dependent variable (Y) and one or more explanatory variables (X)
// from a catalog of real, already-collected metrics, aligned at one of three granularities (one
// row per service / one row per app / one row per week), and fit an OLS regression (lib/econometrics.js).
// Every variable below is read straight from bugs.json, Test suite run history or the Jira defect
// lifecycle cache — nothing is a placeholder or a guess. Variables that need data this app does not
// have (requirement/code coverage, story points, deployment/CI metrics, production-escape data) are
// deliberately left out rather than invented; see the "not added" note in the Workspace/Metrics
// conversation this shipped with.
const ECON_GRANULARITIES = {
  service: {
    label: 'By service — one row per service with at least one logged finding',
    unitLabel: 'service',
    variables: [
      { key: 'bug_count', label: 'Bug count', desc: 'Findings logged against this service.' },
      { key: 'avg_bugs_per_task', label: 'Avg bugs per task', desc: 'Findings ÷ distinct tickets touched.' },
      { key: 'risk_score', label: 'Risk score', desc: 'Severity-weighted damage per ticket touched.' },
      { key: 'tickets_touched', label: 'Tickets touched', desc: 'Distinct tickets with at least one finding.' },
      { key: 'severity_score', label: 'Severity-weighted score', desc: 'critical×5 + major×3 + minor×1.' },
      { key: 'pct_critical', label: '% critical findings', desc: 'Share of this service’s findings that are critical.' },
      { key: 'pct_major', label: '% major findings', desc: 'Share of this service’s findings that are major.' },
      { key: 'pct_minor', label: '% minor findings', desc: 'Share of this service’s findings that are minor.' },
    ],
  },
  app: {
    label: 'By app — CORE / SVC / mcp-server (only 3 rows — results here are illustrative, not statistically powered)',
    unitLabel: 'app',
    variables: [
      { key: 'bug_count', label: 'Bug count', desc: 'Findings logged against this app.' },
      { key: 'risk_score', label: 'Risk score', desc: 'Severity-weighted damage per ticket touched, app-wide.' },
      { key: 'avg_testing_time_sec', label: 'Avg analysis run time (s)', desc: 'Mean duration of finished agent runs for this app.' },
      { key: 'release_total_issues', label: 'Current release: issue count', desc: 'Issues in this app’s current Jira release (Monitoring & control).' },
      { key: 'release_done_pct', label: 'Current release: % done', desc: 'Share of this release’s issues in a Done-family status.' },
      { key: 'release_blocked_pct', label: 'Current release: % blocked', desc: 'Share of this release’s issues in a Blocked-family status.' },
      { key: 'release_active_pct', label: 'Current release: % in progress', desc: 'Share of this release’s issues in an active (in progress/review) status.' },
    ],
  },
  week: {
    label: 'Over time — one row per ISO week in the selected period',
    unitLabel: 'week',
    variables: [
      { key: 'bugs_created', label: 'Bugs logged that week', desc: 'New entries in the bug registry, by creation date.' },
      { key: 'defects_opened_jira', label: 'Jira: bugs opened that week', desc: 'Bug-type issues created in Jira that week.' },
      { key: 'defects_closed_jira', label: 'Jira: bugs closed that week', desc: 'Bug-type issues resolved in Jira that week.' },
      { key: 'avg_testing_time_sec', label: 'Avg analysis run time (s)', desc: 'Mean duration of finished agent runs that week.' },
      { key: 'test_pass_rate', label: 'Test suite pass rate (%)', desc: 'Share of passed test results across Test suite runs that week.' },
      { key: 'tickets_touched', label: 'Distinct tickets touched', desc: 'Distinct tickets with at least one bug-registry finding that week.' },
    ],
  },
};

function buildServiceDataset(filters) {
  return serviceAggregates(filters).filter((s) => s.tick > 0).map((s) => ({
    key: s.name, group: s.app,
    values: {
      bug_count: s.n, avg_bugs_per_task: s.avg, risk_score: s.per, tickets_touched: s.tick,
      severity_score: s.score, pct_critical: s.n ? s.k / s.n * 100 : 0, pct_major: s.n ? s.w / s.n * 100 : 0, pct_minor: s.n ? s.d / s.n * 100 : 0,
    },
  }));
}
function buildAppDataset(filters) {
  return appKeys().map((key) => {
    const rowsBugs = filterBugs({ ...filters, apps: [key] });
    const n = rowsBugs.length;
    const score = rowsBugs.reduce((s, b) => s + (SEVW[b.severity] || 1), 0);
    const tickets = new Set(rowsBugs.map((b) => b.ticket).filter(Boolean));
    const risk = tickets.size ? score / tickets.size : 0;
    const durs = filterRuns({ ...filters, apps: [key] }).map((r) => Math.max(0, Math.round((r.finishedAt - r.startedAt) / 1000)));
    const avgTesting = durs.length ? durs.reduce((s, v) => s + v, 0) / durs.length : 0;
    const snap = testMonitor.snapshot(key);
    const rel = snap && snap.currentReleaseName && (snap.releases || []).find((r) => r.name === snap.currentReleaseName);
    const rm = rel ? rel.metrics : null;
    let donePct = 0, blockedPct = 0, activePct = 0;
    if (rm && rm.total) {
      const byFam = { done: 0, blocked: 0, active: 0, todo: 0 };
      rm.byStatus.forEach((s) => { byFam[statusFamily(s.status)] = (byFam[statusFamily(s.status)] || 0) + s.count; });
      donePct = byFam.done / rm.total * 100; blockedPct = byFam.blocked / rm.total * 100; activePct = byFam.active / rm.total * 100;
    }
    return {
      key, group: labelFor(key),
      values: { bug_count: n, risk_score: risk, avg_testing_time_sec: avgTesting, release_total_issues: rm ? rm.total : 0, release_done_pct: donePct, release_blocked_pct: blockedPct, release_active_pct: activePct },
    };
  });
}
function buildWeekDataset(filters) {
  const period = filters.period && (filters.period.from || filters.period.to) ? filters.period : { from: Date.now() - 90 * 86400000 };
  const from = period.from || Date.now() - 90 * 86400000;
  const to = period.to || Date.now();
  const WEEK = 7 * 86400000;
  const n = Math.min(104, Math.max(1, Math.ceil((to - from) / WEEK) + 1));
  const bugsRows = filterBugs({ ...filters, period: { from, to } });
  const runRows = filterRuns({ ...filters, period: { from, to } });
  const suiteRuns = suiteLib.suite.runs.filter((r) => inPeriod(r.startedAt, { from, to }));
  defectLifecycle.refresh(false).catch(() => {});
  const weekly = defectLifecycle.weeklySeries({ ...filters, period: { from, to } });
  const bucketOf = (t) => Math.min(n - 1, Math.max(0, Math.floor((t - from) / WEEK)));
  const bugsCreated = new Array(n).fill(0), ticketsByWeek = Array.from({ length: n }, () => new Set());
  bugsRows.forEach((b) => { if (!b.createdAt) return; const i = bucketOf(b.createdAt); bugsCreated[i]++; if (b.ticket) ticketsByWeek[i].add(b.ticket); });
  const durByWeek = Array.from({ length: n }, () => []);
  runRows.forEach((r) => { durByWeek[bucketOf(r.startedAt)].push(Math.max(0, Math.round((r.finishedAt - r.startedAt) / 1000))); });
  const passByWeek = Array.from({ length: n }, () => ({ pass: 0, total: 0 }));
  suiteRuns.forEach((r) => { const i = bucketOf(r.startedAt); Object.values(r.results).forEach((o) => { passByWeek[i].total++; if (o === 'passed' || o === 'xfail') passByWeek[i].pass++; }); });
  const rows = [];
  for (let i = 0; i < n; i++) {
    const durs = durByWeek[i];
    const avgTesting = durs.length ? durs.reduce((s, v) => s + v, 0) / durs.length : 0;
    const pr = passByWeek[i];
    rows.push({
      key: new Date(from + i * WEEK).toISOString().slice(0, 10), group: 'week',
      values: {
        bugs_created: bugsCreated[i],
        defects_opened_jira: (weekly[i] && weekly[i].opened) || 0,
        defects_closed_jira: (weekly[i] && weekly[i].closed) || 0,
        avg_testing_time_sec: avgTesting,
        test_pass_rate: pr.total ? pr.pass / pr.total * 100 : 0,
        tickets_touched: ticketsByWeek[i].size,
      },
    });
  }
  return rows;
}
function buildDataset(granularity, filters) {
  if (granularity === 'service') return buildServiceDataset(filters);
  if (granularity === 'app') return buildAppDataset(filters);
  if (granularity === 'week') return buildWeekDataset(filters);
  throw new Error('Unknown granularity: ' + granularity);
}

/** Runs the OLS regression for a chosen Y/X set at a chosen granularity, and saves the result as a
 * gallery entry (statKey 'econometric_model') just like a chart — a frozen snapshot of this data. */
function createEconometric({ granularity, y, xs, filters, title }) {
  const gran = ECON_GRANULARITIES[granularity];
  if (!gran) throw new Error('Unknown granularity: ' + granularity);
  const known = new Set(gran.variables.map((v) => v.key));
  if (!known.has(y)) throw new Error('Unknown dependent variable for this granularity: ' + y);
  const xList = (xs || []).filter((x) => x !== y);
  if (!xList.length) throw new Error('Pick at least one explanatory variable');
  const bad = xList.find((x) => !known.has(x));
  if (bad) throw new Error('Unknown explanatory variable for this granularity: ' + bad);
  const dataset = buildDataset(granularity, filters || {});
  const rows = dataset.filter((r) => xList.every((x) => Number.isFinite(r.values[x])) && Number.isFinite(r.values[y]));
  const yVec = rows.map((r) => r.values[y]);
  const xMat = rows.map((r) => xList.map((x) => r.values[x]));
  const labelOf = (key) => (gran.variables.find((v) => v.key === key) || {}).label || key;
  const names = xList.map(labelOf);
  const result = econometrics.regress(yVec, xMat, names, granularity === 'week');
  const rec = {
    id: crypto.randomBytes(6).toString('hex'),
    title: title && title.trim() ? title.trim().slice(0, 120) : `${labelOf(y)} vs ${names.join(', ')}`,
    statKey: 'econometric_model', chartType: 'econometric', filters: filters || {},
    data: {
      chartType: 'econometric', granularity, granularityLabel: gran.label,
      y, yLabel: labelOf(y), xs: xList, xLabels: names,
      n: result.n, k: result.k, r2: result.r2, adjR2: result.adjR2, fStat: result.fStat, fPValue: result.fPValue,
      durbinWatson: result.durbinWatson, coefficients: result.coefficients, corrMatrix: result.corrMatrix, flags: result.flags,
      scatter: rows.map((r, i) => ({ fitted: result.fitted[i], residual: result.residuals[i], label: r.key })),
      dataset: rows,
    },
    caption: `${gran.unitLabel} level · n=${result.n} · R²=${result.r2.toFixed(2)}${result.adjR2 != null ? ` (adj ${result.adjR2.toFixed(2)})` : ''}`,
    createdAt: Date.now(),
  };
  saved.push(rec);
  save();
  return rec;
}

/** Asks the model to narrate an already-computed regression report in plain language. The model is
 * given ONLY the numbers in `rec.data` (no tools, no other context — lib/claude-once.js's claudeOnce
 * runs with --tools '' --strict-mcp-config), so it cannot fetch or invent additional facts; it can
 * only restate and interpret what this app already computed. */
async function aiInterpretEconometric(id) {
  const rec = saved.find((m) => m.id === id && m.statKey === 'econometric_model');
  if (!rec) throw new Error('No such report');
  const d = rec.data;
  const system = `You are a QA/test-metrics analyst narrating the output of an OLS regression that has ALREADY been computed by the application — exact numbers, not estimates. You have no tools and cannot look anything else up.
Rules:
- Use ONLY the numbers given below. Never invent a data point, a cause, or a fact about what the service/app actually does.
- State which coefficients are statistically significant (p<0.05) and in which direction, in the real units given (not vague terms like "somewhat").
- Explicitly mention any methodology flags given (multicollinearity, autocorrelation, small sample, low R², insignificant F-test) and how they limit what can be concluded.
- If R² is low or the F-test is not significant, say plainly that the model does not explain the outcome well — do not oversell a weak fit.
- End with 2-4 concrete, QA-relevant suggestions for what to look into next, each one tied to a specific number above (never a generic platitude).
- Plain text, short paragraphs or a short bulleted list, no markdown headers, under 300 words.`;
  const input = `Dependent variable (Y): ${d.yLabel}
Explanatory variables (X): ${d.xLabels.join(', ')}
Granularity: ${d.granularityLabel}
N = ${d.n}, R² = ${d.r2.toFixed(3)}, adjusted R² = ${d.adjR2 != null ? d.adjR2.toFixed(3) : 'n/a'}
F-statistic = ${d.fStat != null ? d.fStat.toFixed(2) : 'n/a'}, F p-value = ${d.fPValue != null ? d.fPValue.toFixed(4) : 'n/a'}
${d.durbinWatson != null ? `Durbin-Watson = ${d.durbinWatson.toFixed(2)}\n` : ''}Coefficients:
${d.coefficients.map((c) => `- ${c.name}: beta=${c.beta.toFixed(4)}, SE=${c.se.toFixed(4)}, t=${c.t != null ? c.t.toFixed(2) : 'n/a'}, p=${c.p != null ? c.p.toFixed(4) : 'n/a'}${c.vif != null ? `, VIF=${c.vif === Infinity ? '∞' : c.vif.toFixed(1)}` : ''}`).join('\n')}
Methodology flags:
${d.flags.map((f) => '- ' + f).join('\n')}`;
  const r = await claudeOnce(system, input, 120000);
  rec.data.aiNarrative = r.text.trim();
  rec.data.aiCostUsd = r.costUsd;
  save();
  return rec;
}

function catalog() {
  const apps = appKeys().map((key) => ({ key, label: labelFor(key) }));
  const servicesByApp = {};
  bugsLib.bugs.forEach((b) => { (servicesByApp[b.agent] = servicesByApp[b.agent] || new Set()).add(b.service); });
  Object.keys(servicesByApp).forEach((k) => { servicesByApp[k] = [...servicesByApp[k]].sort(); });
  const releases = {};
  apps.forEach((a) => { const snap = testMonitor.snapshot(a.key); releases[a.key] = ((snap && snap.releases) || []).map((r) => r.name); });
  return {
    stats: STATS, apps, servicesByApp, releases,
    econGranularities: ECON_GRANULARITIES,
    defectLifecycle: { fetchedAt: defectLifecycle.state.fetchedAt, ok: defectLifecycle.state.ok, error: defectLifecycle.state.error, busy: defectLifecycle.state.busy },
  };
}

// Full records, not a summary: the gallery renders every saved chart's own (small, already
// capped) data, so it needs `data` too, not just the title/caption used for the list rows.
function list() {
  return [...saved].sort((a, b) => b.createdAt - a.createdAt);
}
function get(id) { return saved.find((m) => m.id === id) || null; }
function create(statKey, filters, title) {
  const def = STATS.find((s) => s.key === statKey);
  if (!def) throw new Error('Unknown statistic: ' + statKey);
  filters = filters || {};
  const result = computeStat(statKey, filters);
  const rec = {
    id: crypto.randomBytes(6).toString('hex'),
    title: title && title.trim() ? title.trim().slice(0, 120) : def.label,
    statKey, chartType: result.chartType, filters,
    data: result,
    caption: captionFor(filters, result),
    createdAt: Date.now(),
  };
  saved.push(rec);
  save();
  return rec;
}
function remove(id) {
  const i = saved.findIndex((m) => m.id === id);
  if (i < 0) return false;
  saved.splice(i, 1);
  save();
  return true;
}

module.exports = {
  catalog, list, get, create, remove, serviceAggregates,
  createEconometric, aiInterpretEconometric,
  defectLifecycleRefresh: (force) => defectLifecycle.refresh(force),
};
