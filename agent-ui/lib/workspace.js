// Workspace: "co teraz testować" — zadania przypisane do mnie w Jirze (PRJ/SVC/OPS), ustawione w
// kolejności testowania: najpierw priorytet nadany w Jirze, przy remisie serwis o najwyższym
// ryzyku (ta sama ważona gęstość defektów co w zakładce Risk, liczona z rejestru błędów). Ten sam
// mechanizm co lib/test-monitor.js i lib/bugs.js: serwer nie ma poświadczeń do Jiry, więc dane to
// krótki, tylko-odczytowy przebieg `claude -p` z narzędziami Jiry.
const fs = require('fs');
const path = require('path');
const { AUTOTEST_REPO, DATA_DIR, RUNS_DIR } = require('./config');
const { AGENTS, servicesFor } = require('./agents');
const bugsLib = require('./bugs');
const { jiraAsk, jiraRetry } = bugsLib;

const src = () => require('./sources');
// Jira project -> product. With Jira connected in Sources these are the keys from its Projects field.
const PROJECTS = src().liveMap(() => src().jiraProjectMap());

/** The service a task belongs to, by its name appearing in the components, title or description. */
function guessService(agent, text) {
  let list = []; try { list = agent ? servicesFor(agent) : []; } catch (_) { /* no catalogue */ }
  const t = String(text || '').toLowerCase();
  const hit = list.find((s) => { const n = s.toLowerCase(); const short = n.replace(/^[a-z]+-/, '').replace(/-/g, ' '); return t.includes(n) || (short.length >= 4 && t.includes(short)); });
  return hit || 'nieustalony';
}

/** Open tasks assigned to the account of the Jira token, straight from the REST API. */
async function restTasks() {
  const s = src();
  const q = s.jql(s.projectClause(Object.keys(PROJECTS)), 'assignee = currentUser()', 'statusCategory != Done', 'ORDER BY priority DESC, updated DESC');
  const issues = await s.jiraSearchAll(q, ['summary', 'status', 'priority', 'issuetype', 'components', 'parent', 'created', 'comment', 'description'], 500);
  return issues.map((i) => {
    const f = i.fields || {};
    const comps = (f.components || []).map((c) => c.name);
    return {
      key: i.key, summary: f.summary || '', status: (f.status && f.status.name) || '', priority: (f.priority && f.priority.name) || '',
      type: (f.issuetype && f.issuetype.name) || '', parent: f.parent ? f.parent.key : '', comments: (f.comment && f.comment.total) || 0, created: f.created || '',
      service: guessService(PROJECTS[i.key.split('-')[0]], [comps.join(' '), f.summary, s.adfText(f.description)].join(' ')),
    };
  });
}

const STATE_FILE = path.join(DATA_DIR, 'workspace.json');
const state = { tasks: [], fetchedAt: 0, ok: null, error: '', busy: false };
try { Object.assign(state, JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')), { busy: false }); } catch (_) { /* pierwszy start */ }
const save = () => {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify({ tasks: state.tasks, fetchedAt: state.fetchedAt, ok: state.ok, error: state.error })); } catch (_) { /* nieistotne */ }
};

// Odświeżanie rzadkie z automatu (lista zadań nie zmienia się z minuty na minutę), przycisk "Refresh" wymusza od razu.
const SYNC_EVERY = (Number(process.env.WORKSPACE_SYNC_MINUTES) || 15) * 60 * 1000;

// Skala priorytetów Jiry — mniejsza liczba = testować wcześniej. Ten sam duch co JIRA_SEV w lib/bugs.js,
// tu jednak porządek, nie dotkliwość. Nieznany/pusty priorytet ląduje w środku (jak "Medium"), żeby
// brak danych nie wypychał zadania ani na start, ani na koniec kolejki.
const PRIORITY_RANK = { blocker: 0, highest: 0, critical: 1, high: 2, medium: 3, low: 4, lowest: 5, trivial: 5 };
const UNKNOWN_RANK = 3;
const rankOf = (p) => { const r = PRIORITY_RANK[String(p || '').toLowerCase().trim()]; return r == null ? UNKNOWN_RANK : r; };

