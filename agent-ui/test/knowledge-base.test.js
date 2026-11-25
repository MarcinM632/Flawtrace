// Jednolita baza wiedzy per serwis: kanoniczna struktura (te same sekcje dla każdego źródła), adaptery na atrapach
// konektorów, magazyn (json+md+index), orkiestrator auto-inicjalizacji i diff zmian w Sources.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const kb = require('../lib/knowledge-base');
const adapters = require('../lib/kb-adapters');
const kbInit = require('../lib/kb-init');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kb-'));
const hasAllSections = (doc) => { for (const k of kb.SECTION_KEYS) assert.ok(Array.isArray(doc.sections[k]), 'brak sekcji ' + k); };

test('schemat: normalize dopełnia wszystkie sekcje, odrzuca nieznane, liczy counts; markdown ma stałe nagłówki', () => {
  const d = kb.normalize({ source: 'x', kind: 'k', sections: { overview: [{ text: 'hi' }], bogus: [{ a: 1 }] } });
  hasAllSections(d);
  assert.equal(d.sections.bogus, undefined, 'nieznana sekcja usunięta');
  assert.equal(d.counts.overview, 1);
  const md = kb.renderMarkdown(d);
  for (const [, title] of kb.SECTIONS) assert.ok(md.includes('## ' + title), 'nagłówek ' + title);
  assert.match(md, /_brak danych z tego źródła_/, 'pusta sekcja ma notkę');
});

test('adapter Jira: projekty→komponenty, epiki→funkcje, bugi→ryzyka, wersje→przepływy/źródła, ludzie z bugów', async () => {
  const issues = {
    'issuetype = Epic': [{ key: 'PRJ-1', fields: { summary: 'Checkout', status: { name: 'In Progress' } } }],
    'issuetype in (Bug, Defect)': [{ key: 'PRJ-9', fields: { summary: 'Null on pay', status: { name: 'Open' }, priority: { name: 'High' }, assignee: { displayName: 'Ann' }, reporter: { displayName: 'Bob' } } }],
  };
  const conn = {
    url: 'https://x.atlassian.net', projectKeys: () => ['PRJ'], projectClause: (k) => `project in (${k.join(',')})`, jql: (...p) => p.filter(Boolean).join(' AND '),
    versions: async () => [{ name: '1.0', released: true, releaseDate: '2026-01-01' }, { name: '1.1', released: false }],
    searchAll: async (q) => issues[Object.keys(issues).find((k) => q.includes(k))] || [],
  };
  const doc = await adapters.jira(conn);
  hasAllSections(doc);
  assert.deepEqual(doc.sections.components.map((c) => c.name), ['PRJ']);
  assert.equal(doc.sections.capabilities[0].name, 'Checkout');
  assert.equal(doc.sections.risks[0].ref, 'PRJ-9');
  assert.deepEqual(doc.sections.people.map((p) => p.name).sort(), ['Ann', 'Bob']);
  assert.ok(doc.sections.flows.some((f) => f.steps.includes('1.0')));
  assert.equal(doc.stats.epics, 1); assert.equal(doc.stats.bugs, 1);
});

test('adapter Confluence: przestrzenie→komponenty, strony→funkcje/źródła, strona „Glossary” → słownik, „Flow” → przepływ', async () => {
  const list = [{ id: '1', title: 'Payments Flow', space: 'PAY' }, { id: '2', title: 'Glossary', space: 'PAY' }, { id: '3', title: 'Home', space: 'DOC' }];
  const page = async (id) => ({ 1: { text: '1. Add to cart\n2. Pay\n3. Confirm' }, 2: { text: '- **SKU** — stock keeping unit\n- **PDP** — product page' } }[id] || { text: '' });
  const doc = await adapters.confluence({ base: 'https://x/wiki', list: async () => list, page });
  hasAllSections(doc);
  assert.deepEqual(doc.sections.components.map((c) => c.name).sort(), ['DOC', 'PAY']);
  assert.equal(doc.sections.references.length, 3);
  assert.ok(doc.sections.flows.some((f) => f.name.includes('Payments Flow') && f.steps.length === 3));
  assert.deepEqual(doc.sections.terms.map((t) => t.term).sort(), ['PDP', 'SKU']);
});

test('adapter API: zasoby→komponenty/model danych, surowe endpointy→powierzchnia, cykl życia→przepływ', () => {
  const model = { titles: ['Shop API'], order: ['/orders'], endpoints: 2, resources: [{ name: 'orders', path: '/orders', groups: [], can: ['list: get_orders', 'create: post_orders'], needs: ['users'], because: ['{userId} w ścieżce'], flow: [{ step: 'create', endpoint: 'post_orders' }, { step: 'read', endpoint: 'get_orders_id' }], readOnly: false }] };
  const raw = [{ method: 'GET', path: '/orders', groupLabel: 'shop' }, { method: 'POST', path: '/orders', groupLabel: 'shop' }];
  const doc = adapters.api(model, { raw });
  hasAllSections(doc);
  assert.equal(doc.sections.components[0].name, 'orders');
  assert.deepEqual(doc.sections.surfaces.map((s) => s.value), ['GET /orders', 'POST /orders']);
  assert.ok(doc.sections.flows.some((f) => /Cykl życia: orders/.test(f.name) && f.steps.join(' ').includes('create post_orders')));
  assert.ok(doc.sections.flows.some((f) => /Kolejność tworzenia/.test(f.name)));
  assert.match(doc.sections.dataModel[0].detail, /zależy od: users/);
});

