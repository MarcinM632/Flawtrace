// Magazyn runów w pamięci i na dysku: mapa runów, zapis, odczyt przy starcie, strumień zdarzeń.
const path = require('path');
const fs = require('fs');
const { RUNS_DIR } = require('./config');

const runs = new Map(); // id -> { meta, events[], listeners:Set, proc }

function runFile(id) { return path.join(RUNS_DIR, id + '.json'); }
function persist(r) { fs.writeFileSync(runFile(r.meta.id), JSON.stringify({ meta: r.meta, events: r.events })); }
function loadAll() {
  for (const f of fs.readdirSync(RUNS_DIR).filter((x) => x.endsWith('.json'))) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), 'utf8'));
      if (d.meta.status === 'running') { d.meta.status = 'failed'; d.meta.error = 'Serwer zrestartowany w trakcie analizy'; }
      runs.set(d.meta.id, { meta: d.meta, events: d.events, listeners: new Set(), proc: null });
    } catch (_) { /* pomiń uszkodzony plik */ }
  }
}

function emit(r, ev) {
  ev.t = Date.now();
  r.events.push(ev);
  for (const res of r.listeners) res.write(`data: ${JSON.stringify(ev)}\n\n`);
}

module.exports = {
  emit,
  loadAll,
  persist,
  runs,
};
