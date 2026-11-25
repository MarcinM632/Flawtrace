// Adaptery źródeł → kanoniczny dokument bazy wiedzy (knowledge-base.js). Każdy odpytuje swój konektor i wypełnia te
// same sekcje. Konektory są wstrzykiwane (obiekt `conn`), więc adaptery testuje się na atrapach bez sieci. Sekcję bez
// danych zostawiamy pustą z notką w `notes[sekcja]`, zamiast ją pomijać albo zmyślać — kształt dokumentu jest stały.
const fs = require('fs');
const path = require('path');
const { emptyDoc } = require('./knowledge-base');

const firstPara = (s) => String(s || '').split(/\n\s*\n/).map((x) => x.trim()).find((x) => x && !x.startsWith('#')) || '';
const clip = (s, n = 200) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

/* ------------------------------------------------ Jira ------------------------------------------------ */
// conn: { url, projectKeys():[], projectClause(keys), jql(...parts), versions(key):[], searchAll(jql,fields,limit):[issues] }
async function jira(conn, { now = Date.now(), limit = 200 } = {}) {
  const keys = conn.projectKeys();
  const doc = emptyDoc({ source: 'jira', kind: 'issue-tracker', title: keys.length ? `Jira: ${keys.join(', ')}` : 'Jira', url: conn.url, now });
  const S = doc.sections;
  if (!keys.length) { doc.notes.components = 'nie podano kluczy projektów w Sources — ustaw pole Projects'; return doc; }
  const clause = conn.projectClause(keys);

  for (const k of keys) S.components.push({ name: k, detail: 'projekt Jira', ref: k });
  doc.sections.overview.push({ text: `Tracker zgłoszeń dla projektów: ${keys.join(', ')}.`, ref: keys[0] });

  // Funkcje = epiki. Przepływy = wydania (z dat). Ryzyka = najnowsze błędy. Ludzie = przypisani/zgłaszający.
  const epics = await conn.searchAll(conn.jql(clause, 'issuetype = Epic', 'ORDER BY created DESC'), ['summary', 'status', 'project'], limit).catch(() => []);
  for (const e of epics) S.capabilities.push({ name: clip(fld(e, 'summary'), 120), detail: fld(e, 'status', 'name'), ref: e.key });
  if (!epics.length) doc.notes.capabilities = 'brak epików w tych projektach (albo brak uprawnień)';

  const bugs = await conn.searchAll(conn.jql(clause, 'issuetype in (Bug, Defect)', 'ORDER BY created DESC'), ['summary', 'status', 'priority', 'created', 'assignee', 'reporter'], Math.min(limit, 100)).catch(() => []);
  const people = new Map();
  for (const b of bugs.slice(0, 60)) {
    S.risks.push({ text: clip(fld(b, 'summary'), 140), detail: [fld(b, 'priority', 'name'), fld(b, 'status', 'name')].filter(Boolean).join(', '), ref: b.key });
    for (const role of ['assignee', 'reporter']) { const u = fld(b, role); if (u && u.displayName) people.set(u.displayName, role === 'assignee' ? 'przypisany do zgłoszeń' : 'zgłaszający'); }
  }
  if (!bugs.length) doc.notes.risks = 'brak zgłoszeń typu Bug/Defect';
  for (const [name, role] of people) S.people.push({ name, role });

  for (const k of keys) {
    const vers = await conn.versions(k).catch(() => []);
    for (const v of vers.slice(0, 40)) S.references.push({ id: `${k}:${v.name}`, title: `${k} ${v.name}${v.released ? ' (wydane)' : ''}${v.releaseDate ? ' ' + v.releaseDate : ''}`, url: conn.url + '/projects/' + k + '?selectedItem=versions' });
    const released = vers.filter((v) => v.released).sort((a, b) => String(a.releaseDate).localeCompare(String(b.releaseDate)));
    if (released.length) S.flows.push({ name: `Linia wydań ${k}`, steps: released.slice(-6).map((v) => v.name), detail: `${vers.length} wersji`, ref: k });
  }
  doc.stats = { projects: keys.length, epics: epics.length, bugs: bugs.length, people: S.people.length };
  return doc;
}
const fld = (issue, name, sub) => { const v = issue && issue.fields ? issue.fields[name] : undefined; return sub && v ? v[sub] : v; };

