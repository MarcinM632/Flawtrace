// Rejestr błędów (archiwum w bugs.json) i automatyczny import z Jiry.
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const crypto = require('crypto');
const { DATA_DIR, MODEL, RUNS_DIR } = require('./config');
const { AGENTS, servicesFor } = require('./agents');

// Archiwum zgłoszonych błędów (jeden plik JSON, bez bazy).
// To jest ARCHIWUM, nie tablica zadań: wpis raz dodany zostaje na zawsze.
// Nie ma statusu „naprawiony" ani usuwania — służy do analizy, które serwisy
// psują się najczęściej, i do pamiętania, jakie to były błędy.
const BUGS_FILE = path.join(DATA_DIR, 'bugs.json');
const SEVERITIES = ['krytyczny', 'wazny', 'drobny'];
let bugs = [];
try {
  bugs = JSON.parse(fs.readFileSync(BUGS_FILE, 'utf8'))
    .map(({ state, ...b }) => b); // zrzuć stary status z wcześniejszej wersji
} catch (_) { bugs = []; }
// Plik bugs.json może zmienić ktoś inny niż ten proces (import, ręczna edycja, drugi serwer). Bez ponownego
// odczytu rejestr w pamięci trwał przy stanie z chwili startu, a następny zapis kasował cudze wpisy.
let bugsMtime = 0;
function syncBugs() {
  let st; try { st = fs.statSync(BUGS_FILE); } catch (_) { return; }
  if (st.mtimeMs === bugsMtime) return;
  try {
    bugs = JSON.parse(fs.readFileSync(BUGS_FILE, 'utf8')).map(({ state, ...b }) => b);
    bugsMtime = st.mtimeMs;
  } catch (_) { /* plik w trakcie zapisu albo uszkodzony — zostaje poprzedni stan */ }
}
const saveBugs = () => {
  fs.writeFileSync(BUGS_FILE, JSON.stringify(bugs, null, 1));
  try { bugsMtime = fs.statSync(BUGS_FILE).mtimeMs; } catch (_) { /* nieistotne */ }
};
syncBugs();

// ---------- Import bugów z Jiry ----------
// Rejestr sam dociąga zgłoszone w Jirze błędy (typ Bug) z projektów PRJ, SVC i OPS. Serwer nie ma
// poświadczeń do Jiry — korzysta z konektora Atlassian, który ma `claude`, więc import to krótki,
// tylko-odczytowy przebieg `claude -p` z jednym narzędziem (JQL). Działa w tle: odpowiedź /api/bugs
// nie czeka na Jirę, a nowe wpisy pojawiają się po zakończeniu (UI dopytuje o status).
const JIRA_PROJECTS = { PRJ: 'core', SVC: 'svc', OPS: 'mcp' }; // projekt Jiry -> aplikacja w rejestrze
// Każde odświeżenie to płatna sesja modelu, a odpala je już samo otwarcie aplikacji albo zakładki z rejestrem. Dlatego
// automat jest rzadki: zgłoszenia typu Bug co godzinę, skan komentarzy (najdroższy: czyta HTML każdego zadania) co 12 godzin.
// Przycisk "Sync Jira now" odświeża oba od razu.
const JIRA_SYNC_EVERY = (Number(process.env.JIRA_SYNC_MINUTES) || 60) * 60 * 1000;
const JIRA_COMMENTS_EVERY = (Number(process.env.JIRA_COMMENTS_HOURS) || 12) * 3600 * 1000;
// Model zapytania o zgłoszenia Bug. Domyślnie ten sam co reszta: Haiku wyszedł w próbie drożej (0,16 $ wobec 0,05 $ za
// wywołanie, bo koszt to głównie stały kontekst sesji), więc zmiana jest tylko świadomym wyborem przez JIRA_BUG_MODEL.
const JIRA_BUG_MODEL = process.env.JIRA_BUG_MODEL || MODEL;
const JIRA_STATE_FILE = path.join(DATA_DIR, 'jira-sync.json');
const jira = { state: 'idle', lastTry: 0, lastOk: 0, lastComments: 0, lastCost: 0, added: 0, found: 0, error: '' };
try { Object.assign(jira, JSON.parse(fs.readFileSync(JIRA_STATE_FILE, 'utf8')), { state: 'idle' }); } catch (_) { /* pierwszy start */ }
// Stan sprzed osobnego znacznika skanu komentarzy: traktujemy ostatni udany import jako skan, żeby nie ruszać pełnego skanu bez potrzeby.
if (!jira.lastComments && jira.lastOk) jira.lastComments = jira.lastOk;
const JIRA_SEV = { highest: 'krytyczny', blocker: 'krytyczny', critical: 'krytyczny', high: 'wazny', medium: 'wazny', low: 'drobny', lowest: 'drobny' };

