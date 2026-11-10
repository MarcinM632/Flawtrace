// Test Flow — Phase 2: Test Monitoring and Control. Jeden monitor na projekt (PRJ/CORE, SVC, OPS/mcp-server),
// nie jeden wspólny dashboard: każdy projekt ma swoje wydania, swoje statusy i swoje ryzyko. Dane to
// zadania przypisane do nadchodzących wersji (wydań) z Jiry, tylko-do-odczytu, tym samym mechanizmem co
// rejestr błędów (lib/bugs.js) — krótki `claude -p` z narzędziami Jiry, bo serwer nie ma własnych
// poświadczeń do Jiry. (Wcześniej był tu też widok "bieżący sprint" — usunięty: sprint zbiera też stare,
// dawno domknięte zadania, więc jego wykres statusów nic nie mówił o postępie konkretnego wydania.)
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');
const { AGENTS } = require('./agents');
const { jiraAsk, jiraRetry } = require('./bugs');

// Ten sam zestaw projektów co rejestr błędów (PRJ→core, SVC→svc, AD→mcp) — spójność w całej aplikacji.
const src = () => require('./sources');
// product -> its Jira project. With Jira connected in Sources: the first project of the Projects field is the first product.
const PROJECTS = src().liveMap(() => {
  const out = {};
  for (const [jiraKey, agent] of Object.entries(src().jiraProjectMap())) if (agent && AGENTS[agent] && !out[agent]) out[agent] = { jiraKey, label: AGENTS[agent].label };
  return out;
});

/** Issues of the unreleased versions of a project, straight from the REST API, in the shape releasePrompt returns. */
async function restRelease(jiraKey) {
  const s = src();
  const issues = await s.jiraSearchAll(`project = "${jiraKey}" AND fixVersion in unreleasedVersions() ORDER BY key ASC`, ['summary', 'status', 'issuetype', 'priority', 'fixVersions'], 3000);
  return issues.map((i) => {
    const f = i.fields || {};
    const v = (f.fixVersions || []).find((x) => !x.released) || (f.fixVersions || [])[0];
    if (!v) return null;
    return {
      key: i.key, summary: f.summary || '', status: (f.status && f.status.name) || '',
      statusCategory: (f.status && f.status.statusCategory && f.status.statusCategory.name) || '',
      type: (f.issuetype && f.issuetype.name) || '', priority: (f.priority && f.priority.name) || '',
      version: v.name, versionId: String(v.id || ''), releaseDate: v.releaseDate || '',
    };
  }).filter(Boolean);
}

const STATE_FILE = path.join(DATA_DIR, 'test-monitor.json');

let state = { byProject: {} }; // key -> { releases, currentReleaseName, releaseFetchedAt, releaseOk, releaseError }
try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) { /* pierwszy start */ }
const save = () => { try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch (_) { /* nieistotne */ } };

// "Gotowe" trafiło do raportu jako 223 zadania, a statusCategory z modelu ich nie łapał (wolny od locale klucz
// Jiry bywa zwracany niekonsekwentnie) — stąd dopasowanie też po polskiej/angielskiej nazwie statusu, nie tylko
// po polu statusCategory, żeby "Done %" nie kłamał w dół.
const DONE_RE = /^done$|gotow|zrobion|zakończon|closed|resolved|release/i;

// Wersja Jiry sprawdzana raz dziennie: nie zmienia kształtu minuta do minuty tak jak sprint,
// więc pytanie o nią częściej kosztowałoby bez żadnej korzyści.
const RELEASE_REFRESH_EVERY = (Number(process.env.TEST_RELEASE_HOURS) || 24) * 3600 * 1000;
const releaseBusy = new Set();

