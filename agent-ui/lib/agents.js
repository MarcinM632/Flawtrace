// Definicje agentów (zakładek) i odkrywanie ich katalogów.
const path = require('path');
const fs = require('fs');
const { AGENTS_ROOT, AUTOTEST_REPO, ROOT } = require('./config');

const AGENTS = {
  // Agenci analiz biorą klucz ticketu ALBO zwykły opis zadania. Bez klucza weryfikują opis z Jirą,
  // Confluence i kodem (patrz OVERRIDE) — brak ticketu nie jest powodem do przerwania.
  core: { label: 'CORE', dir: 'claudeAgent', freeform: true, hint: 'Ticket key from the PRJ project, e.g. PRJ-297 — or describe what to check', pattern: /^[\s\S]{3,300}$/ },
  svc: { label: 'SVC', dir: 'claudeAgentB', freeform: true, hint: 'Ticket key from the SVC project, e.g. SVC-289 — or describe what to check', pattern: /^[\s\S]{3,300}$/ },
  mcp: { label: 'mcp-server', dir: 'claudeAgentMcp', freeform: true, hint: 'Ticket key from the OPS project, e.g. OPS-170 — or describe what to check', pattern: /^[\s\S]{3,300}$/ },
  design: {
    label: 'Test design', dir: 'claudeAgentTestDesign', mode: 'design', freeform: true,
    hint: 'A ticket key, or the requirement itself to design tests for. Output in English.',
    pattern: /^.{3,300}$/s,
  },
  // Wykonuje proces testowy napisany prozą, uderzając w prawdziwe PLAT/CORE przez serwer MCP `qa`
  // (nasz wrapper mcp-server, nie zewnętrzny mcp-server — stąd osobna nazwa klucza w .mcp.json).
  // Pracuje w ROOT, bo tam lezy .mcp.json - bez tego CLI nie zobaczy serwera.
  qamcp: {
    label: 'QA MCP', absDir: ROOT, mode: 'qamcp', freeform: true,
    hint: 'Describe the test process in plain words. The agent runs it against the configured environment and reports its progress, the endpoints it used and a short verdict.',
    pattern: /^[\s\S]{10,8000}$/,
  },
  // Test Flow — Phase 6: wykonuje na żywo procedurę z Fazy 5 — dokładnie ten sam mechanizm co QA MCP
  // (ten sam serwer MCP, dziennik wywołań, pamięć procedur), osobna historia/zakładka i ramowanie promptu.
  execution: {
    label: 'Execution', absDir: ROOT, mode: 'execution', freeform: true,
    hint: 'Paste the step-by-step procedure from Phase 5 Test Implementation. The agent runs it against the configured environment for real, retests any failure once before reporting it, and gives the same evidence-based verdict as QA MCP.',
    pattern: /^[\s\S]{10,8000}$/,
  },
  // Test Flow — Phase 1: ryzyko, entry/exit criteria i static/white-box check, zanim backlog task
  // trafi do implementacji. Pełna architektura jak Test Design (subagenci jako role w CLAUDE.md,
  // istqb-library/test-manager.md, walidator test-planning), raport po polsku (proces wewnętrzny).
  planning: {
    label: 'Planning', dir: 'claudeAgentTestFlowPlanning', mode: 'planning', freeform: true,
    hint: 'A backlog task already scoped for this iteration — a Jira key, or its description/story. Checks feasibility against the code first, then lists risk and entry/exit criteria.',
    pattern: /^[\s\S]{3,300}$/,
  },
  // Test Flow — Phase 3: dobiera i uzasadnia strategię testów, liczy lukę coverage i sprawdza zasięg
  // wpływu (blast radius) przez qa-git.sh find, zanim Test Design (Faza 4) zaprojektuje przypadki.
  analysis: {
    label: 'Analysis', dir: 'claudeAgentTestFlowAnalysis', mode: 'analysis', freeform: true,
    hint: 'A backlog task — ideally already checked by Phase 1 Planning. Picks a test strategy, measures the coverage gap, and checks blast radius across repos before handing scope to Phase 4.',
    pattern: /^[\s\S]{3,300}$/,
  },
  // Test Flow — Phase 5: scala punkty Fazy 4 w jedną procedurę wykonawczą, priorytetyzuje (ryzyko z
  // Fazy 1/3 albo bug-registry), szacuje czas i śledzi każdy punkt z powrotem do źródła (traceability).
  implementation: {
    label: 'Implementation', dir: 'claudeAgentTestFlowImplementation', mode: 'implementation', freeform: true,
    hint: 'A Phase 4 test design (ticket key or pasted report). Merges every point into one procedure, prioritised and time-estimated, traced back to its source and ready to paste into Phase 6.',
    pattern: /^[\s\S]{3,300}$/,
  },
  // Test Flow — Phase 7: zamyka cykl — krótkie, proste wyjaśnienie jak zakończony task naprawdę działa
  // i dlaczego, plus znane defekty tego obszaru z rejestru błędów. Zostaje w historii jako baza wiedzy.
  completion: {
    label: 'Completion', dir: 'claudeAgentTestFlowCompletion', mode: 'completion', freeform: true,
    hint: 'A finished Jira ticket. Produces a short, plain-language explanation of what it does, why it was built that way, and any known defects in that area — archived here as a searchable knowledge base entry.',
    pattern: /^[\s\S]{3,300}$/,
  },
  // Przepisuje przypadek testowy prozą na pytest w naszym repo `autotests/`.
  autotest: {
    label: 'Autotests', absDir: AUTOTEST_REPO, mode: 'autotest', freeform: true,
    hint: 'Describe the test case in plain words. It becomes short pytest tests in autotests/: one thing per test, a plain-language scenario, a name that says what is tested.',
    pattern: /^[\s\S]{10,8000}$/,
  },
};

/** Katalog roboczy agenta: bezwzględny gdy podany wprost, inaczej względem AGENTS_ROOT. */
const agentDir = (a) => a.absDir || path.join(AGENTS_ROOT, a.dir);

/** Czy agent ma z czego wystartować. QA MCP potrzebuje .mcp.json, reszta — CLAUDE.md u siebie. */
const agentAvailable = (a) => (a.mode === 'qamcp' || a.mode === 'execution'
  ? fs.existsSync(path.join(ROOT, '.mcp.json'))
  // Autotests nie ma CLAUDE.md — jego instrukcją jest README.md repo (to samo sprawdza /api/autotest-meta).
  : a.mode === 'autotest'
  ? fs.existsSync(path.join(a.absDir, 'README.md'))
  : fs.existsSync(path.join(agentDir(a), 'CLAUDE.md')));

// Services per app - for the bug registry. Taken from the agent folders + a fixed extra list.
const EXTRA_SERVICES = { svc: ['connector-service', 'plat-admin-api', 'plat-admin-client', 'fix-connector'], mcp: ['mcp-server'] };
function servicesFor(key) {
  // QA MCP pracuje na żywym środowisku, Autotests na cudzym repo — ani jedno, ani drugie nie ma
  // tu katalogów serwisów do wyliczenia.
  if (AGENTS[key].absDir) return [];
  const dir = agentDir(AGENTS[key]);
  let found = [];
  try {
    found = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !['qa-library', 'sandbox-autotesty', 'mcp-server'].includes(e.name))
      .map((e) => e.name.replace(/-(develop|master|main)$/, ''));
  } catch (_) { /* brak folderu agenta */ }
  return [...new Set([...found, ...(EXTRA_SERVICES[key] || [])])].sort();
}

module.exports = {
  AGENTS,
  agentAvailable,
  agentDir,
  servicesFor,
};