test('adapter repo: katalogi→komponenty, README→przegląd, CODEOWNERS→ludzie, TODO→ryzyka, openapi→powierzchnia', async () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'src')); fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'shop', description: 'Shop service', dependencies: { a: '1' } }));
  fs.writeFileSync(path.join(root, 'README.md'), '# Shop\n\nThe shop backend.\n');
  fs.writeFileSync(path.join(root, 'CODEOWNERS'), '* @team-shop\n/src @ann\n');
  fs.writeFileSync(path.join(root, 'openapi.json'), '{}');
  fs.writeFileSync(path.join(root, 'docs', 'arch.md'), '# arch');
  fs.writeFileSync(path.join(root, 'src', 'pay.js'), 'function pay(){} // TODO: handle refunds\n// FIXME: race on retry\n');
  const doc = await adapters.repo({ name: 'shop', path: root, url: 'https://git/shop' });
  hasAllSections(doc);
  assert.ok(doc.sections.components.some((c) => c.name === 'src/'));
  assert.ok(doc.sections.overview.some((o) => /shop backend/i.test(o.text)));
  assert.ok(doc.sections.people.some((p) => p.name === '@ann'));
  assert.ok(doc.sections.surfaces.some((s) => s.value === 'openapi.json'));
  assert.deepEqual(doc.sections.risks.map((r) => r.detail).sort(), ['FIXME', 'TODO']);
  assert.equal(doc.stats.deps, 1);
});

test('magazyn: zapis tworzy json+md+index; każdy dokument tego samego kształtu', () => {
  const dir = tmp();
  const store = kb.store(dir);
  store.writeDoc(adapters.api({ titles: ['A'], resources: [{ name: 'x', path: '/x', ops: {}, needs: new Set() }] }));
  assert.ok(fs.existsSync(path.join(dir, 'services', 'api.json')));
  assert.ok(fs.existsSync(path.join(dir, 'services', 'api.md')));
  const idx = store.readIndex();
  assert.equal(idx.api.kind, 'api-spec'); assert.equal(idx.api.status, 'ready');
  store.remove('api');
  assert.equal(store.readDoc('api'), null);
  assert.deepEqual(store.readIndex(), {});
});

test('diff: tylko nowo podłączone/zmienione serwisy; sam token bez reszty nie liczy się jako zmiana treści', () => {
  const d = kbInit.diffServices;
  assert.deepEqual(d({}, { jira: { url: 'https://x', token: 't', projects: 'PRJ' } }), ['jira']);
  assert.deepEqual(d({ jira: { url: 'https://x', token: 't', projects: 'PRJ' } }, { jira: { url: 'https://x', token: 't', projects: 'PRJ' } }), [], 'bez zmian');
  assert.deepEqual(d({ jira: { url: 'https://x', token: 't', projects: 'PRJ' } }, { jira: { url: 'https://x', token: 't', projects: 'PRJ SVC' } }), ['jira'], 'zmiana projektów');
  assert.deepEqual(d({ repos: [{ name: 'a', url: 'g/a' }] }, { repos: [{ name: 'a', url: 'g/a' }, { name: 'b', url: 'g/b' }] }), ['repo:b']);
  assert.deepEqual(d({}, {}), []);
});

test('orkiestrator: buduje podłączone serwisy, status per serwis, onSourcesSaved kolejkuje zmienione, odłączony znika', async () => {
  const dir = tmp();
  let config = { jira: { url: '', token: '', projects: '' }, confluence: { url: '', token: '', spaces: '' }, api: { baseUrl: '', specs: [] }, repos: [] };
  const sources = {
    read: () => config,
    status: () => ({ jira: !!config.jira.url, confluence: !!config.confluence.url, api: false, endpoints: 0 }),
    repoList: () => [],
    jiraProjectKeys: () => config.jira.projects.split(/\s+/).filter(Boolean),
    projectClause: (k) => `project in (${k.join(',')})`, jql: (...p) => p.filter(Boolean).join(' AND '),
    jiraVersions: async () => [], jiraSearchAll: async () => [],
  };
  const engine = kbInit.create({ sources, knowledgeDir: () => dir });
  assert.deepEqual(engine.connectedServices(), []);
  const before = { ...config, jira: { ...config.jira } };
  config.jira = { url: 'https://x', token: 't', projects: 'PRJ' };
  const { enqueued, done } = engine.onSourcesSaved(before, config);
  assert.deepEqual(enqueued, ['jira']);
  await done;
  const st = engine.status();
  const j = st.services.find((s) => s.source === 'jira');
  assert.equal(j.status, 'ready');
  assert.ok(fs.existsSync(path.join(dir, 'services', 'jira.json')));
  assert.deepEqual(st.sections, kb.SECTION_KEYS, 'status ujawnia kanoniczne sekcje');
  // odłączenie Jiry → znika z bazy przy kolejnej inicjalizacji
  config.jira = { url: '', token: '', projects: '' };
  await engine.initConnected();
  assert.equal(engine.doc('jira'), null);
});