function releasePrompt(jiraKey) {
  const jql = `project = ${jiraKey} AND fixVersion in unreleasedVersions() ORDER BY key ASC`;
  return `Pobierz z Jiry zadania przypisane do nadchodzących (jeszcze nieopublikowanych) wersji projektu ${jiraKey}. Tylko odczyt, bez żadnych innych działań.
1. Wywołaj getAccessibleAtlassianResources i weź cloudId.
2. Wywołaj searchJiraIssuesUsingJql z cloudId, jql: ${jql}, maxResults: 100, fields: ["summary","status","issuetype","priority","fixVersions"]. Gdy isLast=false, pobieraj kolejne strony przez nextPageToken, aż do końca. Gdy projekt nie ma żadnej nieopublikowanej wersji, zapytanie i tak wykonaj — wynik może być pusty.
3. Pole fixVersions to tablica wersji; weź z niej PIERWSZY element.
4. Odpowiedz WYŁĄCZNIE tablicą JSON (bez tekstu przed i po, bez bloku kodu), po jednym obiekcie na zadanie:
{"key":"${jiraKey}-123","summary":"<dokładnie jak w Jirze>","status":"<nazwa statusu dokładnie jak w Jirze>","statusCategory":"<status.statusCategory.name: to do | in progress | done>","type":"<nazwa typu zgłoszenia>","priority":"<nazwa priorytetu lub pusty>","version":"<fixVersions[0].name>","versionId":"<fixVersions[0].id>","releaseDate":"<fixVersions[0].releaseDate albo pusty>"}
Zadanie bez żadnej wersji w fixVersions pomiń. Brak wyników = []. Niczego nie dopisuj i nie zmieniaj.`;
}

const versionNums = (v) => (v.name.match(/\d+(\.\d+)*/) || [''])[0].split('.').filter(Boolean).map(Number);

/** Wersje nazwane jak produkt tego projektu (etykieta z PROJECTS, np. "CORE 7.3.0"). Projekt PRJ trzyma w
 * Jirze fixVersions kilku różnych komponentów na raz (np. "trading-statistics-python 2.1") — to NIE są
 * wydania CORE i nie mają co robić w zakładce, nawet jeśli mają przypisane zadania z projektu PRJ. */
function versionsForLabel(versions, label) {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('^' + esc, 'i');
  const named = versions.filter((v) => re.test(v.name.trim()));
  return named.length ? named : versions;
}

/** Spośród kandydackich wersji wybiera "bieżącą": nie-backlogową, z najniższym numerem wersji —
 * czyli najbliższą do wydania. Bez numeru w nazwie: ta z największą liczbą zadań. */
function pickCurrentVersion(versions, label) {
  const pool = versionsForLabel(versions, label);
  const numbered = pool.map((v) => ({ ...v, nums: versionNums(v) })).filter((v) => v.nums.length && !v.nums.some(Number.isNaN));
  if (numbered.length) {
    numbered.sort((a, b) => {
      for (let i = 0; i < Math.max(a.nums.length, b.nums.length); i++) {
        const d = (a.nums[i] || 0) - (b.nums[i] || 0);
        if (d) return d;
      }
      return 0;
    });
    return numbered[0];
  }
  return [...pool].sort((a, b) => b.issues.length - a.issues.length)[0] || null;
}

/** Wszystkie wydania (iteracje) do przeklikania w UI, posortowane od najbliższej do wydania. */
function sortVersions(versions) {
  return [...versions].sort((a, b) => {
    const an = versionNums(a), bn = versionNums(b);
    if (an.length && bn.length) {
      for (let i = 0; i < Math.max(an.length, bn.length); i++) {
        const d = (an[i] || 0) - (bn[i] || 0);
        if (d) return d;
      }
      return 0;
    }
    if (an.length !== bn.length) return bn.length - an.length; // numerowane przed nienumerowanymi
    return (a.releaseDate || '').localeCompare(b.releaseDate || '');
  });
}