function prompt() {
  const projects = Object.keys(PROJECTS).join(', ');
  const svc = Object.entries(PROJECTS).map(([proj, key]) => {
    let list = []; try { list = servicesFor(key); } catch (_) { /* brak katalogu */ }
    return `${proj}: ${list.join(', ') || '(brak listy)'}`;
  }).join('\n');
  return `Pobierz z Jiry zadania przypisane TERAZ do mnie. Tylko odczyt, bez żadnych innych działań.
1. Wywołaj getAccessibleAtlassianResources i weź cloudId.
2. Wywołaj searchJiraIssuesUsingJql z cloudId, jql: project in (${projects}) AND assignee = currentUser() AND statusCategory != Done ORDER BY priority DESC, updated DESC, maxResults: 100, fields: ["summary","status","priority","issuetype","components","parent","created","comment","description"]. Gdy isLast=false, pobieraj kolejne strony przez nextPageToken, aż do końca.
3. Pole components to tablica obiektów — weź z niej nazwy (component.name), połącz przecinkiem w "components".
4. Pole "service": użyj components, summary ORAZ description. Chodzi o to, który serwis trzyma ZMIENIANĄ LOGIKĘ BIZNESOWĄ, nie o to, co dodatkowo może być tknięte przy okazji (np. warstwa UI/wyświetlania) — jeśli nazwa serwisu z listy (albo jego domena, np. "Hedger" = core-hedger, "Notification"/"mailing" = notification-service, "Feed" = core-feed-analyser) pojawia się wprost w tytule, components lub opisie, wybierz ten serwis, nawet jeśli dotyczy to "dashboardu"/ekranu — dashboardy i raporty w CORE to zwykle endpointy i logika SAMEGO tego serwisu domenowego, nie osobnej aplikacji frontendowej. "nieustalony" zostaw tylko wtedy, gdy NIC — ani tytuł, ani components, ani opis — nie wskazuje żadnej nazwy/domeny z listy. Nie wymyślaj nazw spoza listy.
Serwisy:
${svc}
5. Pole "comments": liczba z fields.comment.total (liczba całkowita, 0 gdy brak). Pole "created": fields.created dokładnie jak w Jirze.
6. Odpowiedz WYŁĄCZNIE tablicą JSON (bez tekstu przed i po, bez bloku kodu), po jednym obiekcie na zadanie:
{"key":"PRJ-123","summary":"<dokładnie jak w Jirze>","status":"<nazwa statusu>","priority":"<nazwa priorytetu lub pusty>","type":"<nazwa typu zgłoszenia>","service":"<serwis z listy albo nieustalony>","parent":"<klucz parenta lub pusty>","comments":0,"created":"<data utworzenia>"}
Brak wyników = []. Niczego nie dopisuj i nie zmieniaj.`;
}

async function refresh(force) {
  if (state.busy) return;
  if (!force && state.fetchedAt && Date.now() - state.fetchedAt < SYNC_EVERY) return;
  state.busy = true;
  try {
    const list = src().jiraRest() ? await restTasks() : await jiraRetry(() => jiraAsk(prompt(), 180000));
    const tasks = (Array.isArray(list) ? list : [])
      .filter((it) => it && /^[A-Z][A-Z0-9]*-\d+$/.test(String(it.key || '').toUpperCase()))
      .map((it) => {
        const key = String(it.key).toUpperCase();
        const proj = key.split('-')[0];
        const agent = PROJECTS[proj] || null;
        return {
          key,
          summary: String(it.summary || '').trim().slice(0, 300),
          status: String(it.status || '').trim(),
          priority: String(it.priority || '').trim(),
          type: String(it.type || '').trim(),
          service: String(it.service || '').trim() || 'nieustalony',
          parent: String(it.parent || '').toUpperCase(),
          comments: Number(it.comments) || 0,
          created: String(it.created || '').trim(),
          agent,
          label: agent ? AGENTS[agent].label : proj,
        };
      });
    state.tasks = tasks;
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

// Ważona gęstość defektów serwisu z rejestru błędów — te same wagi i ten sam wzór (score / dotknięte
// tickety) co zakładka Risk (public/js/09-risk.js, computeMetrics), żeby "co jest krytyczne" znaczyło
// w całej aplikacji to samo. Liczone na żądanie z aktualnego stanu rejestru, nie przy każdym imporcie
// z Jiry, więc nowy bug natychmiast przestawia kolejkę bez kolejnego przebiegu `claude -p`.
const SEVW = { krytyczny: 5, wazny: 3, drobny: 1 };
function serviceRiskScore(service) {
  if (!service || service === 'nieustalony') return 0;
  let score = 0; const tickets = new Set();
  for (const b of bugsLib.bugs) {
    if (b.service !== service) continue;
    score += SEVW[b.severity] || 1;
    if (b.ticket) tickets.add(b.ticket);
  }
  return tickets.size ? score / tickets.size : score;
}

/** Zadania w kolejności testowania: priorytet Jiry, przy remisie ryzyko serwisu; przy dalszym
 * remisie zostaje kolejność z Jiry (priority DESC, updated DESC — już w zapytaniu). */
function ranked() {
  return state.tasks
    .map((t) => {
      const priorityRank = rankOf(t.priority);
      const riskScore = serviceRiskScore(t.service);
      const reason = t.service !== 'nieustalony'
        ? `Jira priority: ${t.priority || '(none)'} · service "${t.service}" risk density ${riskScore.toFixed(1)} (bug registry)`
        : `Jira priority: ${t.priority || '(none)'} · service not identified — no tie-break data`;
      return { ...t, priorityRank, riskScore: Math.round(riskScore * 10) / 10, reason };
    })
    .sort((a, b) => a.priorityRank - b.priorityRank || b.riskScore - a.riskScore);
}

// Pliki autotestów NASZEGO repo (lib/config AUTOTEST_REPO — nie zewnętrzne reference-tests), żeby
// sugestia "jakie autotesty" wskazywała istniejące pliki, a nie zmyślone nazwy.
function listAutotestFiles() {
  const root = path.join(AUTOTEST_REPO, 'tests');
  const out = [];
  const walk = (dir) => {
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      if (e.name.startsWith('.') || e.name === '__pycache__') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.startsWith('test_') && e.name.endsWith('.py')) out.push(path.relative(root, p).split(path.sep).join('/'));
    }
  };
  walk(root);
  return out.sort();
}
const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'into', 'when', 'oraz', 'dla', 'przy', 'które', 'ktora', 'nie', 'jest', 'sie']);
function keywordsOf(...texts) {
  const words = texts.join(' ').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  return [...new Set(words)];
}
/** Istniejące pliki autotestów, których ścieżka pasuje do słów kluczowych z serwisu/tematu zadania —
 * dopasowanie tekstowe, nie zgadywanie: trafienie wymaga realnego słowa ze ścieżki pliku. */