/* --------------------------------------------- Confluence --------------------------------------------- */
// conn: { base, list(limit):[{id,title,space,updated}], page(id):{title,text,url,space}, glossaryLimit?, pageLimit? }
async function confluence(conn, { now = Date.now(), pages = 60, deepPages = 8 } = {}) {
  const doc = emptyDoc({ source: 'confluence', kind: 'wiki', title: 'Confluence', url: conn.base, now });
  const S = doc.sections;
  const list = await conn.list(pages).catch(() => []);
  if (!list.length) { doc.notes.references = 'brak stron (albo brak dostępu do przestrzeni)'; return doc; }
  const spaces = [...new Set(list.map((p) => p.space).filter(Boolean))];
  for (const sp of spaces) S.components.push({ name: sp, detail: 'przestrzeń Confluence', ref: sp });
  doc.sections.overview.push({ text: `Baza wiedzy produktu: ${list.length} stron w przestrzeniach ${spaces.join(', ') || '(domyślnych)'}.`, ref: spaces[0] || list[0].id });
  for (const p of list) {
    S.references.push({ id: p.id, title: p.title, url: p.url || '' });
    S.capabilities.push({ name: clip(p.title, 120), detail: p.space || '', ref: p.id });
  }
  // Strony wyglądające na przepływy/słownik/ryzyka czytamy głębiej (ograniczona liczba) i wyciągamy strukturę.
  const pick = (re) => list.filter((p) => re.test(p.title)).slice(0, deepPages);
  for (const p of pick(/flow|process|przepływ|proces|scenariu|journey|runbook/i)) {
    const full = await conn.page(p.id).catch(() => null);
    if (full) { const steps = headingsOrBullets(full.text).slice(0, 12); if (steps.length) S.flows.push({ name: clip(p.title, 100), steps, ref: p.id }); }
  }
  for (const p of pick(/glossary|dictionary|słownik|terminolog|definicj/i)) {
    const full = await conn.page(p.id).catch(() => null);
    if (full) for (const t of terms(full.text).slice(0, 80)) S.terms.push({ ...t, ref: p.id });
  }
  for (const p of pick(/incident|postmortem|post-mortem|known issue|znane problem|ryzyk|awari/i)) S.risks.push({ text: clip(p.title, 140), detail: p.space || '', ref: p.id });
  if (!S.flows.length) doc.notes.flows = 'nie znaleziono stron opisujących przepływy';
  if (!S.terms.length) doc.notes.terms = 'nie znaleziono strony ze słownikiem';
  doc.stats = { pages: list.length, spaces: spaces.length, flows: S.flows.length, terms: S.terms.length };
  return doc;
}
function headingsOrBullets(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const h = lines.filter((l) => /^#{1,4}\s+/.test(l)).map((l) => l.replace(/^#+\s+/, ''));
  if (h.length >= 2) return h;
  return lines.filter((l) => /^(\d+[.)]\s+|[-*]\s+)/.test(l)).map((l) => l.replace(/^(\d+[.)]|[-*])\s+/, '')).filter((l) => l.length > 2);
}
function terms(text) {
  const out = [];
  for (const l of String(text || '').split('\n').map((x) => x.trim())) {
    const m = /^[-*]?\s*\*{0,2}([A-Za-zÀ-ż0-9 _/-]{2,40})\*{0,2}\s*[-–—:]\s+(.{3,})$/.exec(l);
    if (m) out.push({ term: m[1].trim(), meaning: clip(m[2], 160) });
  }
  return out;
}

