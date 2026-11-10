// Konfiguracja i ścieżki: jedno miejsce, które mówi, gdzie leży repo, agenci, dane i jaki jest model.
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 4317;
// Loopback by default (local dev, unchanged). A hosted deployment sets QA_HOST=0.0.0.0 to accept
// connections from the internal network; nothing else about the app changes.
const HOST = process.env.QA_HOST || '127.0.0.1';
// Wszystkie runy (agent główny i subagenci) idą na jednym modelu — nigdy na domyślnym z ustawień użytkownika.
const MODEL = process.env.QA_MODEL || 'claude-sonnet-5-5';
// APP_DIR to katalog agent-ui (kod, public/, tool-groups.json); ROOT to katalog nadrzędny (mcp-server, autotests, .mcp.json).
const APP_DIR = path.resolve(__dirname, '..');
const ROOT = path.resolve(APP_DIR, '..');
// Nazwa serwera MCP z .mcp.json, nie z założenia. Allowlista (--permission-mode dontAsk) musi nosić
// dokładnie ten prefiks, który nadaje CLI — inaczej KAŻDE wywołanie narzędzia jest odrzucane jako
// "brak uprawnień", także otwarcie pozycji testowej.
const MCP_SERVER = (() => {
  try {
    const keys = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8')).mcpServers || {});
    return keys.includes('qa') ? 'qa' : keys.includes('plat') ? 'plat' : keys[0] || 'qa';
  } catch (_) { return 'qa'; }
})();
// NASZE repo autotestów, wewnątrz ROOT. Agent nigdy nie wychodzi poza ten katalog: styl jest
// wzorowany na zewnętrznym repo reference-tests, ale nic stamtąd nie jest czytane ani zapisywane.
// QA_AUTOTEST_REPO pozwala testom aplikacji pracować na kopii repo zamiast na prawdziwym autotests/.
const AUTOTEST_REPO = process.env.QA_AUTOTEST_REPO ? path.resolve(process.env.QA_AUTOTEST_REPO) : path.join(ROOT, 'autotests');
const PLAT_ENV_FILE = path.join(ROOT, 'mcp-server', '.env');
// Dane zmienne (runy, rejestr błędów, stan Jiry, wyniki testów) leżą w DATA_DIR; domyślnie obok kodu. QA_DATA_DIR pozwala
// uruchomić drugą, odizolowaną instancję (testy), która nie dotyka prawdziwych danych.
const DATA_DIR = process.env.QA_DATA_DIR ? path.resolve(process.env.QA_DATA_DIR) : APP_DIR;
fs.mkdirSync(DATA_DIR, { recursive: true });
const RUNS_DIR = path.join(DATA_DIR, 'runs');
fs.mkdirSync(RUNS_DIR, { recursive: true });

// Katalogi agentow (claudeAgent*) nie musza lezec tam, gdzie workspace. Gdy agent-ui zostanie
// skopiowane do innego folderu, ROOT przestaje je widziec i caly wybor w zakladce Analyses gasnie
// bez slowa wyjasnienia - kazdy przycisk disabled, a pierwszy z listy wyglada na wybrany.
// Dlatego szukamy ich osobno: QA_AGENTS_ROOT (jesli ustawione, honorujemy je nawet gdy puste -
// jawna konfiguracja nie moze byc po cichu nadpisana), inaczej ROOT, inaczej ../Agents.
const AGENT_DIRS = ['claudeAgent', 'claudeAgentB', 'claudeAgentMcp', 'claudeAgentTestDesign', 'claudeAgentTestFlowPlanning', 'claudeAgentTestFlowAnalysis', 'claudeAgentTestFlowImplementation', 'claudeAgentTestFlowCompletion'];
const holdsAgents = (dir) => AGENT_DIRS.some((d) => fs.existsSync(path.join(dir, d, 'CLAUDE.md')));
const AGENTS_ROOT = process.env.QA_AGENTS_ROOT
  ? path.resolve(process.env.QA_AGENTS_ROOT)
  : [ROOT, path.join(ROOT, 'agents'), path.resolve(ROOT, '..', 'Agents')].find(holdsAgents) || path.join(ROOT, 'agents');

const TICKET_KEY = /^[A-Za-z][A-Za-z0-9]*-\d+$/;
const QA_GIT = path.join(APP_DIR, 'qa-git.sh').split(path.sep).join('/');

module.exports = {
  AGENTS_ROOT,
  APP_DIR,
  AGENT_DIRS,
  AUTOTEST_REPO,
  DATA_DIR,
  HOST,
  MCP_SERVER,
  MODEL,
  PORT,
  QA_GIT,
  PLAT_ENV_FILE,
  ROOT,
  RUNS_DIR,
  TICKET_KEY,
};
