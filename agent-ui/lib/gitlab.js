// Cienki klient GitLaba (REST v4) dla coverage-watch (lib/coverage.js). Token osobisty w
// ~/.claude/gitlab-config.json — ta sama konwencja co skill gitlab-browse, żeby nie trzymać
// drugiego miejsca z sekretem. Zewnętrzny GitLab nie jest podłączony jako serwer MCP, więc runy
// claude -p nie mogą go dotknąć same — dane ciągnie ten moduł (zwykły proces Node), a agentowi
// trafia już gotowy tekst (diffy, lista commitów).
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = 'https://git.example.internal/api/v4';
const TOKEN_FILE = path.join(os.homedir(), '.claude', 'gitlab-config.json');

let cachedToken;
function token() {
  if (cachedToken !== undefined) return cachedToken;
  try { cachedToken = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')).token || null; }
  catch (_) { cachedToken = null; }
  if (cachedToken === 'YOUR_GITLAB_TOKEN_HERE') cachedToken = null;
  return cachedToken;
}

async function api(pathAndQuery) {
  const t = token();
  if (!t) throw new Error('No GitLab token at ~/.claude/gitlab-config.json');
  const res = await fetch(BASE + pathAndQuery, { headers: { 'PRIVATE-TOKEN': t } });
  if (!res.ok) throw new Error(`GitLab ${res.status} on ${pathAndQuery}`);
  return res.json();
}

// Projekty nie zmieniają nazwy z minuty na minutę — jeden proces trzyma to w pamięci na cały czas działania.
const projectCache = new Map(); // service name -> {id, path, default_branch} | null (nie znaleziono)

/** Projekt GitLaba dla nazwy serwisu (np. "core-hedger" — tak samo jak katalog agenta bez
 * sufiksu -develop/-master). Dopasowanie: dokładna ścieżka projektu, inaczej pierwszy wynik wyszukiwania. */
async function findProject(service) {
  if (projectCache.has(service)) return projectCache.get(service);
  let found = null;
  try {
    const list = await api(`/projects?search=${encodeURIComponent(service)}&per_page=20`);
    found = list.find((p) => p.path === service) || list.find((p) => p.path.toLowerCase() === service.toLowerCase()) || list[0] || null;
  } catch (_) { found = null; }
  const entry = found ? { id: found.id, path: found.path_with_namespace, defaultBranch: found.default_branch || 'master' } : null;
  projectCache.set(service, entry);
  return entry;
}

/** Ostatnie commity na domyślnym branchu od danej daty (lub ostatnich 30 dni, gdy nieznana), najnowsze pierwsze. */
async function recentCommits(projectId, defaultBranch, sinceIso, limit = 15) {
  const since = sinceIso && !Number.isNaN(Date.parse(sinceIso)) ? new Date(sinceIso).toISOString() : new Date(Date.now() - 30 * 86400000).toISOString();
  const list = await api(`/projects/${projectId}/repository/commits?ref_name=${encodeURIComponent(defaultBranch)}&since=${encodeURIComponent(since)}&per_page=${limit}`);
  return Array.isArray(list) ? list : [];
}

// Pliki, których diff nic nie mówi o logice biznesowej (lockfile, wygenerowany kod, binaria) — pomijane
// w treści diffu, żeby nie zapychać kontekstu oceny; nazwa i tak zostaje na liście zmienionych plików.
const NOISY = /(^|\/)(package-lock\.json|poetry\.lock|yarn\.lock|Cargo\.lock|.*\.lock)$|\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|jar|class)$/i;

/** Diff jednego commita, z pominięciem szumu i obcięciem bardzo dużych plików. */
async function commitDiff(projectId, sha) {
  let files; try { files = await api(`/projects/${projectId}/repository/commits/${sha}/diff`); } catch (_) { return []; }
  return (Array.isArray(files) ? files : []).map((f) => {
    const p = f.new_path || f.old_path || '';
    const skip = NOISY.test(p);
    return { path: p, diff: skip ? '(skipped: lockfile/binary)' : String(f.diff || '').slice(0, 3000) };
  });
}

module.exports = { commitDiff, findProject, recentCommits };
