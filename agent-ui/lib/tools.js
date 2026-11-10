// Zakładka Tools: katalog endpointów mcp-server z podziałem na serwisy (grupy) oraz ponowna inicjalizacja, która odświeża
// specyfikacje i porównuje wszystkie endpointy z poprzednim stanem (nowe, usunięte, zmienione parametry).
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { APP_DIR, DATA_DIR, ROOT } = require('./config');

const STATE_FILE = path.join(DATA_DIR, 'tools-state.json');
const MCP_DIR = path.join(ROOT, 'mcp-server');
const SPECS_DIR = path.join(MCP_DIR, 'specs');
const MARK_TTL = 14 * 24 * 3600 * 1000; // znacznik NEW / CHANGED wisi przy endpoincie dwa tygodnie
const GATEWAY = {
  admin: 'PLAT Admin', manager: 'PLAT Manager', 'core-gateway': 'CORE Gateway', 'core-admin': 'CORE Admin',
  'core-manager': 'CORE Manager', 'core-hedger': 'CORE Hedger', 'core-feed': 'CORE Feed Analyser', 'core-notify': 'CORE Notifications',
};

const state = { baseline: null, scannedAt: 0, history: [], marks: {} };
try { Object.assign(state, JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); } catch (_) { /* pierwszy start */ }
const saveState = () => { try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch (_) { /* stan jest dodatkiem */ } };

let scanning = false;
let cache = null; // { sig, data }

function runNode(args, cwd, timeout) {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, args, { cwd, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { proc.kill(); resolve({ code: -1, out, err: err + '\ntimed out' }); }, timeout);
    proc.stdout.on('data', (c) => { out += c; });
    proc.stderr.on('data', (c) => { err += c; });
    proc.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out, err: String(e.message) }); });
    proc.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

const specSig = () => {
  try { return fs.readdirSync(SPECS_DIR).sort().map((f) => { const s = fs.statSync(path.join(SPECS_DIR, f)); return f + ':' + s.size + ':' + s.mtimeMs; }).join('|'); } catch (_) { return ''; }
};

/** Katalog z cache specyfikacji (osobny proces, bo mcp-server to ESM i trzyma własny cache katalogu). */
async function readCatalogue() {
  const sig = specSig();
  if (cache && cache.sig === sig) return cache.data;
  const r = await runNode([path.join(APP_DIR, 'scripts', 'list-endpoints.mjs')], APP_DIR, 60000);
  if (r.code !== 0) throw Object.assign(new Error('Could not read the endpoint catalogue: ' + (r.err.trim().split('\n').slice(-2).join(' ') || 'exit ' + r.code)), { stderr: r.err });
  const data = JSON.parse(r.out);
  cache = { sig, data };
  return data;
}

const slim = (e) => ({ method: e.method, path: e.path, read: e.read, group: e.group, params: e.params });
const pkey = (p) => p.name;
const pdesc = (p) => (p.required ? 'required ' : '') + p.type + (p.enum ? ' [' + p.enum.join(', ') + ']' : '');

/** Porównanie dwóch katalogów: nowe i usunięte endpointy oraz zmiany parametrów (dodane, usunięte, zmieniony typ/wymagalność/enum). */
function diffCatalogues(before, after) {
  const added = [], removed = [], changed = [];
  for (const [name, e] of Object.entries(after)) {
    const o = before[name];
    if (!o) { added.push(name); continue; }
    const om = new Map(o.params.map((p) => [pkey(p), p])), nm = new Map(e.params.map((p) => [pkey(p), p]));
    const d = { name, added: [], removed: [], modified: [], moved: null };
    for (const [k, p] of nm) { const q = om.get(k); if (!q) d.added.push(k + ' (' + pdesc(p) + ')'); else if (pdesc(p) !== pdesc(q)) d.modified.push({ name: k, from: pdesc(q), to: pdesc(p) }); }
    for (const k of om.keys()) if (!nm.has(k)) d.removed.push(k);
    if (o.method !== e.method || o.path !== e.path) d.moved = { from: o.method + ' ' + o.path, to: e.method + ' ' + e.path };
    if (d.added.length || d.removed.length || d.modified.length || d.moved) changed.push(d);
  }
  for (const name of Object.keys(before)) if (!after[name]) removed.push(name);
  return { added, removed, changed };
}

const toMap = (list) => Object.fromEntries(list.map((e) => [e.name, slim(e)]));
const pruneMarks = () => { const now = Date.now(); for (const [k, m] of Object.entries(state.marks)) if (now - m.at > MARK_TTL) delete state.marks[k]; };