function autotestMatches(service, summary) {
  const files = listAutotestFiles();
  const words = keywordsOf(service || '', summary || '');
  if (!words.length) return [];
  return files
    .map((f) => ({ file: f, score: words.reduce((n, w) => n + (f.toLowerCase().includes(w) ? 1 : 0), 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.file)
    .slice(0, 8);
}

/** Checklist ogólnej strategii testowej wg typu zgłoszenia — ramy postępowania, nie zmyślone fakty
 * o tym, co konkretnie jest zepsute (to jest w treści ticketu, patrz "Read ticket"). */
function checklistFor(type, matches) {
  const isBug = /bug|błąd|defect/i.test(type || '');
  const steps = [];
  if (isBug) {
    steps.push('Reproduce the defect exactly as described in the ticket before touching anything else.');
    steps.push('Verify the fix removes the reported symptom, on the same steps and the same data as the report.');
    steps.push('Regression-test the area around the fix, not just the one reported path.');
    steps.push('Retry the same scenario with boundary/negative inputs near the original failure (limits, empty/zero values, closed sessions, duplicate or concurrent actions).');
  } else {
    steps.push('Verify every acceptance criterion in the ticket description one by one — list them out before testing.');
    steps.push('Happy-path pass first, using the exact flow described in the ticket.');
    steps.push('Negative/edge-case pass: invalid input, permission boundaries, duplicate or concurrent actions.');
    steps.push('Regression pass on the directly affected service and anything that reads/writes the same data.');
  }
  if (matches.length) {
    steps.push(`Existing autotests touching this area — run and extend rather than starting from scratch: ${matches.join(', ')}.`);
  } else {
    steps.push('No existing autotest matched this service/topic by name — note it as a coverage gap once manual verification passes.');
  }
  steps.push('Read the full ticket (description + comments) before testing — do not test from memory of a similar past ticket.');
  return steps;
}

function guidanceFor(key) {
  const task = state.tasks.find((t) => t.key === key.toUpperCase());
  if (!task) return null;
  const matches = autotestMatches(task.service, task.summary);
  return { key: task.key, service: task.service, type: task.type, autotestMatches: matches, checklist: checklistFor(task.type, matches) };
}

// "W którym momencie jest ten task" — Test Flow to łańcuch faz (lib/run-agent.js FLOW_NEXT); agenci
// ad-hoc (core/svc/mcp quick check, autotest, qamcp) nie są jego częścią, ale liczą się do historii.
const FLOW_ORDER = ['planning', 'analysis', 'design', 'implementation', 'execution', 'completion'];

/** Wszystkie runy tej appki (dowolny agent, dowolny status) dotyczące danego ticketu, chronologicznie,
 * plus najdalsza faza Test Flow, do jakiej dotarł — do zakładki Workspace ("stage & activity"). */
function activityFor(key) {
  const re = new RegExp(`\\b${key}\\b`, 'i');
  const list = [];
  let files; try { files = fs.readdirSync(RUNS_DIR).filter((f) => f.endsWith('.json')); } catch (_) { files = []; }
  for (const f of files) {
    let d; try { d = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), 'utf8')); } catch (_) { continue; }
    const m = d.meta;
    if (!m || !re.test(`${m.ticket || ''}\n${m.notes || ''}`)) continue;
    list.push({
      id: m.id, agent: m.agent, label: m.label, status: m.status, reportStatus: m.reportStatus || '',
      startedAt: m.startedAt, finishedAt: m.finishedAt, staging: m.staging ? m.staging.state : null,
    });
  }
  list.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
  const reached = list.filter((r) => FLOW_ORDER.includes(r.agent)).map((r) => FLOW_ORDER.indexOf(r.agent));
  const stage = reached.length ? FLOW_ORDER[Math.max(...reached)] : null;
  return { key: key.toUpperCase(), runs: list, stage };
}

module.exports = { PROJECTS, state, refresh, ranked, guidanceFor, activityFor, rankOf, serviceRiskScore };
