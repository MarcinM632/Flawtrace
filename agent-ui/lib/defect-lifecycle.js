// Defect lifecycle: created/resolved timestamps for every Bug-type issue in PRJ/SVC/OPS, straight
// from Jira. This is the one dataset the bug registry (lib/bugs.js) cannot provide: bugs.json is an
// explicitly status-less archive (see its own header comment — "nie ma statusu 'naprawiony'"), so
// opened-vs-closed and resolution-time metrics need the real Jira status/resolutiondate instead.
// Same mechanism as lib/test-monitor.js and lib/bugs.js: one read-only `claude -p` pass with the
// Jira tools (the server itself has no Jira credentials), cached and refreshed at most once a day.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');
const { AGENTS } = require('./agents');
const { jiraAsk, jiraRetry } = require('./bugs');

const src = () => require('./sources');
const PROJECTS = src().liveMap(() => src().jiraProjectMap());

/** Created and resolved dates of every Bug issue, straight from the REST API. */
async function restIssues() {
  const s = src();
  const keys = Object.keys(PROJECTS);
  if (!keys.length) return [];
  const issues = await s.jiraSearchAll(s.jql(s.projectClause(keys), 'issuetype = Bug', 'ORDER BY created ASC'), ['created', 'resolutiondate', 'status', 'priority'], 10000);
  return issues.map((i) => { const f = i.fields || {}; return { key: i.key, created: f.created, resolved: f.resolutiondate || '', status: (f.status && f.status.name) || '', priority: (f.priority && f.priority.name) || '' }; });
}
const STATE_FILE = path.join(DATA_DIR, 'defect-lifecycle.json');
const state = { issues: [], fetchedAt: 0, ok: null, error: '', busy: false };
try { Object.assign(state, JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')), { busy: false }); } catch (_) { /* pierwszy start */ }
const save = () => { try { fs.writeFileSync(STATE_FILE, JSON.stringify({ issues: state.issues, fetchedAt: state.fetchedAt, ok: state.ok, error: state.error })); } catch (_) { /* nieistotne */ } };

const REFRESH_EVERY = (Number(process.env.DEFECT_LIFECYCLE_HOURS) || 24) * 3600 * 1000;

function prompt() {
  const projects = Object.keys(PROJECTS).join(', ');
  const jql = `project in (${projects}) AND issuetype = Bug ORDER BY created ASC`;
  return `Pobierz z Jiry cykl życia zgłoszeń typu Bug: kiedy powstały i kiedy (jeśli w ogóle) zostały zamknięte. Tylko odczyt, bez żadnych innych działań.
1. Wywołaj getAccessibleAtlassianResources i weź cloudId.
2. Wywołaj searchJiraIssuesUsingJql z cloudId, jql: ${jql}, maxResults: 100, fields: ["created","resolutiondate","status","priority"]. Gdy isLast=false, pobieraj kolejne strony przez nextPageToken, aż do końca.
3. Odpowiedz WYŁĄCZNIE tablicą JSON (bez tekstu przed i po, bez bloku kodu), po jednym obiekcie na zgłoszenie:
{"key":"PRJ-100","created":"<created dokładnie jak w Jirze>","resolved":"<resolutiondate dokładnie jak w Jirze, albo pusty jeśli nierozwiązane>","status":"<nazwa statusu>","priority":"<nazwa priorytetu lub pusty>"}
Brak wyników = []. Niczego nie dopisuj i nie zmieniaj.`;
}

async function refresh(force) {
  if (state.busy) return;
  if (!force && state.fetchedAt && Date.now() - state.fetchedAt < REFRESH_EVERY) return;
  state.busy = true;
  try {
    const list = src().jiraRest() ? await restIssues() : await jiraRetry(() => jiraAsk(prompt(), 240000));
    const issues = (Array.isArray(list) ? list : [])
      .filter((it) => it && /^[A-Z][A-Z0-9_]*-\d+$/.test(String(it.key || '').toUpperCase()))
      .map((it) => {
        const key = String(it.key).toUpperCase();
        const proj = key.split('-')[0];
        const created = Date.parse(it.created);
        const resolved = it.resolved ? Date.parse(it.resolved) : null;
        return {
          key, agent: PROJECTS[proj] || null,
          created: Number.isFinite(created) ? created : null,
          resolved: Number.isFinite(resolved) ? resolved : null,
          status: String(it.status || '').trim(),
          priority: String(it.priority || '').trim(),
        };
      })
      .filter((it) => it.agent && it.created);
    state.issues = issues;
    state.fetchedAt = Date.now();
    state.ok = true;
    state.error = '';
  } catch (e) {
    state.ok = false;
    state.error = String((e && e.message) || e).slice(0, 300);
  } finally {
    state.busy = false;
    save();
  }
}

const WEEK_MS = 7 * 86400000;
/** New-per-week opened/closed counts, shared by cumulativeFlow (running totals) and the "week"
 * econometric dataset (lib/metrics.js), which needs per-bucket counts, not running ones. */
function weeklyBuckets(filters) {
  const apps = filters.apps && filters.apps.length ? filters.apps : Object.values(PROJECTS);
  const rows = state.issues.filter((it) => apps.includes(it.agent));
  if (!rows.length) return { from: 0, n: 0, opened: [], closed: [] };
  const ts = rows.map((r) => r.created);
  const from = (filters.period && filters.period.from) || Math.min(...ts);
  const to = (filters.period && filters.period.to) || Date.now();
  const n = Math.min(104, Math.max(1, Math.ceil((to - from) / WEEK_MS) + 1));
  const bucketOf = (t) => Math.min(n - 1, Math.max(0, Math.floor((t - from) / WEEK_MS)));
  const opened = new Array(n).fill(0), closed = new Array(n).fill(0);
  for (const r of rows) {
    if (r.created >= from && r.created <= to) opened[bucketOf(r.created)]++;
    if (r.resolved && r.resolved >= from && r.resolved <= to) closed[bucketOf(r.resolved)]++;
  }
  return { from, n, opened, closed };
}
/** Weekly cumulative opened vs closed, for the cumulative-flow chart. `filters.apps` narrows to
 * one or more products; `filters.period` clips the window (same shape as lib/metrics.js filters). */
function cumulativeFlow(filters) {
  const { from, n, opened, closed } = weeklyBuckets(filters);
  if (!n) return { opened: [], closed: [] };
  let runO = 0, runC = 0;
  const openedPts = [], closedPts = [];
  for (let i = 0; i < n; i++) {
    runO += opened[i]; runC += closed[i];
    const label = new Date(from + i * WEEK_MS).toISOString().slice(0, 10);
    openedPts.push({ t: from + i * WEEK_MS, label, value: runO });
    closedPts.push({ t: from + i * WEEK_MS, label, value: runC });
  }
  return { opened: openedPts, closed: closedPts };
}
/** Per-week new-opened / new-closed counts (not running totals) — one row per week, for the
 * econometrics "over time" dataset. */
function weeklySeries(filters) {
  const { from, n, opened, closed } = weeklyBuckets(filters);
  const out = [];
  for (let i = 0; i < n; i++) out.push({ weekStart: from + i * WEEK_MS, opened: opened[i], closed: closed[i] });
  return out;
}

/** Resolution-time distribution (days) per app, for resolved bugs — MTTR is the mean of this. Also
 * returns the age (days, still open) of unresolved bugs — the "defect age" half of the same metric. */
function resolutionStats(filters) {
  const apps = filters.apps && filters.apps.length ? filters.apps : Object.values(PROJECTS);
  const rows = state.issues.filter((it) => apps.includes(it.agent) && inPeriod(it.created, filters.period));
  const DAY = 86400000;
  const byApp = {};
  for (const r of rows) {
    const a = (byApp[r.agent] = byApp[r.agent] || { resolved: [], openAges: [] });
    if (r.resolved) a.resolved.push((r.resolved - r.created) / DAY);
    else a.openAges.push((Date.now() - r.created) / DAY);
  }
  return Object.entries(byApp).map(([agent, a]) => ({
    agent, label: AGENTS[agent] ? AGENTS[agent].label : agent,
    resolved: a.resolved.sort((x, y) => x - y),
    openAges: a.openAges.sort((x, y) => x - y),
    mttrDays: a.resolved.length ? a.resolved.reduce((s, v) => s + v, 0) / a.resolved.length : null,
    openCount: a.openAges.length,
    medianAgeDays: a.openAges.length ? a.openAges[Math.floor(a.openAges.length / 2)] : null,
  }));
}
function inPeriod(ts, period) {
  if (!period || (!period.from && !period.to)) return true;
  if (!ts) return false;
  if (period.from && ts < period.from) return false;
  if (period.to && ts > period.to) return false;
  return true;
}

module.exports = { PROJECTS, state, refresh, cumulativeFlow, weeklySeries, resolutionStats };
