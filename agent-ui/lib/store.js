// Magazyn runów w pamięci i na dysku: mapa runów, zapis, odczyt przy starcie, strumień zdarzeń.
const path = require('path');
const fs = require('fs');
const { RUNS_DIR } = require('./config');

const scrubSecrets = (text, secrets) => { let s = text; for (const v of secrets) if (v && v.length >= 3) s = s.split(v).join('***'); return s; };
const runs = new Map(); // id -> { meta, events[], listeners:Set, proc }

function runFile(id) { return path.join(RUNS_DIR, id + '.json'); }
function persist(r) { fs.writeFileSync(runFile(r.meta.id), JSON.stringify({ meta: r.meta, events: r.events })); r._dirty = false; }

// Zdarzenia zakończonych runów (setki wpisów, wejścia endpointów do 6000 znaków) nie siedzą w RAM do restartu:
// po zapisie na dysk run dostaje leniwy getter `events`, który czyta plik przy pierwszym użyciu. Wszystkie
// miejsca czytające run.events działają bez zmian. W pamięci zostaje najwyżej KEEP_LOADED rozwiniętych runów.
const KEEP_LOADED = Number(process.env.QA_KEEP_LOADED_RUNS) || 8;
const loaded = []; // kolejność użycia, najstarszy pierwszy
function readEvents(id) { try { return JSON.parse(fs.readFileSync(runFile(id), 'utf8')).events || []; } catch (_) { return []; } }
function evictable(r) { return r.meta.status !== 'running' && !r._dirty && !(r.listeners && r.listeners.size); }
function touch(r) {
  const i = loaded.indexOf(r); if (i >= 0) loaded.splice(i, 1);
  loaded.push(r);
  for (let k = 0; loaded.length > KEEP_LOADED && k < loaded.length;) {
    const old = loaded[k];
    if (old !== r && evictable(old)) { old._ev = null; loaded.splice(k, 1); } else k++;
  }
}
/** Zwalnia zdarzenia runu z pamięci (zostają na dysku). Wołać po persist(), gdy run jest zakończony. */
function release(r) {
  if (!Object.getOwnPropertyDescriptor(r, 'events') || !Object.getOwnPropertyDescriptor(r, 'events').get) {
    r._ev = r.events;
    Object.defineProperty(r, 'events', {
      configurable: true, enumerable: true,
      get() { if (!this._ev) { this._ev = readEvents(this.meta.id); touch(this); } return this._ev; },
      set(v) { this._ev = v; this._dirty = true; },
    });
  }
  if (evictable(r)) { r._ev = null; const i = loaded.indexOf(r); if (i >= 0) loaded.splice(i, 1); }
}
function loadAll() {
  for (const f of fs.readdirSync(RUNS_DIR).filter((x) => x.endsWith('.json'))) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), 'utf8'));
      let changed = false;
      if (d.meta.status === 'running') { changed = true; d.meta.status = 'failed'; d.meta.error = 'Serwer zrestartowany w trakcie analizy'; }
      const run = { meta: d.meta, events: d.events || [], listeners: new Set(), proc: null };
      if (changed) persist(run); // status 'running' po restarcie zapisujemy od razu: dalej zdarzenia czytamy tylko z pliku
      release(run);
      runs.set(d.meta.id, run);
    } catch (_) { /* pomiń uszkodzony plik */ }
  }
}

function emit(r, ev) {
  ev.t = Date.now();
  // UI Tests: a password typed by the agent must not reach the log, the live stream or the saved run.
  if (r.secrets && r.secrets.length) for (const k of ['text', 'input', 'output']) if (typeof ev[k] === 'string') ev[k] = scrubSecrets(ev[k], r.secrets);
  r.events.push(ev);
  r._dirty = true;
  for (const res of r.listeners) res.write(`data: ${JSON.stringify(ev)}\n\n`);
}

module.exports = {
  emit,
  loadAll,
  persist,
  release,
  runs,
};
