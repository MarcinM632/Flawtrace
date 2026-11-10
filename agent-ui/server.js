// Lokalny UI do zlecania analiz agentom QA (claudeAgent / claudeAgentB / claudeAgentMcp).
// Zero zależności: node server.js  ->  http://localhost:4317
// Ten plik to tylko router HTTP; logika siedzi w lib/.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { body, json, jsonEtag, serveStatic } = require('./lib/http');
const { AGENTS, agentAvailable, agentDir, agentReason, servicesFor } = require('./lib/agents');
const sources = require('./lib/sources');
const { AGENTS_ROOT, AGENT_DIRS, AUTOTEST_REPO, HOST, MODEL, PORT, ROOT, RUNS_DIR, TICKET_KEY } = require('./lib/config');
const { chatBatteries, chatCases, parseReport } = require('./lib/report-format');
const { PE_TARGETS, autotestsFromRun, bgJobs, claudeOnce, parsePE, peBusyRuns, peRun, peSystem, startJob, stripTag, unknownToolsIn } = require('./lib/pe');
const { SEVERITIES, jira, jiraSync, saveBugs, syncBugs } = require('./lib/bugs');
const { loadAll, runs } = require('./lib/store');
const environment = require('./lib/environment');
const { pruneWork, pushToNext, startRun } = require('./lib/run-agent');
const runSummaryLib = require('./lib/run-summary');
const { cancelSuiteRun, listSuite, startSuiteRun, suite, suiteFileOk, suiteSummary } = require('./lib/suite');
const { collectCheck, discardStaged, saveStaged } = require('./lib/autotest-repo');
const toolsLib = require('./lib/tools');
const bugsLib = require('./lib/bugs');
const suiteLib = require('./lib/suite');
const testMonitor = require('./lib/test-monitor');
const metricsLib = require('./lib/metrics');
const workspace = require('./lib/workspace');
const releaseWatch = require('./lib/release-watch');
releaseWatch.start(); // co godzinę: nowe taski w bieżącym wydaniu -> auto static test + powiadomienie w UI
const coverage = require('./lib/coverage');
coverage.start(); // nowy komentarz na tasku z Workspace -> diff z GitLaba serwisu vs wykonane testy -> % pokrycia
const defectLifecycle = require('./lib/defect-lifecycle');

/** What the app has loaded from Jira so far, per page, for the Jira data check in Sources. */
function jiraLoaded() {
  const ws = workspace.state;
  const bugsFromJira = bugsLib.bugs.filter((b) => String(b.source || '').startsWith('jira:')).length;
  return {
    rest: sources.status().jira,
    workspace: { count: ws.tasks.length, fetchedAt: ws.fetchedAt, ok: ws.ok, error: ws.error, busy: ws.busy },
    releases: testMonitor.all().map((p) => ({
      jiraKey: p.jiraKey, product: p.label, fetchedAt: p.releaseFetchedAt, ok: p.releaseOk, error: p.releaseError, busy: p.releaseRefreshing,
      versions: p.releases.map((r) => ({ name: r.name, count: r.metrics.total })), current: p.currentReleaseName,
    })),
    bugs: { count: bugsFromJira, fetchedAt: jira.lastOk, ok: !jira.error, error: jira.error, busy: jira.state === 'running' },
    defects: { count: defectLifecycle.state.issues.length, fetchedAt: defectLifecycle.state.fetchedAt, ok: defectLifecycle.state.ok, error: defectLifecycle.state.error, busy: defectLifecycle.state.busy },
  };
}