function jiraBugsPrompt(sinceDay) {
  const jql = `project in (${Object.keys(JIRA_PROJECTS).join(', ')}) AND issuetype = Bug${sinceDay ? ` AND created >= "${sinceDay}"` : ''} ORDER BY created DESC`;
  return `Pobierz z Jiry listę błędów. Tylko odczyt, bez żadnych innych działań.
1. Wywołaj getAccessibleAtlassianResources i weź cloudId.
2. Wywołaj searchJiraIssuesUsingJql z cloudId, jql: ${jql}, maxResults: 100, view: "evidence", fields: ["summary","status","priority","parent","created"]. Gdy isLast=false, pobieraj kolejne strony przez nextPageToken, aż do końca.
3. Odpowiedz WYŁĄCZNIE tablicą JSON (bez tekstu przed i po, bez bloku kodu), po jednym obiekcie na zgłoszenie:
{"key":"SVC-329","summary":"<summary dokładnie jak w Jirze>","priority":"<nazwa priorytetu lub pusty>","status":"<nazwa statusu>","parent":"<klucz parenta lub pusty>","parentSummary":"<summary parenta lub pusty>","created":"<created dokładnie jak w Jirze>"}
Brak wyników = []. Niczego nie dopisuj i nie zmieniaj.`;
}

const JIRA_TOOLS = [
  'mcp__claude_ai_Atlassian_MCP__searchJiraIssuesUsingJql',
  'mcp__claude_ai_Atlassian_MCP__getJiraIssue',
  'mcp__claude_ai_Atlassian_MCP__getAccessibleAtlassianResources',
];

