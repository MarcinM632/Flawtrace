// Wykrywanie nowych tasków w BIEŻĄCYM wydaniu (Jira, lib/test-monitor.js) i automatyczny start
// testowania statycznego (static/white-box + bramka domain-rules — to jest zwykły, domyślny tryb
// agenta CORE/SVC/AI, lib/run-agent.js startRun bez `mode`). Odświeża się same co godzinę, niezależnie
// od tego, czy ktoś ma otwartą appkę: pierwszy przebieg po starcie serwera tylko zapisuje punkt
// odniesienia (żeby nie odpalić testu dla całego istniejącego backlogu wydania), każdy kolejny zgłasza
// i testuje TYLKO klucze, których nie było w poprzednim odczycie.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');
const testMonitor = require('./test-monitor');
const { startRun } = require('./run-agent');

const STATE_FILE = path.join(DATA_DIR, 'release-watch.json');
const POLL_EVERY = (Number(process.env.RELEASE_WATCH_MINUTES) || 60) * 60 * 1000;
const MAX_NOTIFICATIONS = 100;

let state = { byProject: {}, notifications: [] };
try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) { /* pierwszy start */ }
const save = () => { try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch (_) { /* nieistotne */ } };

async function checkProject(key) {
  const proj = testMonitor.PROJECTS[key];
  if (!proj) return;
  await testMonitor.refreshRelease(key);
  const snap = testMonitor.snapshot(key);
  const current = snap.releases.find((r) => r.name === snap.currentReleaseName);
  if (!current) return; // brak bieżącego wydania (np. Jira niedostępna) — nic do porównania
  const entry = state.byProject[key] || { version: null, knownKeys: [] };
  // Zmiana wydania (np. 7.3 -> 7.4) traktowana jak pierwszy start dla NOWEGO wydania: nowy punkt
  // odniesienia, bez odpalania testów dla całego backlogu, który właśnie się w nim pojawił.
  const isFirstBaseline = entry.version !== current.name;
  const knownSet = new Set(isFirstBaseline ? [] : entry.knownKeys);
  const currentKeys = current.issues.map((it) => it.key);
  const newKeys = isFirstBaseline ? [] : currentKeys.filter((k) => !knownSet.has(k));
  entry.version = current.name;
  entry.knownKeys = currentKeys;
  state.byProject[key] = entry;
  for (const k of newKeys) {
    const issue = current.issues.find((it) => it.key === k);
    let runId = null;
    try { runId = startRun(key, k, '', { source: 'release-watch' }).id; }
    catch (e) { console.warn('release-watch: nie udało się uruchomić testu statycznego dla ' + k + ': ' + (e && e.message || e)); }
    state.notifications.unshift({
      id: k + '-' + Date.now(), key: k, project: proj.jiraKey, agent: key, label: proj.label,
      version: current.name, summary: issue ? issue.summary : '', detectedAt: Date.now(),
      runId, read: false,
    });
  }
  if (state.notifications.length > MAX_NOTIFICATIONS) state.notifications.length = MAX_NOTIFICATIONS;
  save();
}

async function checkAll() {
  for (const key of Object.keys(testMonitor.PROJECTS)) {
    try { await checkProject(key); } catch (e) { console.warn('release-watch: ' + key + ' failed: ' + (e && e.message || e)); }
  }
}

let started = false;
function start() {
  if (started) return;
  started = true;
  checkAll().catch(() => {});
  setInterval(() => checkAll().catch(() => {}), POLL_EVERY);
}

const list = () => state.notifications;
const unreadCount = () => state.notifications.filter((n) => !n.read).length;
function ackAll() { state.notifications.forEach((n) => { n.read = true; }); save(); }

module.exports = { ackAll, checkAll, list, start, unreadCount };