// "Co robić teraz" dla jednego tasku — bez LLM, tylko z już policzonych danych (activityFor/coverage/
// guidanceFor). Współdzielone między /api/workspace/advise (cała lista) i /api/workspace/report/:key (jeden task na klik).
function reportForTask(t) {
  const act = workspace.activityFor(t.key);
  const staticRuns = act.runs.filter((r) => ['core', 'svc', 'mcp'].includes(r.agent));
  const designRuns = act.runs.filter((r) => r.agent === 'design');
  const lastOf = (list) => list.length ? list[list.length - 1] : null;
  const lastStatic = lastOf(staticRuns), lastDesign = lastOf(designRuns);
  const cov = coverage.forCheck(t.key);
  const g = workspace.guidanceFor(t.key);
  const autotestMatches = g ? g.autotestMatches.length : 0;
  const missing = [];
  if (!lastStatic || lastStatic.status !== 'done') missing.push('Static test (CORE/SVC/mcp quick check) not done');
  if (!lastDesign || lastDesign.status !== 'done') missing.push('Test design (Phase 4) not done');
  if (!cov || cov.ok == null) missing.push('Coverage not checked yet');
  else if (cov.error) missing.push('Coverage check failed: ' + cov.error);
  else if (cov.percent != null && (cov.gaps || []).length) missing.push(`Coverage gaps: ${cov.gaps.length}`);
  if (!autotestMatches) missing.push('No matching autotest file found');
  return {
    key: t.key, summary: t.summary, status: t.status, priority: t.priority, service: t.service, label: t.label,
    stage: act.stage,
    staticTest: { done: !!lastStatic && lastStatic.status === 'done', status: lastStatic ? (lastStatic.reportStatus || lastStatic.status) : null, runId: lastStatic ? lastStatic.id : null, agent: lastStatic ? lastStatic.agent : null },
    testDesign: { done: !!lastDesign && lastDesign.status === 'done', status: lastDesign ? (lastDesign.reportStatus || lastDesign.status) : null, runId: lastDesign ? lastDesign.id : null },
    coverage: cov, autotestMatches, missing,
  };
}
const runChatCache = new Map(); // run id -> { stamp, report, data }: wyniki czatu MCP w widoku runu

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  let m;
  try {
    // Restart the Node process itself — picks up a code change in server.js/lib/*.js, which (unlike
    // public/ static files) is only ever read once, at process start.
    if (req.method === 'POST' && p === '/api/admin/restart') { restartServer(res); return; }
    if (req.method === 'GET' && p === '/api/agents') {
      return json(res, 200, Object.entries(AGENTS).map(([key, a]) => ({
        key, label: a.label, hint: a.hint, mode: a.mode || 'qa', freeform: !!a.freeform,
        services: ['design', 'planning', 'analysis', 'implementation', 'completion'].includes(a.mode) ? [] : servicesFor(key),
        // Gdzie agent jest oczekiwany i gdzie szukamy wszystkich — bez tego UI może tylko
        // powiedzieć "niedostępny", a tester nie wie, którego katalogu brakuje.
        dir: agentDir(a),
        agentsRoot: AGENTS_ROOT,
        // QA MCP nie czyta repozytoriów, więc nie ma CLAUDE.md — jego warunkiem jest serwer MCP.
        available: agentAvailable(a),
        reason: agentReason(a),
      })));
    }
    // Przełącznik środowiska (przycisk w UI): GET stan, POST zmiana. Zawsze startuje na test-env przy
    // uruchomieniu apki (stan tylko w pamięci) — eks-test-env trzeba wybrać jawnie w każdej sesji.
    if (req.method === 'GET' && p === '/api/environment') {
      return json(res, 200, { current: environment.get(), profiles: environment.list() });
    }
    if (req.method === 'POST' && p === '/api/environment') {
      const b = await body(req);
      try {
        environment.set(String(b.key || ''));
        return json(res, 200, { current: environment.get(), profiles: environment.list() });
      } catch (e) { return json(res, e.code || 500, { error: e.message }); }
    }
    // Podpowiedzi dla zakładki Autotests: obszary i liczba plików testów osobno dla pytest (tests/*) i Playwright (tests/ui/*).
    if (req.method === 'GET' && p === '/api/autotest-meta') {
      const out = { repo: AUTOTEST_REPO, available: false, folders: [], tests: 0, ui: { folders: [], tests: 0 } };
      const testsDir = path.join(AUTOTEST_REPO, 'tests');
      const areas = (dir) => fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('__'))
        .map((e) => e.name).sort();
      const count = (dir) => fs.readdirSync(dir).filter((f) => f.startsWith('test_') && f.endsWith('.py')).length;
      try {
        out.available = fs.existsSync(path.join(AUTOTEST_REPO, 'README.md'));
        out.folders = areas(testsDir).filter((f) => f !== 'ui');
        for (const folder of out.folders) out.tests += count(path.join(testsDir, folder));
        if (fs.existsSync(path.join(testsDir, 'ui'))) {
          out.ui.folders = areas(path.join(testsDir, 'ui')).map((f) => 'ui/' + f);
          for (const folder of out.ui.folders) out.ui.tests += count(path.join(testsDir, folder));
        }
      } catch (_) { /* brak repo albo pusty tests/ — UI to pokaże */ }
      return json(res, 200, out);
    }
    if (req.method === 'POST' && p === '/api/prompt-engineer') {
      const b = await body(req);
      if (!PE_TARGETS.includes(b.target)) return json(res, 400, { error: 'Unknown target' });
      const text = String(b.text || '').trim();
      if (text.length < 10) return json(res, 400, { error: 'Enter the text to rewrite (at least a few words)' });
      if (text.length > 8000) return json(res, 400, { error: 'Text too long (max 8000 characters)' });
      if (b.target === 'agent' && !(AGENTS[b.app] && !AGENTS[b.app].mode)) return json(res, 400, { error: 'Pick an analysis agent' });
      let system;
      try { system = peSystem(b.target, b.app); } catch (e) { return json(res, 500, { error: e.message }); }
      const t0 = Date.now();
      try {
        const r = await claudeOnce(system, `<tester_text>\n${text}\n</tester_text>`);
        const parsed = parsePE(r.text);
        const ok = b.target === 'qamcp' ? !!parsed.prompt : !!parsed.ticket && !!parsed.context;
        // Każda nazwa narzędzia w wyniku musi istnieć w katalogu — zmyślona nazwa to błąd, o którym tester ma wiedzieć.
        const unknownTools = b.target === 'qamcp' && parsed.prompt ? unknownToolsIn(parsed.prompt) : [];
        return json(res, 200, { target: b.target, ...parsed, unknownTools, parsed: ok, raw: r.text, costUsd: r.costUsd, model: MODEL, seconds: Math.round((Date.now() - t0) / 1000) });
      } catch (e) { return json(res, 502, { error: e.message }); }
    }
    // Workspace: zadania przypisane do mnie w Jirze, w kolejności testowania (priorytet, potem ryzyko serwisu).
    if (req.method === 'GET' && p === '/api/workspace') {
      workspace.refresh(false).catch(() => {});
      const tasks = workspace.ranked().map((t) => ({ ...t, coverage: coverage.forCheck(t.key) }));
      return json(res, 200, { tasks, fetchedAt: workspace.state.fetchedAt, ok: workspace.state.ok, error: workspace.state.error, busy: workspace.state.busy });
    }
    if (req.method === 'POST' && p === '/api/workspace/sync') {
      workspace.refresh(true).catch(() => {});
      return json(res, 202, { busy: true });
    }
    if ((m = p.match(/^\/api\/workspace\/guidance\/([A-Z0-9]+-\d+)$/i)) && req.method === 'GET') {
      const g = workspace.guidanceFor(m[1].toUpperCase());
      return g ? json(res, 200, g) : json(res, 404, { error: 'Unknown task — refresh Workspace first' });
    }
    // "W którym momencie jest" — historia runów tej appki dla ticketu + najdalsza faza Test Flow.
    if ((m = p.match(/^\/api\/workspace\/activity\/([A-Z0-9]+-\d+)$/i)) && req.method === 'GET') {
      return json(res, 200, workspace.activityFor(m[1].toUpperCase()));
    }
    // "Co robić teraz" — jeden przebieg claude -p bez narzędzi nad już policzonymi danymi (kolejność
    // Workspace, coverage, dopasowane autotesty, nieprzejrzane testy statyczne z release-watch).
    // Na żądanie (przycisk), nie w tle — to pytanie zadaje człowiek, nie automat.
    // Policzone, nie oceniane: każdy fakt (etap, czy był test statyczny/design, coverage, dopasowane
    // autotesty) już mamy dokładnie z activityFor/coverage/guidanceFor — zero zgadywania przez model,
    // zero kosztu, krótki i czytelny krok-po-kroku per task. Kolejność to już wyliczony ranking
    // (priorytet Jiry, potem ryzyko serwisu) — pierwszy na liście jest tym, co robić najpierw.
    if (req.method === 'POST' && p === '/api/workspace/advise') {
      try {
        await workspace.refresh(false).catch(() => {});
        const tasks = workspace.ranked().slice(0, 10).map(reportForTask);
        const pending = releaseWatch.list().filter((n) => !n.read).slice(0, 10)
          .map((n) => ({ key: n.key, project: n.project, version: n.version, summary: n.summary, runId: n.runId, agent: n.agent }));
        return json(res, 200, { tasks, pending, computedAt: Date.now() });
      } catch (e) { return json(res, 500, { error: String((e && e.message) || e) }); }
    }
    // Ten sam raport co /advise, dla JEDNEGO tasku — klik w Workspace -> od razu "co robić" bez czekania
    // na przycisk "Build report" nad całą listą. Zero LLM, też z activityFor/coverage/guidanceFor.
    if ((m = p.match(/^\/api\/workspace\/report\/([A-Z0-9]+-\d+)$/i)) && req.method === 'GET') {
      const key = m[1].toUpperCase();
      const t = workspace.ranked().find((x) => x.key === key);
      if (!t) return json(res, 404, { error: 'Unknown task — refresh Workspace first' });
      return json(res, 200, reportForTask(t));
    }
    // Coverage: diff z repo serwisu (od daty ticketu) vs wykonane testy (historia runów), % pokrycia logiki biznesowej.
    // Liczy się automatycznie na nowy komentarz (lib/coverage.js); ten endpoint tylko czyta ostatni wynik / wymusza nowy.
    if ((m = p.match(/^\/api\/coverage\/([A-Z0-9]+-\d+)$/i)) && req.method === 'GET') {
      return json(res, 200, coverage.forCheck(m[1]) || { key: m[1].toUpperCase(), ok: null });
    }
    if ((m = p.match(/^\/api\/coverage\/([A-Z0-9]+-\d+)\/check$/i)) && req.method === 'POST') {
      try { return json(res, 202, coverage.forceCheck(m[1])); }
      catch (e) { return json(res, e.status || 500, { error: e.message }); }
    }
    // Test Flow — Phase 2 (Test Monitoring and Control): wydania (wersje Jiry) per projekt, odświeżane w tle.
    if (req.method === 'GET' && p === '/api/test-flow/monitor') return json(res, 200, { projects: testMonitor.all() });
    if ((m = p.match(/^\/api\/test-flow\/monitor\/([\w-]+)\/release\/refresh$/)) && req.method === 'POST') {
      if (!testMonitor.PROJECTS[m[1]]) return json(res, 404, { error: 'Unknown project' });
      testMonitor.refreshRelease(m[1]).catch(() => {});
      return json(res, 202, { ok: true });
    }
    // Powiadomienia: nowe taski wykryte w bieżącym wydaniu, z już uruchomionym testem statycznym (release-watch).
    if (req.method === 'GET' && p === '/api/release-watch') {
      return json(res, 200, { notifications: releaseWatch.list(), unread: releaseWatch.unreadCount() });
    }
    if (req.method === 'POST' && p === '/api/release-watch/ack') {
      releaseWatch.ackAll();
      return json(res, 200, { ok: true });
    }
    // Podgląd pełnej treści (opis + komentarze) pojedynczego zadania Jiry, na klik z listy zadań wydania.
    if ((m = p.match(/^\/api\/jira\/issue-text\/([A-Z0-9]+-\d+)$/i)) && req.method === 'GET') {
      try { return json(res, 200, { key: m[1], text: await bugsLib.issueTextCached(m[1]) }); }
      catch (e) { return json(res, 502, { error: e.message }); }
    }
    // Metrics generation: katalog (statystyki + dostępne apki/serwisy/wydania), zapisane wykresy, generowanie, usuwanie.
    if (req.method === 'GET' && p === '/api/metrics/catalog') {
      try { return json(res, 200, metricsLib.catalog()); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    if (req.method === 'GET' && p === '/api/metrics') return json(res, 200, { items: metricsLib.list() });
    if (req.method === 'POST' && p === '/api/metrics') {
      try {
        const b = await body(req);
        if (!b || !b.statKey) return json(res, 400, { error: 'Pick a statistic' });
        return json(res, 201, metricsLib.create(b.statKey, b.filters, b.title));
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if ((m = p.match(/^\/api\/metrics\/([0-9a-f]+)$/)) && req.method === 'GET') {
      const rec = metricsLib.get(m[1]);
      return rec ? json(res, 200, rec) : json(res, 404, { error: 'Not found' });
    }
    if ((m = p.match(/^\/api\/metrics\/([0-9a-f]+)$/)) && req.method === 'DELETE') {
      const ok = metricsLib.remove(m[1]);
      return json(res, ok ? 200 : 404, { ok });
    }
    // Econometric analysis: pick Y/X from the catalog's econGranularities, fit OLS, save as a gallery entry.
    if (req.method === 'POST' && p === '/api/metrics/econometrics') {
      try {
        const b = await body(req);
        return json(res, 201, metricsLib.createEconometric(b || {}));
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if ((m = p.match(/^\/api\/metrics\/([0-9a-f]+)\/ai$/)) && req.method === 'POST') {
      try { return json(res, 200, await metricsLib.aiInterpretEconometric(m[1])); }
      catch (e) { return json(res, 502, { error: e.message }); }
    }
    // Jira-backed defect lifecycle (created/resolutiondate for Bug issues) behind "Defects opened vs
    // closed" and "Defect resolution time" — same lazy-refresh-in-background pattern as Jira bug sync.
    if (req.method === 'POST' && p === '/api/metrics/defect-lifecycle/sync') {
      metricsLib.defectLifecycleRefresh(true).catch(() => {});
      return json(res, 202, { busy: true });
    }
    // Sources: Jira, Confluence, repositories, knowledge base and the API of the test environment.
    if (req.method === 'GET' && p === '/api/guide') {
      try { return json(res, 200, { text: fs.readFileSync(path.join(ROOT, 'GETTING_STARTED.md'), 'utf8') }); } catch (_) { return json(res, 404, { error: 'GETTING_STARTED.md not found' }); }
    }
    if (req.method === 'GET' && p === '/api/plat-status') {
      const c = sources.read(); const st = sources.status();
      return json(res, 200, { configured: st.api, environment: 'test', hosts: c.api.baseUrl ? [c.api.baseUrl] : [], endpoints: st.endpoints, readOnly: !!c.api.readOnly });
    }
    if (req.method === 'GET' && p === '/api/sources') return json(res, 200, sources.view());
    if (req.method === 'POST' && p === '/api/sources') {
      const b = await body(req, 1e6);
      if (!b || b.__tooLarge) return json(res, 400, { error: 'Invalid settings' });
      try { return json(res, 200, sources.save(b)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (req.method === 'POST' && p === '/api/sources/test') {
      try { return json(res, 200, await sources.test()); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    if (req.method === 'POST' && p === '/api/sources/repos/sync') {
      try { return json(res, 200, { results: await sources.syncRepos(), view: sources.view() }); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    if (req.method === 'POST' && p === '/api/sources/specs/upload') {
      const b = await body(req, 3e7);
      if (!b || b.__tooLarge) return json(res, 413, { error: 'The file is too large' });
      try { const r = sources.uploadSpec(b.name, b.text); await toolsLib.refresh(); return json(res, 200, r); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (req.method === 'GET' && p === '/api/sources/knowledge') return json(res, 200, sources.knowledgeFiles());
    // Jira data check: what Jira returns for each search the app uses, next to what the app has loaded so far.
    if (req.method === 'POST' && p === '/api/sources/jira/check') {
      const b = (await body(req, 1e4)) || {};
      try { return json(res, 200, { jira: await sources.jiraCheck({ person: b.person, key: b.key }), app: jiraLoaded() }); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (req.method === 'GET' && p === '/api/sources/jira/loaded') return json(res, 200, jiraLoaded());
    // Loads every Jira dataset of the app now instead of waiting for the next scheduled refresh.
    if (req.method === 'POST' && p === '/api/sources/jira/load') {
      if (!sources.status().jira) return json(res, 400, { error: 'Connect Jira first (step 2).' });
      workspace.refresh(true).catch(() => {});
      for (const k of Object.keys(testMonitor.PROJECTS)) testMonitor.refreshRelease(k).catch(() => {});
      jiraSync(true, false);
      defectLifecycle.refresh(true).catch(() => {});
      return json(res, 202, jiraLoaded());
    }
    // Zakładka Tools: katalog endpointów mcp-server po serwisach; rescan odświeża specyfikacje i porównuje wszystkie endpointy.
    if (req.method === 'GET' && p === '/api/tools') {
      try { return json(res, 200, await toolsLib.getTools()); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    if (req.method === 'POST' && p === '/api/tools/rescan') {
      try { return json(res, 200, await toolsLib.rescan()); } catch (e) { return json(res, e.code || 500, { error: e.message }); }
    }
    if (p === '/api/bugs' || p.startsWith('/api/bugs/')) syncBugs();
    if (req.method === 'POST' && p === '/api/bugs/jira-sync') {
      jiraSync(true, url.searchParams.get('full') === '1');
      return json(res, 202, { state: jira.state });
    }
    if (req.method === 'GET' && p === '/api/bugs') {
      jiraSync(false); // w tle; nowe wpisy widać przy kolejnym odczycie
      return json(res, 200, { bugs: bugsLib.bugs, severities: SEVERITIES, jira: { state: jira.state, lastOk: jira.lastOk, added: jira.added, error: jira.error } });
    }
    if (req.method === 'POST' && p === '/api/bugs') {
      const b = await body(req);
      if (!AGENTS[b.agent]) return json(res, 400, { error: 'Unknown app' });
      const service = String(b.service || '').trim();
      const title = String(b.title || '').trim();
      if (!service) return json(res, 400, { error: 'Service is required' });
      if (!title) return json(res, 400, { error: 'Bug description is required' });
      const bug = {
        id: crypto.randomBytes(6).toString('hex'),
        agent: b.agent, label: AGENTS[b.agent].label, service, title,
        ticket: String(b.ticket || '').trim().toUpperCase(),
        severity: SEVERITIES.includes(b.severity) ? b.severity : 'wazny',
        source: String(b.source || '').trim(), // np. id analizy, z której pochodzi
        notes: String(b.notes || '').slice(0, 4000),
        createdAt: Date.now(),
      };
      bugsLib.bugs.unshift(bug); saveBugs();
      return json(res, 201, bug);
    }
    // Sprostowanie wpisu (waga / notatki). Wpisu nie da się usunąć — to archiwum.
    if ((m = p.match(/^\/api\/bugs\/([\w-]+)$/)) && req.method === 'PATCH') {
      const i = bugsLib.bugs.findIndex((x) => x.id === m[1]);
      if (i < 0) return json(res, 404, { error: 'No such bug' });
      const b = await body(req);
      if (b.severity && SEVERITIES.includes(b.severity)) bugsLib.bugs[i].severity = b.severity;
      if (typeof b.service === 'string' && b.service.trim()) bugsLib.bugs[i].service = b.service.trim();
      if (typeof b.notes === 'string') bugsLib.bugs[i].notes = b.notes.slice(0, 4000);
      saveBugs();
      return json(res, 200, bugsLib.bugs[i]);
    }
    if (p.match(/^\/api\/bugs\/[\w-]+$/) && req.method === 'DELETE') {
      return json(res, 405, { error: 'The registry is an archive - entries are never deleted.' });
    }
    if (req.method === 'GET' && p === '/api/runs') {
      // Lista na liście wystarczy kilka pól; raport, tekst końcowy i poczekalnia testów są w /api/runs/:id. Pełne meta: ?full=1.
      const full = url.searchParams.get('full') === '1';
      const slim = (m) => ({ id: m.id, agent: m.agent, label: m.label, layer: m.layer, ticket: String(m.ticket).slice(0, 300), startedAt: m.startedAt, finishedAt: m.finishedAt, status: m.status, costUsd: m.costUsd, pushedTo: m.pushedTo || null });
      return jsonEtag(req, res, [...runs.values()].map((r) => (full ? r.meta : slim(r.meta))).sort((a, b) => b.startedAt - a.startedAt));
    }
    if (req.method === 'POST' && p === '/api/runs') {
      // Default body limit is 100 KB; dropped/pasted data files can push the body well past that
      // (client allows up to DATA_FILES_MAX_TOTAL combined, plus JSON-escaping overhead).
      const b = await body(req, 30 * 1024 * 1024);
      if (b.__tooLarge) return json(res, 413, { error: 'The attached files are too large for one run (over 20 MB combined). Remove one and try again.' });
      const a = AGENTS[b.agent];
      if (!a) return json(res, 400, { error: 'Unknown agent' });
      // Bez tego spawn dostawał cwd wskazujące na nieistniejący katalog i run padał dopiero
      // w logu procesu — a w UI wyglądał na uruchomiony.
      if (!agentAvailable(a)) {
        return json(res, 409, {
          error: `${a.label} cannot run: no CLAUDE.md in ${agentDir(a)}. `
            + `Set QA_AGENTS_ROOT to the folder holding claudeAgent*/ and restart the server.`,
        });
      }
      const raw = String(b.ticket || '').trim();
      // Sam klucz Jiry normalizujemy do wielkich liter ("prj-297"); dłuższy opis zostaje bez zmian.
      const ticket = TICKET_KEY.test(raw) ? raw.toUpperCase() : raw;
      if (!a.pattern.test(ticket)) {
        // Komunikat ma mówić, co jest nie tak z TYM polem: Autotests i QA MCP nie mają ticketów, a powodem
        // odrzucenia jest najczęściej długość wklejonego opisu.
        const n = ticket.length;
        const error = a.mode === 'autotest' || a.mode === 'qamcp' || a.mode === 'execution'
          ? (n < 10 ? 'Describe it in a few words (at least 10 characters).'
            : `The description is ${n} characters; the limit is 8000. Shorten it, or split it into separate runs.`)
          : a.freeform
          ? (n < 3 ? 'Enter a ticket key or a requirement (at least 3 characters).'
            : `The ticket / requirement line is ${n} characters; the limit is 300. Keep it to one sentence and put the detail in Additional context.`)
          : 'Invalid ticket key (expected format ABC-123)';
        return json(res, 400, { error });
      }
      if ([...runs.values()].some((r) => r.meta.status === 'running' && r.meta.agent === b.agent && r.meta.ticket === ticket)) return json(res, 409, { error: 'This analysis is already running' });
      const extra = {};
      if (a.mode === 'autotest') {
        extra.layer = b.layer === 'ui' ? 'ui' : 'api';
        extra.folder = String(b.folder || '').trim().replace(/[^\w/-]/g, '');
        // Testy UI żyją pod tests/ui/, testy API poza nim: zakładka pytest nie może pisać do tests/ui/ i odwrotnie.
        if (extra.folder && extra.layer === 'ui' && !/^ui(\/|$)/.test(extra.folder)) extra.folder = 'ui/' + extra.folder;
        if (extra.layer === 'api' && /^ui(\/|$)/.test(extra.folder)) return json(res, 400, { error: 'tests/ui/ holds Playwright tests. Pick another area, or switch to the Playwright tab.' });
      }
      if (a.mode === 'qamcp' || a.mode === 'execution') extra.scope = b.scope === 'all' ? 'all' : 'auto';
      // Data files dropped/pasted into the form (e.g. CSVs, or a PDF for Analyses/Autotests): data for the
      // prompt, never an instruction. As many as the tester likes, up to a combined size — startRun caps how
      // much of it actually gets inlined into the prompt text, independent of this transport limit. The client
      // sends raw bytes as base64 (not file.text()), so binary files decode back byte-for-byte instead of being
      // mangled as UTF-8 text.
      if (Array.isArray(b.dataFiles) && b.dataFiles.length) {
        const DATA_FILES_MAX_TOTAL = 20 * 1024 * 1024;
        let total = 0;
        const files = [];
        for (const f of b.dataFiles) {
          if (!f || typeof f.content !== 'string' || !f.content) continue;
          let buf;
          try { buf = Buffer.from(f.content, 'base64'); } catch (_) { continue; }
          if (!buf.length) continue;
          total += buf.length;
          if (total > DATA_FILES_MAX_TOTAL) return json(res, 400, { error: `The attached files exceed the ${DATA_FILES_MAX_TOTAL / 1024 / 1024} MB combined limit.` });
          files.push({ name: String(f.name || 'data.txt').slice(0, 200), buffer: buf, binary: !!f.binary });
        }
        if (files.length) extra.dataFiles = files;
      }
      return json(res, 201, startRun(b.agent, ticket, String(b.notes || '').slice(0, 2000), extra));
    }
    // ---- Test suite: lista testów z repo, uruchamianie wybranych, historia, edycja pliku ----
    if (req.method === 'GET' && p === '/api/suite') {
      const l = await listSuite();
      return json(res, 200, { ...l, last: suite.last, run: suiteSummary(suiteLib.suiteRun) });
    }
    if (req.method === 'POST' && p === '/api/suite/run') {
      const b = await body(req);
      try { const run = await startSuiteRun(b.targets); return json(res, 202, { id: run.id }); }
      catch (e) { return json(res, e.code || 500, { error: e.message }); }
    }
    if (req.method === 'POST' && p === '/api/suite/cancel') {
      try { cancelSuiteRun(); return json(res, 200, { ok: true }); } catch (e) { return json(res, e.code || 500, { error: e.message }); }
    }
    if (req.method === 'GET' && p === '/api/suite/run') {
      if (!suiteLib.suiteRun) return json(res, 200, { run: null });
      const { proc, ...rest } = suiteLib.suiteRun;
      return json(res, 200, { run: { ...rest, output: rest.output.slice(-12000) } });
    }
    if (req.method === 'GET' && p === '/api/suite/history') return json(res, 200, suite.runs.map(({ results, messages, output, ...s }) => s));
    if ((m = p.match(/^\/api\/suite\/history\/([\w-]+)$/)) && req.method === 'GET') {
      const h = suite.runs.find((x) => x.id === m[1]);
      return h ? json(res, 200, h) : json(res, 404, { error: 'Not found' });
    }
    if (p === '/api/suite/file') {
      const rel = url.searchParams.get('path') || '';
      if (req.method === 'GET') {
        if (!suiteFileOk(rel)) return json(res, 400, { error: 'Not a file in autotests/tests or autotests/utils' });
        try { return json(res, 200, { path: rel, content: fs.readFileSync(path.join(AUTOTEST_REPO, rel), 'utf8') }); }
        catch (_) { return json(res, 404, { error: 'No such file' }); }
      }
      if (req.method === 'PUT') {
        const b = await body(req);
        const file = String(b.path || '');
        if (!suiteFileOk(file) || typeof b.content !== 'string' || b.content.length > 90000) return json(res, 400, { error: 'Bad path or content' });
        const abs = path.join(AUTOTEST_REPO, file);
        if (!fs.existsSync(abs)) return json(res, 404, { error: 'No such file' });
        const backup = fs.readFileSync(abs, 'utf8');
        fs.writeFileSync(abs, b.content);
        // Plik trafia do repo tylko, gdy pytest nadal potrafi zebrać testy (składnia, importy, markery).
        const chk = await collectCheck([{ path: file.startsWith('tests/') ? file : 'tests/' }]);
        if (chk.ok === false) { fs.writeFileSync(abs, backup); return json(res, 422, { error: 'pytest cannot collect the tests with this change, so the file was not saved', detail: chk.detail || chk.summary }); }
        return json(res, 200, { ok: true, summary: chk.summary || '' });
      }
    }
    // Zatwierdzenie wyniku Autotests: pliki ze zweryfikowanego runu z poczekalni do prawdziwego autotests/.
    if ((m = p.match(/^\/api\/runs\/([\w-]+)\/autotests\/(save|discard)$/)) && req.method === 'POST') {
      const src = runs.get(m[1]); if (!src) return json(res, 404, { error: 'Not found' });
      try {
        if (m[2] === 'save') { const files = saveStaged(src); return json(res, 200, { ok: true, files }); }
        discardStaged(src); return json(res, 200, { ok: true });
      } catch (e) { return json(res, e.code || 500, { error: e.message }); }
    }
    // Przycisk w QA MCP: log danego runu -> proste autotesty w repo autotests/ (lokalnie, bez gita).
    if (req.method === 'GET' && p === '/api/jobs') return json(res, 200, [...bgJobs.values()]);
    if ((m = p.match(/^\/api\/runs\/([\w-]+)\/autotests$/)) && req.method === 'POST') {
      const src = runs.get(m[1]); if (!src) return json(res, 404, { error: 'Not found' });
      if (src.meta.agent !== 'qamcp' && src.meta.agent !== 'execution') return json(res, 400, { error: 'Only QA MCP or Test Flow Execution runs can be turned into autotests' });
      if (src.meta.status === 'running') return json(res, 409, { error: 'Wait until the run has finished' });
      if (!src.events.some((e) => e.type === 'endpoint')) return json(res, 400, { error: 'This run called no endpoints, so there is no flow to turn into tests' });
      const a = AGENTS.autotest;
      if (!agentAvailable(a)) return json(res, 409, { error: 'autotests/ was not found next to the app (no README.md in ' + a.absDir + ')' });
      if ([...runs.values()].some((r) => r.meta.status === 'running' && r.meta.agent === 'autotest' && r.meta.source === src.meta.id)) {
        return json(res, 409, { error: 'Autotests for this run are already being written' });
      }
      if (peBusyRuns.has(src.meta.id)) return json(res, 409, { error: 'The prompt for this run is already being prepared' });
      const b = await body(req);
      const comment = String(b.comment || '').slice(0, 2000);
      const layer = b.layer === 'ui' ? 'ui' : 'api';
      // Prompt engineer trwa dziesiątki sekund, więc praca idzie w tle; UI dopytuje o /api/jobs i nie musi
      // trzymać otwartego żądania (ani zakładki), żeby wynik nie przepadł.
      peBusyRuns.add(src.meta.id);
      return json(res, 202, startJob('autotests', src.meta.id, async () => {
        try { return { runId: (await autotestsFromRun(src, comment, layer)).id }; }
        finally { peBusyRuns.delete(src.meta.id); }
      }));
    }
    // Przycisk w Analyses: wynik analizy (raport agenta albo projekt testów) -> proces dla QA MCP, który ma ten błąd
    // odtworzyć na środowisku. Niczego nie uruchamia: UI wkłada wynik do pola procesu w zakładce QA MCP.
    if ((m = p.match(/^\/api\/runs\/([\w-]+)\/replicate$/)) && req.method === 'POST') {
      const src = runs.get(m[1]); if (!src) return json(res, 404, { error: 'Not found' });
      const a = AGENTS[src.meta.agent];
      if (!a || a.absDir) return json(res, 400, { error: 'Only an analysis or a test design result can be turned into a QA MCP process' });
      if (src.meta.status === 'running') return json(res, 409, { error: 'Wait until the run has finished' });
      const report = String(src.meta.report || '').trim();
      if (report.length < 40 || /PRZERWANO/i.test(src.meta.reportStatus || '')) return json(res, 400, { error: 'This run produced no report to replicate' });
      if (!agentAvailable(AGENTS.qamcp)) return json(res, 409, { error: 'QA MCP is not available (no .mcp.json next to the app)' });
      if (peBusyRuns.has(src.meta.id)) return json(res, 409, { error: 'The prompt for this run is already being prepared' });
      let system;
      try { system = peSystem('replicate'); } catch (e) { return json(res, 500, { error: e.message }); }
      const clean = (s) => stripTag(s, 'analysis_result');
      const input = `<analysis_result>\nSource: ${a.label} agent (${a.mode === 'design' ? 'test design' : 'analysis'}), result status: ${src.meta.reportStatus || 'n/a'}.\n`
        + `Request it was given: ${clean(src.meta.ticket).slice(0, 1500)}\n`
        + (src.meta.notes ? `Additional context given with the request: ${clean(src.meta.notes).slice(0, 2000)}\n` : '')
        + `\nResult:\n${clean(report).slice(0, 12000)}\n</analysis_result>`;
      peBusyRuns.add(src.meta.id);
      return json(res, 202, startJob('replicate', src.meta.id, async () => {
        try { return { target: 'replicate', source: src.meta.id, ...(await peRun(system, input)) }; }
        finally { peBusyRuns.delete(src.meta.id); }
      }));
    }
    // Test Flow: push a finished phase's report into the next phase's run — one click (manual
    // "Push to next phase" button) or automatic (the client's auto-mode poll passes {auto:true}).
    if ((m = p.match(/^\/api\/runs\/([\w-]+)\/push$/)) && req.method === 'POST') {
      const b = await body(req).catch(() => ({}));
      try { return json(res, 201, pushToNext(m[1], { auto: !!b.auto })); }
      catch (e) { return json(res, e.status || 500, { error: e.message, pushedTo: e.pushedTo }); }
    }
    // Run Summary: the whole Test Flow chain for one ticket, recomputed fresh on every call —
    // nothing is stored, so it can never go stale or need its own cleanup job.
    if (p === '/api/run-summary/recent' && req.method === 'GET') {
      return json(res, 200, { tickets: runSummaryLib.recentTickets() });
    }
    if ((m = p.match(/^\/api\/run-summary\/(.+)$/)) && req.method === 'GET') {
      return json(res, 200, runSummaryLib.buildRunSummary(decodeURIComponent(m[1])));
    }
    if ((m = p.match(/^\/api\/runs\/([\w-]+)$/)) && req.method === 'GET') {
      const r = runs.get(m[1]); if (!r) return json(res, 404, { error: 'Not found' });
      // Raport rozłożony na karty dla widoku; stare raporty też (parser rozumie dawny format). null = UI pokaże tekst.
      const mode = (AGENTS[r.meta.agent] || {}).mode || 'qa';
      const view = parseReport(mode, r.meta.report, r.meta.reportStatus);
      // QA MCP: wiadomości wysłane do testowanego czatu MCP, z dziennika wywołań (dokładny tekst, wywołania narzędzi, odpowiedź).
      const workDir = path.join(RUNS_DIR, 'work', r.meta.id);
      // Dziennik wywołań i baterie (setki odpowiedzi) czytane i liczone raz; ponownie tylko, gdy w katalogu runu coś przybyło.
      let stamp = '';
      try { stamp = fs.readdirSync(workDir).map((n) => n + ':' + fs.statSync(path.join(workDir, n)).mtimeMs).join('|'); } catch (_) { /* brak katalogu */ }
      const cached = runChatCache.get(r.meta.id);
      if (cached && cached.stamp === stamp && cached.report === r.meta.report) return json(res, 200, { meta: r.meta, events: r.events, view, ...cached.data });
      const chat = mode === 'qamcp' || mode === 'execution' ? chatCases(view, workDir) : [];
      const batteries = mode === 'qamcp' || mode === 'execution' ? chatBatteries(workDir) : [];
      // Jakość czatu w całym runie: wszystkie przypadki z werdyktem mcp-server (baterie i pojedyncze pytania z expect),
      // liczona tym samym kodem i z tymi samymi kryteriami akceptacji co w mcp-server.
      let quality = null;
      const scored = [...batteries.flatMap((b) => b.cases), ...chat.filter((c) => c.evaluation).map((c) => ({
        outcome: c.evaluation.outcome, intent: (c.expect && c.expect.tool) || '', expectClass: (c.expect && c.expect.class) || 'answer', latencyMs: c.latencyMs,
        attempts: c.evaluation.attempts || 1, pass: c.evaluation.pass, consistentAfterMs: c.evaluation.consistentAfterMs }))];
      if (scored.length) {
        try {
          const ev = await import(require('url').pathToFileURL(path.join(ROOT, 'mcp-server', 'src', 'mcp', 'tools', 'chat-eval.js')).href);
          quality = ev.metrics(scored, ev.loadAcceptance());
        } catch (e) { quality = { error: e.message }; }
      }
      // Widok pokazuje macierze i tylko błędne pytania, więc pozostałe (setki odpowiedzi z wynikami narzędzi) nie idą do UI.
      const slim = (c) => ({ ...c, toolCalls: (c.toolCalls || []).map(({ output, ...t }) => t) });
      const failed = batteries.map(({ cases, ...b }) => ({ ...b, total: cases.length, cases: cases.filter((c) => !c.pass).map(slim) }));
      const data = { chat: chat.map(slim), batteries: failed, quality };
      runChatCache.set(r.meta.id, { stamp, report: r.meta.report, data });
      if (runChatCache.size > 50) runChatCache.delete(runChatCache.keys().next().value);
      return json(res, 200, { meta: r.meta, events: r.events, view, ...data });
    }
    if ((m = p.match(/^\/api\/runs\/([\w-]+)\/events$/)) && req.method === 'GET') {
      const r = runs.get(m[1]); if (!r) return json(res, 404, { error: 'Not found' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      for (const ev of r.events) res.write(`data: ${JSON.stringify(ev)}\n\n`);
      if (r.meta.status !== 'running') return res.end();
      r.listeners.add(res); req.on('close', () => r.listeners.delete(res));
      return;
    }
    if ((m = p.match(/^\/api\/runs\/([\w-]+)\/cancel$/)) && req.method === 'POST') {
      const r = runs.get(m[1]); if (!r || r.meta.status !== 'running') return json(res, 404, { error: 'Not running' });
      r.meta.status = 'cancelled';
      // QA MCP w trakcie odczytu Jiry nie ma jeszcze procesu; run zamknie się sam, gdy odczyt się skończy.
      if (r.proc) spawn('taskkill', ['/pid', String(r.proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && !p.startsWith('/api/')) {
      if (serveStatic(req, res, p === '/' ? '/index.html' : p)) return;
    }
    json(res, 404, { error: 'Not found' });
  } catch (e) { json(res, 500, { error: String(e.message || e) }); }
});

// Pojedynczy wyjątek w callbacku (np. zapis do zamkniętego połączenia SSE) nie może ubić serwera
// razem z trwającymi analizami.
process.on('uncaughtException', (e) => console.error('uncaughtException:', e && e.stack || e));
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e && e.stack || e));

// Restartuje się sam, zachowując argv/env (PORT, QA_DATA_DIR, …): nowy proces odpala się w tle,
// próbując nasłuchiwać aż ten się zwolni (listenWithRetry), dopiero potem ten proces się kończy —
// więc nawet gdy coś pójdzie nie po kolei, nowy proces i tak w końcu przejmie port.
function listenWithRetry(srv, port, host, cb, triesLeft = 15) {
  srv.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && triesLeft > 0) { setTimeout(() => listenWithRetry(srv, port, host, cb, triesLeft - 1), 400); return; }
    console.error('Could not start the server:', err.message);
    process.exit(1);
  });
  srv.listen(port, host, cb);
}

loadAll();
pruneWork();
listenWithRetry(server, PORT, HOST, () => {
  console.log(`Agent UI: http://${HOST === '0.0.0.0' ? '<server-host>' : 'localhost'}:${PORT}`);
  // Który katalog obsadza zakładkę Analyses. Cicha pomyłka tutaj gasi cały wybór agenta,
  // więc jest wypisywana przy każdym starcie, razem z tym, ilu agentów faktycznie widać.
  const ready = Object.values(AGENTS).filter((a) => !a.absDir && agentAvailable(a)).length;
  listSuite().catch(() => {}); // rozgrzewka cache listy testów, żeby pierwsze wejście w Test suite nie czekało kilku sekund
  console.log(`Agents: ${ready}/${AGENT_DIRS.length} found in ${AGENTS_ROOT}`
    + (ready ? '' : ' - set QA_AGENTS_ROOT to the folder holding claudeAgent*/'));
});
// "localhost" resolves to ::1 first; with nothing listening there Windows retries the refused connection before falling
// back to 127.0.0.1 (measured ~300 ms per request). Only relevant for the default loopback setup — a hosted
// deployment binds HOST explicitly (e.g. 0.0.0.0) and doesn't hit this resolver quirk.
let ipv6Server = null;
if (HOST === '127.0.0.1') {
  ipv6Server = http.createServer((req, res) => server.emit('request', req, res));
  listenWithRetry(ipv6Server, PORT, '::1', () => {});
}

/** POST /api/admin/restart: re-exec the same process (same node, same argv, same env — PORT,
 * QA_DATA_DIR, QA_MODEL, etc. all survive), then let this process go once the new one is spawned.
 * Responds before anything closes, so the client reliably gets the 202 even though the server is
 * about to disappear out from under the connection. */
function restartServer(res) {
  json(res, 202, { ok: true });
  setTimeout(() => {
    // Same convention as a manual `node server.js > server.log 2> server.err.log` launch, so the new
    // process's startup banner lands in the same files instead of vanishing into 'ignore'.
    let stdio = 'ignore';
    try {
      stdio = ['ignore',
        fs.openSync(path.join(process.cwd(), 'server.log'), 'a'),
        fs.openSync(path.join(process.cwd(), 'server.err.log'), 'a')];
    } catch (e) { /* fall back to 'ignore' — a restart must not fail over a log file */ }
    try {
      const child = spawn(process.execPath, process.argv.slice(1), { cwd: process.cwd(), env: process.env, detached: true, stdio, windowsHide: true });
      child.unref();
    } catch (e) { console.error('Restart: could not spawn the new process:', e.message); }
    if (ipv6Server) ipv6Server.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000); // belt-and-braces: a lingering keep-alive connection must not block the exit forever
  }, 150);
}