/* ------------------------------------------------ repo ------------------------------------------------ */
// repo: { name, path (lokalny katalog klona) }
async function repo(repoInfo, { now = Date.now() } = {}) {
  const root = repoInfo.path;
  const doc = emptyDoc({ source: 'repo:' + repoInfo.name, kind: 'repository', title: `Repozytorium: ${repoInfo.name}`, url: repoInfo.url || '', now });
  const S = doc.sections;
  const rd = (rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch (_) { return null; } };
  const exists = (rel) => { try { return fs.existsSync(path.join(root, rel)); } catch (_) { return false; } };

  // package.json → przegląd, komponenty (workspaces), liczby zależności.
  const pkg = (() => { try { return JSON.parse(rd('package.json') || '{}'); } catch (_) { return {}; } })();
  if (pkg.name || pkg.description) doc.sections.overview.push({ text: clip(pkg.description || pkg.name, 200), ref: 'package.json' });
  const deps = Object.keys(pkg.dependencies || {}).length, dev = Object.keys(pkg.devDependencies || {}).length;

  // Komponenty = katalogi najwyższego poziomu (bez szumu).
  let top = [];
  try { top = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && !/^\.|node_modules|dist|build|coverage|vendor|__pycache__/.test(e.name)).map((e) => e.name); } catch (_) { /* brak */ }
  for (const d of top.slice(0, 40)) S.components.push({ name: d + '/', detail: 'katalog', ref: d });
  if (!top.length) doc.notes.components = 'nie udało się odczytać katalogów repozytorium';

  // Przegląd z README (pierwszy akapit), dokumenty z docs/.
  const readme = rd('README.md') || rd('readme.md') || rd('README') || '';
  if (readme) doc.sections.overview.push({ text: clip(firstPara(readme), 300), ref: 'README.md' });
  else doc.notes.overview = 'brak README';
  for (const docDir of ['docs', 'doc']) if (exists(docDir)) {
    let mds = []; try { mds = fs.readdirSync(path.join(root, docDir)).filter((f) => /\.md$/i.test(f)); } catch (_) { /* brak */ }
    for (const f of mds.slice(0, 30)) { S.references.push({ id: `${docDir}/${f}`, title: `${docDir}/${f}`, url: '' }); S.capabilities.push({ name: f.replace(/\.md$/i, ''), detail: 'dokumentacja', ref: `${docDir}/${f}` }); }
  }

  // Ludzie z CODEOWNERS.
  for (const loc of ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS']) { const c = rd(loc); if (c) { for (const owner of [...new Set((c.match(/@[\w/-]+/g) || []))].slice(0, 30)) S.people.push({ name: owner, role: 'code owner', ref: loc }); break; } }

  // Specyfikacje API w repo → powierzchnia.
  for (const loc of ['openapi.json', 'openapi.yaml', 'swagger.json', 'api/openapi.json', 'docs/openapi.json']) if (exists(loc)) S.surfaces.push({ value: loc, detail: 'specyfikacja OpenAPI w repo', ref: loc });

  // Ryzyka = TODO/FIXME/HACK/XXX w kodzie (ograniczone, płytki przegląd).
  const marks = scanMarks(root, 4000);
  for (const m of marks.slice(0, 40)) S.risks.push({ text: clip(m.text, 140), detail: m.tag, ref: m.file });
  if (marks.length > 40) doc.notes.risks = `pokazano 40 z ${marks.length} znaczników TODO/FIXME`;
  else if (!marks.length) doc.notes.risks = 'brak znaczników TODO/FIXME w przejrzanych plikach';

  doc.stats = { topDirs: top.length, deps, devDeps: dev, docs: S.references.length, todos: marks.length };
  return doc;
}
const CODE_EXT = /\.(js|jsx|ts|tsx|py|go|rb|java|php|cs|rs|kt|swift|c|cc|cpp|h|scala|vue)$/i;
const SKIP_DIR = /^(\.|node_modules|dist|build|coverage|vendor|__pycache__|\.git)/;
function scanMarks(root, maxFiles) {
  const out = []; let seen = 0;
  const walk = (dir, depth) => {
    if (seen >= maxFiles || depth > 6) return;
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      if (out.length >= 200) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIR.test(e.name)) walk(full, depth + 1); continue; }
      if (!CODE_EXT.test(e.name) || seen >= maxFiles) continue;
      seen++;
      let txt; try { if (fs.statSync(full).size > 400000) continue; txt = fs.readFileSync(full, 'utf8'); } catch (_) { continue; }
      for (const m of txt.matchAll(/(?:\/\/|#|\/\*|<!--)\s*(TODO|FIXME|HACK|XXX|BUG)\b[:\s-]*(.{0,120})/gi)) out.push({ tag: m[1].toUpperCase(), text: m[2].trim() || '(bez opisu)', file: path.relative(root, full).split(path.sep).join('/') });
    }
  };
  walk(root, 0);
  return out;
}

/* ------------------------------------------------- API ------------------------------------------------- */
// model: sources.appModel() — { resources:[{path,name,groups,endpoints,can:[],needs:[],because:[],flow:[{step,endpoint}]}],
//   order:[], endpoints: liczba, titles:[], markdown }. raw: sources.catalogue().endpoints — surowe {method,path,groupLabel}.
function api(model, { now = Date.now(), raw = [] } = {}) {
  const doc = emptyDoc({ source: 'api', kind: 'api-spec', title: (model.titles && model.titles.join(', ')) || 'API', now });
  const S = doc.sections;
  const resources = model.resources || [];
  if (!resources.length) { doc.notes.components = 'pusty model API — wgraj specyfikację OpenAPI w Sources'; return doc; }
  doc.sections.overview.push({ text: `API z ${resources.length} zasobami i ${model.endpoints || raw.length} endpointami.`, ref: resources[0].path });
  if (model.order && model.order.length) doc.sections.flows.push({ name: 'Kolejność tworzenia danych testowych', steps: model.order, ref: resources[0].path });
  for (const r of resources) {
    S.components.push({ name: r.name, detail: r.path + (r.readOnly ? ' (tylko odczyt)' : ''), ref: r.path });
    S.capabilities.push({ name: r.name, detail: (r.can || []).join('; '), ref: r.path });
    S.dataModel.push({ entity: r.name, detail: (r.needs && r.needs.length) ? 'zależy od: ' + r.needs.join(', ') : '', ref: r.path });
    if (r.flow && r.flow.length > 1) S.flows.push({ name: `Cykl życia: ${r.name}`, steps: r.flow.map((f) => `${f.step} ${f.endpoint}`), ref: r.path });
  }
  for (const e of raw) S.surfaces.push({ value: `${e.method} ${e.path}`, detail: e.groupLabel || '', ref: e.path });
  if (!raw.length) doc.notes.surfaces = 'brak endpointów w katalogu specyfikacji';
  doc.notes.risks = 'ryzyka wykrywa silnik pentestowy, nie model API';
  doc.notes.people = 'specyfikacja API nie zawiera właścicieli';
  doc.notes.terms = 'specyfikacja API nie zawiera słownika';
  doc.stats = { resources: resources.length, endpoints: raw.length || model.endpoints || 0 };
  return doc;
}

module.exports = { jira, confluence, repo, api, _terms: terms, _scanMarks: scanMarks };
