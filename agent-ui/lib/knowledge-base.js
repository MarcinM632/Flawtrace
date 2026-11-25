// Jednolita baza wiedzy o aplikacji, budowana osobno dla KAŻDEGO podłączonego źródła (Jira, Confluence, repozytorium,
// specyfikacja API) i zawsze w TEJ SAMEJ strukturze. Dzięki temu struktura agentów testujących opiera się na jednym,
// przewidywalnym kształcie, niezależnie od tego, z jakiego serwisu pochodzą dane — nie ma jednego agenta „od trzech
// różnych apek”, jest jedna baza per serwis o identycznych sekcjach.
//
// Każdy dokument ma te same sekcje (SECTIONS). Adapter źródła wypełnia je tym, co faktycznie w serwisie jest; sekcję,
// której dane źródło nie dostarcza, zostawia pustą z notką „dlaczego” (uczciwie, zamiast zmyślać). Każda pozycja ma
// `ref` — skąd pochodzi (klucz ticketu, id strony, ścieżka pliku, endpoint), więc baza jest sprawdzalna.
const fs = require('fs');
const path = require('path');

const SCHEMA = 1;
// Kolejność i znaczenie sekcji — wspólne dla wszystkich źródeł.
const SECTIONS = [
  ['overview', 'Przegląd', 'czym jest ten serwis/moduł i do czego służy'],
  ['components', 'Komponenty', 'moduły aplikacji: projekty Jiry, przestrzenie Confluence, foldery repo, grupy zasobów API'],
  ['capabilities', 'Funkcje', 'co aplikacja robi: epiki, opisane funkcje, zasoby API'],
  ['flows', 'Przepływy', 'przepływy i cykle życia: kroki w kolejności, warunki wstępne'],
  ['surfaces', 'Powierzchnia', 'co da się testować: endpointy, trasy, strony'],
  ['dataModel', 'Model danych', 'encje/zasoby i ich pola'],
  ['risks', 'Ryzyka', 'błędy, kruche obszary, TODO/FIXME, uwagi bezpieczeństwa'],
  ['terms', 'Słownik', 'terminy specyficzne dla produktu i ich znaczenie'],
  ['people', 'Ludzie', 'właściciele, role, zespoły'],
  ['references', 'Źródła', 'dokumenty źródłowe: strony, tickety, pliki, specyfikacje'],
];
const SECTION_KEYS = SECTIONS.map((s) => s[0]);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** Pusty dokument o pełnej, poprawnej strukturze (wszystkie sekcje obecne). */
function emptyDoc({ source, kind, title = '', url = '', now = Date.now() }) {
  const sections = {}; const notes = {};
  for (const k of SECTION_KEYS) { sections[k] = []; }
  return { schema: SCHEMA, source, kind, title, url, builtAt: now, status: 'ready', error: null, stats: {}, notes, sections };
}

/** Dopełnia brakujące sekcje i normalizuje — każdy dokument z adaptera przechodzi przez to przed zapisem. */
function normalize(doc) {
  const d = { schema: SCHEMA, source: '', kind: '', title: '', url: '', builtAt: Date.now(), status: 'ready', error: null, stats: {}, notes: {}, sections: {}, ...doc };
  d.sections = d.sections || {};
  for (const k of SECTION_KEYS) if (!Array.isArray(d.sections[k])) d.sections[k] = [];
  // Odrzuć nieznane sekcje (gwarancja jednolitości kształtu).
  for (const k of Object.keys(d.sections)) if (!SECTION_KEYS.includes(k)) delete d.sections[k];
  d.counts = Object.fromEntries(SECTION_KEYS.map((k) => [k, d.sections[k].length]));
  return d;
}

/** Jednolity Markdown — ten sam układ nagłówków dla każdego serwisu. */
function renderMarkdown(doc) {
  const d = normalize(doc);
  const out = [`# Baza wiedzy — ${d.title || d.source}`, '', `- Źródło: \`${d.source}\` (${d.kind})${d.url ? ` — ${d.url}` : ''}`, `- Zbudowano: ${new Date(d.builtAt).toISOString()}`, `- Stan: ${d.status}${d.error ? ` (${d.error})` : ''}`];
  if (Object.keys(d.stats).length) out.push(`- Liczby: ${Object.entries(d.stats).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  out.push('');
  for (const [key, title] of SECTIONS) {
    out.push(`## ${title}`);
    const items = d.sections[key];
    if (!items.length) { out.push(`_${d.notes[key] || 'brak danych z tego źródła'}_`, ''); continue; }
    for (const it of items) out.push('- ' + itemLine(key, it));
    out.push('');
  }
  return out.join('\n');
}
function itemLine(key, it) {
  const ref = it.ref ? ` _(${it.ref})_` : '';
  if (key === 'terms') return `**${it.term}** — ${it.meaning || ''}${ref}`;
  if (key === 'people') return `${it.name}${it.role ? ` — ${it.role}` : ''}${ref}`;
  if (key === 'references') return `[${it.title || it.id}](${it.url || ''})`;
  if (key === 'flows') return `**${it.name}**${it.steps && it.steps.length ? ': ' + it.steps.join(' → ') : ''}${it.detail ? ` — ${it.detail}` : ''}${ref}`;
  if (key === 'surfaces') return `\`${it.value}\`${it.detail ? ` — ${it.detail}` : ''}${ref}`;
  const head = it.name || it.title || it.text || '';
  return `${head}${it.detail ? ` — ${it.detail}` : ''}${ref}`;
}

/* ------------------------------------------- magazyn ------------------------------------------- */
// <knowledge>/services/<slug>.json + .md, oraz index.json ze statusem każdego serwisu.
function store(knowledgeDir) {
  const dir = path.join(knowledgeDir, 'services');
  const idxFile = path.join(dir, 'index.json');
  const ensure = () => fs.mkdirSync(dir, { recursive: true });
  const fileFor = (source) => path.join(dir, slug(source) + '.json');
  function writeDoc(doc) {
    ensure();
    const d = normalize(doc);
    fs.writeFileSync(fileFor(d.source), JSON.stringify(d, null, 2));
    fs.writeFileSync(path.join(dir, slug(d.source) + '.md'), renderMarkdown(d));
    const idx = readIndex();
    idx[d.source] = { source: d.source, kind: d.kind, title: d.title, url: d.url, status: d.status, error: d.error, builtAt: d.builtAt, stats: d.stats, counts: d.counts };
    fs.writeFileSync(idxFile, JSON.stringify(idx, null, 2));
    return d;
  }
  function readIndex() { try { return JSON.parse(fs.readFileSync(idxFile, 'utf8')); } catch (_) { return {}; } }
  function readDoc(source) { try { return JSON.parse(fs.readFileSync(fileFor(source), 'utf8')); } catch (_) { return null; } }
  function remove(source) { for (const ext of ['.json', '.md']) try { fs.unlinkSync(path.join(dir, slug(source) + ext)); } catch (_) { /* brak */ } const idx = readIndex(); delete idx[source]; try { ensure(); fs.writeFileSync(idxFile, JSON.stringify(idx, null, 2)); } catch (_) { /* brak */ } }
  return { dir, writeDoc, readDoc, readIndex, remove, fileFor };
}

module.exports = { SCHEMA, SECTIONS, SECTION_KEYS, emptyDoc, normalize, renderMarkdown, store, slug };
