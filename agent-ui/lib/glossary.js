// Słowniki zespołu dla QA MCP: slowniki/slownik_tlumaczen.md (co znaczy słowo) i slowniki/slownik_zakazow.md (czego nie
// robić). Wpis "## słowo, słowo" trafia do system promptu, gdy któreś z jego słów jest w zleceniu; narzędzia wymienione we
// wpisie tłumaczeń ładują swoje grupy. Pliki czytane przy każdym runie, więc tester edytuje je bez restartu serwera.
// Powód: "usuń LP z test_env" nie ładowało narzędzi LP z PLAT Admin, a agent sięgał po narzędzia CORE (runy 073101, 073244).
const fs = require('fs');
const path = require('path');
const { APP_DIR } = require('./config');

const DIR = path.join(APP_DIR, 'slowniki');
const FILES = { tlumaczenia: 'slownik_tlumaczen.md', zakazy: 'slownik_zakazow.md' };

/** Wpisy pliku: [{ terms, body }]. Tekst nad pierwszym "## " to opis dla testera, nie wpis. */
function entries(file) {
  let md;
  try { md = fs.readFileSync(path.join(DIR, file), 'utf8'); } catch (_) { return []; }
  return md.split(/^## /m).slice(1).map((chunk) => {
    const nl = chunk.indexOf('\n');
    const head = nl < 0 ? chunk : chunk.slice(0, nl);
    return { terms: head.split(',').map((t) => t.trim()).filter(Boolean), body: (nl < 0 ? '' : chunk.slice(nl + 1)).trim() };
  }).filter((e) => e.terms.length && e.body);
}

// Słowo łapie od początku wyrazu, więc "LP" łapie też "LPs" i "LP-ów"; spacja w słowie dopuszcza spację, "_" albo "-".
const termRe = (t) => new RegExp('(?<![\\p{L}\\p{N}])' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s_-]*'), 'iu');
const matching = (list, text) => list.filter((e) => e.terms.some((t) => termRe(t).test(text)));

/** Dopasowane wpisy obu słowników dla treści zlecenia. */
function glossaryFor(text) {
  const s = String(text || '');
  return { tlumaczenia: matching(entries(FILES.tlumaczenia), s), zakazy: matching(entries(FILES.zakazy), s) };
}

/** Grupy narzędzi z dopasowanych tłumaczeń (zakazy niczego nie ładują). */
function glossaryGroups(text, tg) {
  const groups = new Set();
  for (const e of glossaryFor(text).tlumaczenia)
    for (const n of e.body.match(/\b(?:admin|manager|core)_[a-z0-9_]+\b/g) || []) if (tg.tools[n]) groups.add(tg.tools[n]);
  return groups;
}

/** Blok do system promptu QA MCP; pusty, gdy nic nie pasuje. */
function glossaryPrompt(g) {
  if (!g.tlumaczenia.length && !g.zakazy.length) return '';
  const fmt = (e) => `### ${e.terms.join(', ')}\n${e.body}`;
  return '\n\nSŁOWNIK ZESPOŁU (nadrzędny przy wyborze systemu i narzędzi; wpisy dobrane do słów z tego zlecenia):'
    + (g.tlumaczenia.length ? '\n\nZNACZENIE SŁÓW:\n' + g.tlumaczenia.map(fmt).join('\n\n') : '')
    + (g.zakazy.length ? '\n\nZAKAZY:\n' + g.zakazy.map(fmt).join('\n\n') : '');
}

module.exports = { glossaryFor, glossaryGroups, glossaryPrompt };