/** Jeden tylko-odczytowy przebieg `claude -p` z narzędziami Jiry; zwraca tablicę JSON z odpowiedzi (raw: sam tekst). */
function jiraAsk(prompt, timeoutMs, model = MODEL, raw = false) {
  return new Promise((resolve, reject) => {
    const dir = path.join(RUNS_DIR, 'work'); fs.mkdirSync(dir, { recursive: true });
    const args = ['-p', '--model', model, '--output-format', 'json', '--tools', 'ToolSearch', '--permission-mode', 'dontAsk',
      '--allowedTools', ...JIRA_TOOLS, '--no-session-persistence'];
    const proc = spawn('claude', args, { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '', err = '', done = false;
    const end = (fn, v) => { if (done) return; done = true; clearTimeout(timer); fn(v); };
    const timer = setTimeout(() => { proc.kill(); end(reject, new Error('Jira sync timed out')); }, timeoutMs);
    proc.stdout.on('data', (c) => { out += c; });
    proc.stderr.on('data', (c) => { err += c; });
    proc.on('error', (e) => end(reject, new Error('Could not start claude: ' + e.message)));
    proc.on('close', (code) => {
      let j = null;
      try { j = JSON.parse(out.trim().split('\n').filter(Boolean).pop()); } catch (_) { /* nie JSON */ }
      if (j && j.total_cost_usd) jira.lastCost += j.total_cost_usd;
      if (!j || j.is_error || typeof j.result !== 'string') return end(reject, new Error((j && j.result) || err.trim().slice(-300) || `claude exited with code ${code}`));
      if (raw) return end(resolve, j.result);
      const a = j.result.indexOf('['), z = j.result.lastIndexOf(']');
      let list; try { list = JSON.parse(j.result.slice(a, z + 1)); } catch (_) {
        try { fs.writeFileSync(path.join(DATA_DIR, 'jira-sync.last.txt'), j.result); } catch (__) { /* diagnostyka */ }
        return end(reject, new Error('Jira answer was not valid JSON'));
      }
      if (!Array.isArray(list)) return end(reject, new Error('Jira answer was not a list'));
      end(resolve, list);
    });
    proc.stdin.on('error', () => {});
    proc.stdin.end(prompt);
  });
}
// Konektor Atlassian bywa jeszcze "w trakcie łączenia", gdy sesja już ruszyła; wtedy model odpowiada prozą zamiast JSON-em.
// Jedna ponowna próba po chwili kosztuje mniej niż błąd widoczny w UI i ręczne odświeżanie.
async function jiraRetry(fn) {
  try { return await fn(); } catch (e) {
    if (!/not valid JSON/.test(String(e && e.message))) throw e;
    await new Promise((r) => setTimeout(r, 10000));
    return fn();
  }
}
const jiraFetchBugs = (sinceDay) => jiraRetry(() => jiraAsk(jiraBugsPrompt(sinceDay), 180000, JIRA_BUG_MODEL));

// Treść ticketów dla QA MCP. Agent QA MCP działa z --strict-mcp-config (tylko serwer `qa`), a to odcina konektor
// Atlassian, więc sam Jiry nie przeczyta. Dlatego aplikacja pobiera opis i komentarze przed startem i wkleja je do
// zlecenia. Zakres grup narzędzi liczy się potem z tej treści, a nie z samego "zrób test z komentarza 3 w PRJ-508".
const JIRA_TEXT_END = '=== KONIEC ===';
function jiraIssueTextPrompt(keys) {
  return `Pobierz z Jiry pełną treść zadań: ${keys.join(', ')}. Tylko odczyt, bez żadnych innych działań.
1. Wywołaj getAccessibleAtlassianResources i weź cloudId.
2. Dla każdego klucza wywołaj getJiraIssue z cloudId, issueIdOrKey, view: "evidence", responseContentFormat: "markdown".
   Gdy liczba komentarzy (total) jest większa niż zwrócona, dociągnij resztę przez expand albo kolejne wywołanie.
3. Odpowiedz WYŁĄCZNIE tym formatem, dla każdego zadania po kolei:
## <KLUCZ> — <summary>
Status: <status> | Typ: <typ> | Podzadania: <klucz: summary; ...  albo brak>
### Opis
<opis DOSŁOWNIE>
### Komentarze (<liczba>)
#### Komentarz 1 — <autor>, <data utworzenia>
<treść DOSŁOWNIE>
#### Komentarz 2 — ...
Na końcu linia: ${JIRA_TEXT_END}
Zadanie, którego nie ma albo nie da się odczytać: "## <KLUCZ> — NIE ZNALEZIONO: <komunikat błędu>".
Nie streszczaj, nie skracaj, nie poprawiaj i nie interpretuj treści. Obrazy i wideo zastąp znacznikiem [załącznik].`;
}
/** Opis i komentarze ticketów jako tekst (markdown). Rzuca błąd, gdy odpowiedź jest niepełna. */
async function jiraIssueText(keys) {
  // Jira connected under Sources: read it directly through the REST API, which is faster and exact.
  const src = require('./sources');
  if (src.status().jira) return src.jiraIssueText(keys);
  const text = await jiraAsk(jiraIssueTextPrompt(keys), 240000, MODEL, true);
  const i = text.lastIndexOf(JIRA_TEXT_END);
  if (i < 0 || !/^## /m.test(text)) throw new Error('Jira answer was incomplete');
  return text.slice(text.search(/^## /m), i).trim();
}

// Podgląd pojedynczego zadania "na klik" z zakładki monitoringu (np. lista zadań wydania) — ten sam
// jiraIssueText, ale z krótkim cache w pamięci, żeby ponowne otwarcie tego samego ticketu w tej samej
// sesji nie płaciło za kolejny przebieg `claude -p`.
const issueTextCache = new Map(); // key -> { text, fetchedAt }
const ISSUE_TEXT_TTL = 10 * 60 * 1000;
async function issueTextCached(key) {
  const hit = issueTextCache.get(key);
  if (hit && Date.now() - hit.fetchedAt < ISSUE_TEXT_TTL) return hit.text;
  const text = await jiraIssueText([key]);
  issueTextCache.set(key, { text, fetchedAt: Date.now() });
  return text;
}

// Bugi opisane w komentarzach zadań (Story/Task), nie jako osobne zgłoszenia typu Bug. Tester oznacza je
// czerwonym panelem (w HTML: data-type="panel-error"); zielony panel to zachowanie zaakceptowane, nie błąd.
function jiraCommentBugsPrompt(sinceDay) {
  const projects = Object.keys(JIRA_PROJECTS).join(', ');
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const svc = Object.entries(JIRA_PROJECTS).map(([proj, key]) => {
    let list = []; try { list = AGENTS[key] ? servicesFor(key) : []; } catch (_) { /* brak katalogu */ }
    return `${proj}: ${list.join(', ') || '(brak listy)'}`;
  }).join('\n');
  return `Pobierz z Jiry błędy opisane w komentarzach zadań. Tylko odczyt, bez żadnych innych działań.
1. Wywołaj getAccessibleAtlassianResources i weź cloudId.
2. Wywołaj searchJiraIssuesUsingJql z cloudId, jql: project in (${projects}) AND issuetype != Bug AND issuetype not in subTaskIssueTypes() AND (assignee = currentUser() OR watcher = currentUser()) AND ${sinceDay ? `updated >= "${sinceDay}"` : `(statusCategory != Done OR updated >= "${day(14)}")`} ORDER BY updated DESC, maxResults: 50, fields: ["summary"]. Gdy isLast=false, pobieraj kolejne strony.
3. Dla KAŻDEGO zwróconego zadania wywołaj getJiraIssue z cloudId, issueIdOrKey, fields: ["summary","comment"] i responseContentFormat: "html" (HTML jest konieczny, bo kolor panelu jest tylko w nim). Nie pomijaj żadnego zadania.
4. W treści każdego komentarza szukaj elementów <div data-type="panel-error"> — każdy to zgłoszony błąd. Panele data-type="panel-success", "info", "note" i "warning" oraz zwykły tekst poza czerwonym panelem NIE są błędami: pomiń je.
   - Jeden błąd = jedna pozycja numerowana wewnątrz czerwonego panelu. Numer weź z tekstu pozycji (np. "3.1") albo z atrybutu start listy <ol start="8"> (pierwsza pozycja takiej listy ma ten numer, kolejne rosną). Pozycja bez numeru dostaje "c1", "c2"… w kolejności w komentarzu.
   - Jeśli numer się powtarza w kilku panelach, to nadal jedna pozycja na element, z tym samym numerem.
   - title: jedno zdanie (do 200 znaków) mówiące, co jest zepsute, w języku oryginału, wierne treści pozycji. Nie dodawaj faktów, których tam nie ma.
   - notes: pełny tekst pozycji bez znaczników HTML, słowo w słowo (zachowaj kroki, numery kont, wartości, nazwy parametrów, przejścia do wiersza), a na końcu linia "Media: " z nazwami plików (atrybut data-alt) z bezpośrednio następującego bloku <details>, jeśli taki jest.
   - service: dokładnie jedna nazwa z listy poniżej dla projektu zadania, jeśli treść jednoznacznie wskazuje serwis (np. hedger → core-hedger); w przeciwnym razie "nieustalony". Nie wymyślaj nazw spoza listy.
Serwisy:
${svc}
5. Odpowiedz WYŁĄCZNIE tablicą JSON (bez tekstu przed i po, bez bloku kodu), po jednym obiekcie na błąd:
{"task":"PRJ-524","taskSummary":"<summary zadania>","commentId":"268497","num":"3.1","created":"<created komentarza dokładnie jak w Jirze>","title":"...","notes":"...","service":"..."}
Brak błędów = []. Niczego nie zmyślaj.`;
}
const jiraFetchCommentBugs = (sinceDay) => jiraRetry(() => jiraAsk(jiraCommentBugsPrompt(sinceDay), 420000));

/** Dopisuje do rejestru bugi, których jeszcze w nim nie ma (klucz Jiry w `source`). Zwraca liczbę dodanych. */
function mergeJiraBugs(list) {
  syncBugs();
  const have = new Set(bugs.map((b) => b.source).filter(Boolean));
  const fresh = [];
  let fixed = 0;
  for (const it of list) {
    const key = String((it && it.key) || '').toUpperCase();
    const proj = key.split('-')[0];
    if (!/^[A-Z]+-\d+$/.test(key) || !JIRA_PROJECTS[proj] || !AGENTS[JIRA_PROJECTS[proj]]) continue;
    const source = 'jira:' + key;
    if (have.has(source)) {
      // Wpis zaimportowany wcześniej bez serwisu (parent nie był jeszcze znany) — uzupełnij, nie dubluj.
      const old = bugs.find((b) => b.source === source);
      const svc = String(it.parentSummary || '').trim().slice(0, 80);
      if (old && old.service === 'nieustalony' && svc) {
        old.service = svc;
        if (it.parent) old.notes = old.notes.slice(0, -2) + ', parent: ' + String(it.parent).toUpperCase() + ').';
        fixed++;
      }
      continue;
    }
    have.add(source);
    const created = Date.parse(it.created);
    const parent = String(it.parent || '').toUpperCase();
    fresh.push({
      id: crypto.randomBytes(6).toString('hex'),
      agent: JIRA_PROJECTS[proj], label: AGENTS[JIRA_PROJECTS[proj]].label,
      service: String(it.parentSummary || '').trim().slice(0, 80) || 'nieustalony',
      title: String(it.summary || key).trim().slice(0, 1000),
      ticket: key,
      severity: JIRA_SEV[String(it.priority || '').toLowerCase()] || 'wazny',
      source,
      notes: `Imported from Jira ${key} (status: ${it.status || 'n/a'}, priority: ${it.priority || 'n/a'}${parent ? ', parent: ' + parent : ''}).`,
      createdAt: Number.isFinite(created) ? created : Date.now(),
    });
  }
  if (!fresh.length) { if (fixed) saveBugs(); return 0; }
  // Rejestr trzymany jest od najnowszego — nowe wpisy wchodzą na miejsca wynikające z daty zgłoszenia w Jirze.
  bugs = [...fresh, ...bugs].sort((a, b) => b.createdAt - a.createdAt);
  saveBugs();
  return fresh.length;
}

/** Dopisuje bugi z komentarzy zadań (klucz: jira:ZADANIE#komentarz-numer w `source`). Zwraca liczbę dodanych. */
function mergeJiraCommentBugs(list) {
  syncBugs();
  const have = new Set(bugs.map((b) => b.source).filter(Boolean));
  const fresh = [];
  for (const it of list) {
    const task = String((it && it.task) || '').toUpperCase();
    const proj = task.split('-')[0];
    const cid = String((it && it.commentId) || '').trim();
    const num = String((it && it.num) || '').trim();
    const title = String((it && it.title) || '').trim();
    if (!/^[A-Z]+-\d+$/.test(task) || !JIRA_PROJECTS[proj] || !AGENTS[JIRA_PROJECTS[proj]]) continue;
    if (!/^\d+$/.test(cid) || !/^[\w.]{1,12}$/.test(num) || title.length < 5) continue;
    const source = `jira:${task}#${cid}-${num}`;
    if (have.has(source)) continue;
    // Zadanie, którego błędy ktoś już zapisał ręcznie (np. po analizie), pomijamy: tytuły różnią się
    // brzmieniem, więc automat nie odróżni duplikatu od nowego błędu, a dublet zawyża statystyki ryzyka.
    if (bugs.some((b) => b.ticket === task && !String(b.source || '').startsWith('jira:'))) continue;
    have.add(source);
    const agent = JIRA_PROJECTS[proj];
    const known = (() => { try { return servicesFor(agent); } catch (_) { return []; } })();
    const svc = known.includes(it.service) ? it.service : 'nieustalony';
    const created = Date.parse(it.created);
    const link = `https://your-org.atlassian.net/browse/${task}?focusedCommentId=${cid}`;
    const head = `Reported in ${task}${it.taskSummary ? ' (' + String(it.taskSummary).slice(0, 120) + ')' : ''}, item #${num}. ${link}\n\n`;
    fresh.push({
      id: crypto.randomBytes(6).toString('hex'),
      agent, label: AGENTS[agent].label, service: svc,
      title: title.slice(0, 1000),
      ticket: task,
      severity: 'wazny', // komentarz nie niesie wagi — nie zgadujemy; poprawia się ją w rejestrze
      source,
      notes: (head + String(it.notes || '')).slice(0, 3900),
      createdAt: Number.isFinite(created) ? created : Date.now(),
    });
  }
  if (!fresh.length) return 0;
  bugs = [...fresh, ...bugs].sort((a, b) => b.createdAt - a.createdAt);
  saveBugs();
  return fresh.length;
}

/** `full`: pełna reinicjalizacja — ignoruje znaczniki ostatniego importu i pobiera wszystko od początku (deduplikacja nadal chroni przed dublami, nic nie jest kasowane). */
function jiraSync(force, full) {
  if (jira.state === 'running') return;
  if (!force && Date.now() - jira.lastTry < JIRA_SYNC_EVERY) return;
  jira.state = 'running'; jira.lastTry = Date.now(); jira.error = ''; jira.lastCost = 0;
  // Pierwszy import bierze wszystko; kolejne tylko ostatnie dni (z zapasem), resztę i tak odsiewa deduplikacja.
  const since = jira.lastOk && !full ? new Date(jira.lastOk - 3 * 86400000).toISOString().slice(0, 10) : '';
  (async () => {
    // Dwa źródła; awaria jednego nie przekreśla drugiego.
    let added = 0, found = 0; const errs = [];
    try { const l = await jiraFetchBugs(since); found += l.length; added += mergeJiraBugs(l); } catch (e) { errs.push('Bug issues: ' + (e.message || e)); }
    // Komentarze: tylko zadania zmienione od ostatniego udanego skanu (z dobą zapasu); wpisy już znane odsiewa deduplikacja.
    if (force || Date.now() - jira.lastComments >= JIRA_COMMENTS_EVERY) {
      const sinceC = jira.lastComments && !full ? new Date(jira.lastComments - 86400000).toISOString().slice(0, 10) : '';
      const startedC = Date.now();
      try { const l = await jiraFetchCommentBugs(sinceC); found += l.length; added += mergeJiraCommentBugs(l); jira.lastComments = startedC; } catch (e) { errs.push('Task comments: ' + (e.message || e)); }
    }
    jira.found = found; jira.added = added;
    jira.error = errs.join(' | ').slice(0, 300);
    if (errs.length < 2) jira.lastOk = Date.now();
  })().catch((e) => { jira.error = String(e.message || e).slice(0, 300); }).finally(() => {
    jira.state = 'idle';
    try { fs.writeFileSync(JIRA_STATE_FILE, JSON.stringify({ lastTry: jira.lastTry, lastOk: jira.lastOk, lastComments: jira.lastComments, lastCost: Number(jira.lastCost.toFixed(4)), added: jira.added, found: jira.found, error: jira.error })); } catch (_) { /* nieistotne */ }
  });
}

module.exports = {
  SEVERITIES,
  jira,
  jiraAsk,
  jiraIssueText,
  issueTextCached,
  jiraRetry,
  jiraSync,
  saveBugs,
  syncBugs,
  get bugs() { return bugs; },
};
