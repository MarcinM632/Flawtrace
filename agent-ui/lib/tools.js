// Tools tab: the endpoints of the test environment API, read from the imported OpenAPI or Swagger specifications
// (Sources tab). A rescan downloads the specifications again and compares every endpoint with the previous state:
// new, removed and changed parameters. The same catalogue is what the qa MCP server lets QA MCP call.
const path = require('path');
const fs = require('fs');
const { DATA_DIR } = require('./config');
const sources = require('./sources');

const STATE_FILE = path.join(DATA_DIR, 'tools-state.json');
const MARK_TTL = 14 * 24 * 3600 * 1000; // NEW and CHANGED marks stay on an endpoint for two weeks

const state = { baseline: null, scannedAt: 0, history: [], marks: {} };
try { Object.assign(state, JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); } catch (_) { /* first start */ }
const saveState = () => { try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch (_) { /* state is an extra */ } };

let scanning = false;
// An empty catalogue (nothing imported yet, or every download failed) is not a reference state to compare with.
const hasBaseline = () => !!state.baseline && Object.keys(state.baseline).length > 0;

function readCatalogue() {
  const cat = sources.catalogue();
  const groups = {};
  for (const sp of cat.specs) for (const e of sp.endpoints) {
    if (!groups[e.group]) groups[e.group] = { label: e.groupLabel, target: sp.source, title: sp.title + (sp.version ? ' ' + sp.version : '') };
  }
  return { endpoints: cat.endpoints, groups, errors: cat.errors };
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

/** Answer for the UI: groups with endpoints, change marks and scan history. */
async function getTools() {
  const cat = readCatalogue();
  if (!hasBaseline() && cat.endpoints.length) { state.baseline = toMap(cat.endpoints); state.scannedAt = Date.now(); saveState(); }
  pruneMarks();
  const groups = {};
  for (const [key, g] of Object.entries(cat.groups)) groups[key] = { key, label: g.label, target: g.target, gateway: g.title, endpoints: [] };
  for (const e of cat.endpoints) if (groups[e.group]) groups[e.group].endpoints.push({ ...e, description: e.summary, mark: state.marks[e.name] || null });
  const list = Object.values(groups);
  list.forEach((g) => g.endpoints.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)));
  const cfg = sources.read();
  return {
    groups: list, total: cat.endpoints.length, scannedAt: state.scannedAt, scanning,
    baseUrl: cfg.api.baseUrl, specs: Object.fromEntries(cfg.api.specs.map((s) => [s.name, s.url])), specErrors: cat.errors,
    history: state.history, removed: state.history.length ? state.history[0].removed : [],
  };
}

/** Compares the catalogue on disk with the last state and records what is new or changed. */
function record(fetched) {
  const cat = readCatalogue();
  const now = toMap(cat.endpoints);
  const first = !hasBaseline();
  const d = first ? { added: [], removed: [], changed: [] } : diffCatalogues(state.baseline, now);
  const at = Date.now();
  for (const n of d.added) state.marks[n] = { kind: 'new', at };
  for (const c of d.changed) state.marks[c.name] = { kind: 'changed', at, detail: c };
  for (const n of d.removed) delete state.marks[n];
  state.history.unshift({ at, total: cat.endpoints.length, baseline: first, added: d.added, removed: d.removed, changed: d.changed, fetched });
  state.history = state.history.slice(0, 20);
  if (Object.keys(now).length || !first) state.baseline = now;
  state.scannedAt = at;
  saveState();
}

/** Downloads every specification again and compares all endpoints with the previous state. */
async function rescan() {
  if (scanning) throw Object.assign(new Error('A scan is already running'), { code: 409 });
  scanning = true;
  try { record(await sources.fetchSpecs()); } finally { scanning = false; }
  return getTools();
}

/** After a specification was uploaded as a file: compare without downloading. */
async function refresh() { record([]); return getTools(); }

module.exports = { diffCatalogues, getTools, refresh, rescan };