/** Odpowiedź dla UI: serwisy z endpointami, znaczniki zmian i historia skanów. */
async function getTools() {
  const cat = await readCatalogue();
  if (!state.baseline) { state.baseline = toMap(cat.endpoints); state.scannedAt = Date.now(); saveState(); } // pierwszy kontakt: stan wyjściowy bez diffu
  pruneMarks();
  const groups = {};
  for (const [key, g] of Object.entries(cat.groups)) groups[key] = { key, label: g.label, target: g.target, gateway: GATEWAY[g.target] || g.target, endpoints: [] };
  for (const e of cat.endpoints) {
    if (!groups[e.group]) continue;
    groups[e.group].endpoints.push({ ...e, mark: state.marks[e.name] || null });
  }
  const list = Object.values(groups);
  list.forEach((g) => g.endpoints.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)));
  return {
    groups: list, total: cat.endpoints.length, scannedAt: state.scannedAt, scanning,
    specs: (() => { try { return JSON.parse(fs.readFileSync(path.join(SPECS_DIR, 'sources.json'), 'utf8')); } catch (_) { return {}; } })(),
    history: state.history, removed: state.history.length ? state.history[0].removed : [],
  };
}

/** Wyniki odświeżenia specyfikacji z wyjścia fetch-specs.js: które serwisy się udały, a które nie (zostają kopie z cache). */
function parseFetch(out, err) {
  const targets = [];
  for (const l of out.split(/\r?\n/)) { const m = l.match(/^\s+(OK|FAIL)\s+(.+?)(?::\s*(\d+) operations)?\s*$/); if (m) targets.push({ label: m[2], ok: m[1] === 'OK', operations: m[3] ? +m[3] : null, message: '' }); }
  const blocks = err.split(/\r?\n\r?\n/);
  for (const t of targets) if (!t.ok) { const b = blocks.find((x) => x.trim().startsWith(t.label)); if (b) t.message = b.split(/\r?\n/).slice(1).join(' ').trim().slice(0, 300); }
  return targets;
}

/** Serwisy ze specyfikacji, których mcp-server/src/mcp/groups.js nie przypisuje do żadnej grupy (nowe kontrolery): rejestr wtedy się nie składa. */
const unmappedIn = (stderr) => [...String(stderr || '').matchAll(/^\s+([a-z][\w-]*): ([\w.-]+)\s*$/gm)].map((m) => m[1] + ': ' + m[2]);
const copySpecs = (from, to) => { fs.mkdirSync(to, { recursive: true }); for (const f of fs.readdirSync(from)) fs.copyFileSync(path.join(from, f), path.join(to, f)); };

/** Ponowna inicjalizacja: odśwież specyfikacje z serwisów, przejrzyj wszystkie endpointy i zapisz, co jest nowe lub zmienione. */
async function rescan() {
  if (scanning) throw Object.assign(new Error('A scan is already running'), { code: 409 });
  scanning = true;
  try {
    // Kopia cache specyfikacji: nowa wersja, z którą mcp-server nie złoży katalogu, nie może zostać na dysku, bo wywaliłaby każdy run QA MCP.
    const backup = path.join(DATA_DIR, 'specs-backup');
    fs.rmSync(backup, { recursive: true, force: true });
    copySpecs(SPECS_DIR, backup);
    const f = await runNode([path.join(MCP_DIR, 'src', 'fetch-specs.js')], MCP_DIR, 120000);
    const fetched = parseFetch(f.out, f.err);
    cache = null;
    let cat;
    try { cat = await readCatalogue(); }
    catch (e) {
      copySpecs(backup, SPECS_DIR);
      cache = null;
      state.history.unshift({ at: Date.now(), total: 0, baseline: false, added: [], removed: [], changed: [], fetched, rolledBack: true, unmapped: unmappedIn(e.stderr), error: e.message });
      state.history = state.history.slice(0, 20);
      state.scannedAt = Date.now();
      saveState();
      fs.rmSync(backup, { recursive: true, force: true });
      return getTools();
    }
    fs.rmSync(backup, { recursive: true, force: true });
    // Mapa narzędzie -> grupa (zakres runów QA MCP) musi nadążać za katalogiem, inaczej nowe narzędzia nie ładują się do runów.
    try { await runNode([path.join(APP_DIR, 'scripts', 'build-tool-groups.mjs')], APP_DIR, 60000); require('./scope').resetToolGroups(); } catch (_) { /* katalog się złożył, mapa zostaje poprzednia */ }
    const now = toMap(cat.endpoints);
    const first = !state.baseline;
    const d = first ? { added: [], removed: [], changed: [] } : diffCatalogues(state.baseline, now);
    const at = Date.now();
    for (const n of d.added) state.marks[n] = { kind: 'new', at };
    for (const c of d.changed) state.marks[c.name] = { kind: 'changed', at, detail: c };
    for (const n of d.removed) delete state.marks[n];
    state.history.unshift({ at, total: cat.endpoints.length, baseline: first, added: d.added, removed: d.removed, changed: d.changed, fetched });
    state.history = state.history.slice(0, 20);
    state.baseline = now;
    state.scannedAt = at;
    saveState();
  } finally { scanning = false; }
  return getTools();
}

module.exports = { diffCatalogues, getTools, parseFetch, rescan };
