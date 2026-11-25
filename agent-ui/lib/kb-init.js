// Inicjalizacja bazy wiedzy: po podłączeniu źródła w Sources (albo zmianie jego konfiguracji) uruchamia się budowa
// jednolitej bazy wiedzy dla tego serwisu — odpytuje go przez konektor, strukturyzuje dane i zapisuje dokument o stałym
// kształcie (knowledge-base.js). Budowa idzie w tle (sieć), jest wznawialna i ma status per serwis. Każdy serwis to
// osobny dokument o identycznych sekcjach, więc struktura agentów testujących opiera się na jednym kształcie.
const fs = require('fs');
const path = require('path');
const kb = require('./knowledge-base');
const adapters = require('./kb-adapters');

/**
 * create({ sources, knowledgeDir, now? })
 *   sources — moduł lib/sources (konektory i konfiguracja), knowledgeDir() — katalog bazy wiedzy.
 * Zwraca: { connectedServices, initService, initConnected, onSourcesSaved, status, doc }.
 */
function create({ sources, knowledgeDir, now = Date.now }) {
  const jobs = new Map(); // source -> { status:'queued'|'running'|'ready'|'error', startedAt, builtAt, error, stats, counts }
  // Jedna kolejka na WSZYSTKIE budowy: serwisy budują się po kolei, nigdy równocześnie — żeby pierwszy przebieg był
  // porządny i uporządkowany, a dwa wyzwalacze (auto po zapisie Sources + ręczna przebudowa) nie deptały sobie po danych.
  let chain = Promise.resolve();
  const serialize = (fn) => { const next = chain.then(fn, fn); chain = next.then(() => {}, () => {}); return next; };
  const storeFor = () => kb.store(knowledgeDir());
  const mark = (source, patch) => { jobs.set(source, { ...(jobs.get(source) || {}), source, ...patch }); };

  /** Serwisy aktualnie podłączone (każdy repo to osobny serwis). */
  function connectedServices() {
    const st = sources.status();
    const out = [];
    if (st.jira) out.push({ source: 'jira', kind: 'issue-tracker' });
    if (st.confluence) out.push({ source: 'confluence', kind: 'wiki' });
    if (st.api || st.endpoints > 0) out.push({ source: 'api', kind: 'api-spec' });
    for (const r of sources.repoList()) if (r.ready) out.push({ source: 'repo:' + r.name, kind: 'repository', repo: r });
    return out;
  }

  /** Buduje jeden serwis przez jego adapter. Błąd nie wywraca całości — zapisuje dokument ze statusem 'error'. */
  function initService(source) { return serialize(() => buildService(source)); }
  async function buildService(source) {
    const svc = connectedServices().find((s) => s.source === source);
    if (!svc) { const e = `serwis nie jest podłączony: ${source}`; mark(source, { status: 'error', error: e }); return { source, status: 'error', error: e }; }
    mark(source, { status: 'running', startedAt: now(), error: null });
    let doc;
    try {
      doc = await buildDoc(svc);
    } catch (e) {
      doc = kb.emptyDoc({ source, kind: svc.kind, now: now() });
      doc.status = 'error'; doc.error = String((e && e.message) || e);
    }
    const written = storeFor().writeDoc(doc);
    mark(source, { status: written.status, builtAt: written.builtAt, error: written.error, stats: written.stats, counts: written.counts });
    return { source, status: written.status, error: written.error, stats: written.stats, counts: written.counts };
  }

  function buildDoc(svc) {
    const t = now();
    if (svc.source === 'jira') {
      const conn = { url: sources.read().jira.url, projectKeys: sources.jiraProjectKeys, projectClause: sources.projectClause, jql: sources.jql, versions: sources.jiraVersions, searchAll: sources.jiraSearchAll };
      return adapters.jira(conn, { now: t });
    }
    if (svc.source === 'confluence') {
      const base = sources.read().confluence.url || (sources.read().jira.url ? sources.read().jira.url + '/wiki' : '');
      return adapters.confluence({ base, list: sources.confluenceList, page: sources.confluencePage }, { now: t });
    }
    if (svc.source === 'api') return Promise.resolve(adapters.api(sources.appModel(), { now: t, raw: (sources.catalogue && sources.catalogue().endpoints) || [] }));
    if (svc.kind === 'repository') return adapters.repo(svc.repo, { now: t });
    return Promise.resolve(kb.emptyDoc({ source: svc.source, kind: svc.kind, now: t }));
  }

  /** Buduje wszystkie podłączone serwisy PO KOLEI (nigdy równolegle), zapisuje README struktury, sprząta odłączone. */
  function initConnected({ only = null } = {}) {
    return serialize(async () => {
      const list = connectedServices().filter((s) => !only || only.includes(s.source));
      for (const s of list) mark(s.source, { status: 'queued' });
      const results = [];
      for (const s of list) results.push(await buildService(s.source)); // jeden serwis na raz, wprost (już w kolejce)
      // Serwisy, które zniknęły z konfiguracji (odłączone), usuwamy z bazy, żeby nie zostawały nieaktualne.
      const nowSet = new Set(connectedServices().map((s) => s.source));
      for (const old of Object.keys(storeFor().readIndex())) if (!nowSet.has(old)) { storeFor().remove(old); jobs.delete(old); }
      writeReadme();
      return results;
    });
  }

  /** Krótki opis struktury w services/README.md, żeby układ był od razu zrozumiały. */
  function writeReadme() {
    try {
      const idx = storeFor().readIndex();
      const rows = Object.values(idx).map((d) => `- \`${kb.slug(d.source)}.md\` — ${d.title || d.source} (${d.kind}, stan ${d.status})`).join('\n') || '- (brak serwisów — podłącz źródło w Sources)';
      const md = `# Baza wiedzy per serwis\n\nKażdy podłączony serwis (Jira, Confluence, repozytorium, API) ma TU jeden dokument o tej samej strukturze\nsekcji: ${kb.SECTION_KEYS.join(', ')}. Budowane automatycznie przy podłączeniu źródła, po kolei. Agenci testujący\nczytają te pliki tak jak resztę folderu wiedzy.\n\n## Serwisy\n\n${rows}\n`;
      fs.writeFileSync(path.join(storeFor().dir, 'README.md'), md);
    } catch (_) { /* best-effort */ }
  }

  /**
   * Wołane po zapisie Sources: porównuje stan przed i po i uruchamia w tle budowę dla serwisów nowo podłączonych lub
   * takich, których kluczowa konfiguracja się zmieniła (URL, projekty, przestrzenie, repo, specyfikacja). Zwraca listę
   * uruchomionych serwisów; sama budowa idzie w tle (nie blokuje odpowiedzi na zapis Sources).
   */
  function onSourcesSaved(before, after) {
    const changed = diffServices(before, after);
    if (changed.length) for (const s of changed) mark(s, { status: 'queued' });
    const run = changed.length ? initConnected({ only: changed }).catch(() => {}) : Promise.resolve();
    return { enqueued: changed, done: run };
  }

  function status() {
    const idx = storeFor().readIndex();
    const services = connectedServices().map((s) => {
      const j = jobs.get(s.source) || {}; const i = idx[s.source] || {};
      return { source: s.source, kind: s.kind, status: j.status || (i.builtAt ? 'ready' : 'not-built'), builtAt: i.builtAt || j.builtAt || null, error: j.error || i.error || null, stats: i.stats || j.stats || {}, counts: i.counts || {} };
    });
    return { services, schema: kb.SCHEMA, sections: kb.SECTION_KEYS };
  }

  const doc = (source) => storeFor().readDoc(source);
  return { connectedServices, initService, initConnected, onSourcesSaved, status, doc };
}

/** Które serwisy budować po zmianie Sources: porównanie konfiguracji przed/po (po stronie `read()`, nie zamaskowanego view). */
function diffServices(before = {}, after = {}) {
  const out = [];
  const key = (c, svc) => {
    if (svc === 'jira') return [c.jira && c.jira.url, c.jira && c.jira.token ? 1 : 0, c.jira && c.jira.projects].join('|');
    if (svc === 'confluence') return [c.confluence && c.confluence.url, c.confluence && c.confluence.token ? 1 : 0, c.confluence && c.confluence.spaces].join('|');
    if (svc === 'api') return [c.api && c.api.baseUrl, (c.api && c.api.specs || []).length, c.api && c.api.authValue ? 1 : 0].join('|');
    return '';
  };
  for (const svc of ['jira', 'confluence', 'api']) { const a = key(before, svc), b = key(after, svc); if (b !== a && b.replace(/[|0]/g, '')) out.push(svc); }
  // Repozytoria: po nazwie i URL.
  const repos = (c) => new Map((c.repos || []).map((r) => [r.name, r.url]));
  const rb = repos(before), ra = repos(after);
  for (const [name, url] of ra) if (rb.get(name) !== url) out.push('repo:' + name);
  return out;
}

module.exports = { create, diffServices };