async function refreshRelease(key) {
  const proj = PROJECTS[key];
  if (!proj || releaseBusy.has(key)) return (state.byProject[key] || {}).releases || null;
  releaseBusy.add(key);
  try {
    const list = src().jiraRest() ? await restRelease(proj.jiraKey) : await jiraRetry(() => jiraAsk(releasePrompt(proj.jiraKey), 240000));
    const issues = Array.isArray(list) ? list.filter((it) => it && /^[A-Z][A-Z0-9_]*-\d+$/.test(String(it.key || '').toUpperCase()) && it.version) : [];
    const byVer = new Map();
    for (const it of issues) {
      // "Backlog" to też realna wersja na stronie wydań Jiry (np. "CORE Backlog") — zostaje jako jedna z zakładek,
      // tylko nigdy nie zostanie wybrana jako "bieżąca" (pickCurrentVersion odrzuca ją: brak numeru w nazwie).
      if (!byVer.has(it.version)) byVer.set(it.version, { name: it.version, id: it.versionId || '', releaseDate: it.releaseDate || '', issues: [] });
      byVer.get(it.version).issues.push(it);
    }
    const versions = sortVersions(versionsForLabel([...byVer.values()], proj.label));
    const current = pickCurrentVersion(versions, proj.label);
    const entry = state.byProject[key] || {};
    entry.releases = versions;
    entry.currentReleaseName = current ? current.name : null;
    entry.releaseFetchedAt = Date.now();
    entry.releaseOk = true;
    entry.releaseError = '';
    state.byProject[key] = entry;
  } catch (e) {
    const entry = state.byProject[key] || { releases: [] };
    entry.releaseFetchedAt = Date.now();
    entry.releaseOk = false;
    entry.releaseError = String(e && e.message || e).slice(0, 300);
    state.byProject[key] = entry;
  } finally {
    releaseBusy.delete(key);
    save();
  }
  return state.byProject[key].releases;
}

/** Issue type + status, policzone w aplikacji (nie ocena modelu). */
function releaseMetrics(release) {
  const issues = (release && release.issues) || [];
  const byType = new Map(), byStatus = new Map();
  let done = 0;
  for (const it of issues) {
    const t = it.type || 'Nieznany';
    byType.set(t, (byType.get(t) || 0) + 1);
    const s = it.status || 'nieznany';
    byStatus.set(s, (byStatus.get(s) || 0) + 1);
    if (DONE_RE.test(it.statusCategory || '') || DONE_RE.test(s)) done++;
  }
  const total = issues.length;
  return {
    total, done, doneRatio: total ? done / total : 0,
    byType: [...byType.entries()].sort((a, b) => b[1] - a[1]).map(([type, count]) => ({ type, count })),
    byStatus: [...byStatus.entries()].sort((a, b) => b[1] - a[1]).map(([status, count]) => ({ status, count })),
  };
}

function snapshot(key) {
  const proj = PROJECTS[key];
  if (!proj) return null;
  const entry = state.byProject[key] || null;
  const relStale = !entry || !entry.releaseFetchedAt || Date.now() - entry.releaseFetchedAt > RELEASE_REFRESH_EVERY;
  if (relStale && !releaseBusy.has(key)) refreshRelease(key).catch(() => {}); // w tle; ta odpowiedź oddaje to, co już jest
  const releases = ((entry && entry.releases) || []).map((v) => ({
    name: v.name, id: v.id, releaseDate: v.releaseDate, issues: v.issues, metrics: releaseMetrics(v),
  }));
  return {
    key, jiraKey: proj.jiraKey, label: proj.label,
    total: releases.reduce((sum, r) => sum + r.metrics.total, 0),
    releases,
    currentReleaseName: entry ? entry.currentReleaseName : null,
    releaseFetchedAt: entry ? entry.releaseFetchedAt : 0,
    releaseOk: entry ? entry.releaseOk : null,
    releaseError: entry ? entry.releaseError : '',
    releaseRefreshing: releaseBusy.has(key),
  };
}

function all() {
  return Object.keys(PROJECTS).map(snapshot);
}

module.exports = { all, PROJECTS, refreshRelease, snapshot };
