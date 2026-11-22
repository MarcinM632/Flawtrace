// Selekcja testów po zmianie (test impact analysis). Mając listę zmienionych ścieżek (z diffa serwisu) i listę
// testów z tym, czego dotykają, APLIKACJA deterministycznie wybiera podzbiór, który trzeba uruchomić dla tej zmiany
// — żeby bramka CI była szybka i tania, a nie odpalała całego zestawu przy każdym merge. Wzorowane na decisionFilter
// z frameworka e2e: pomiń testy, których zmiana na pewno nie dotyczy; w razie wątpliwości URUCHOM (bezpieczny domysł).
//
// Zasada bezpieczeństwa (nadrzędna): fałszywe pominięcie testu, który wykryłby regresję, jest gorsze niż jedno
// zbędne uruchomienie. Dlatego: test bez znanego mapowania ZAWSZE się uruchamia; zmiana „szeroka" (np. lockfile,
// CI, konfiguracja budowania) uruchamia WSZYSTKO; pominięty jest tylko test, o którym wiemy, że nic go nie dotyczy.
const path = require('path');

// Ścieżki, których zmiana każe odpalić CAŁY zestaw (nie da się ich bezpiecznie przypisać do podzbioru testów).
const BROAD = [
  /(^|\/)package(-lock)?\.json$/i, /(^|\/)pnpm-lock\.yaml$/i, /(^|\/)yarn\.lock$/i, /(^|\/)poetry\.lock$/i,
  /(^|\/)requirements[^/]*\.txt$/i, /(^|\/)pom\.xml$/i, /(^|\/)build\.gradle(\.kts)?$/i, /(^|\/)go\.(mod|sum)$/i,
  /(^|\/)Dockerfile$/i, /(^|\/)docker-compose\.ya?ml$/i, /(^|\/)\.github\//i, /(^|\/)\.gitlab-ci\.ya?ml$/i,
  /(^|\/)tsconfig[^/]*\.json$/i, /(^|\/)playwright\.config\.[jt]s$/i, /(^|\/)jest\.config\.[jt]s$/i,
  /(^|\/)\.env/i, /(^|\/)Makefile$/i, /(^|\/)webpack\.config\.[jt]s$/i, /(^|\/)vite\.config\.[jt]s$/i,
];
const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.?\//, '').trim();
const base = (p) => path.posix.basename(norm(p));
// Rdzeń nazwy pliku bez rozszerzenia i typowych sufiksów testów/typów, do dopasowania „plik ↔ test".
const stem = (p) => base(p).replace(/\.(spec|test|e2e|cy|stories)\.[a-z]+$/i, '').replace(/\.[a-z0-9]+$/i, '')
  .replace(/(Controller|Service|Repository|Handler|Component|Page|View|Model|Dto|Mapper|Client|Util|Helper)s?$/i, '')
  .toLowerCase();
// Tokeny (fragmenty ścieżki) do porównania obszarów: katalogi + rdzeń nazwy, bez śmieciowych segmentów.
const SKIP_SEG = new Set(['src', 'main', 'test', 'tests', 'java', 'kotlin', 'ts', 'js', 'app', 'lib', 'com', 'org', 'io', 'net', 'pkg', 'internal', 'api', 'web', 'ui']);
function tokens(p) {
  const n = norm(p);
  const segs = n.split('/').slice(0, -1).filter((s) => s && !SKIP_SEG.has(s.toLowerCase()));
  const out = new Set(segs.map((s) => s.toLowerCase()));
  const s = stem(p); if (s && s.length >= 3) out.add(s);
  return out;
}

/** Zmieniona ścieżka „dotyka" testu, gdy: zmieniono sam plik testu, test jawnie deklaruje tę ścieżkę/obszar w
 *  `touches`, albo ścieżki dzielą znaczący token (ten sam komponent/obszar). */
function affects(changed, test) {
  const c = norm(changed);
  const tf = norm(test.file || '');
  if (tf && (c === tf || base(c) === base(tf))) return 'test file changed';
  for (const t of test.touches || []) {
    const tn = norm(t);
    if (!tn) continue;
    if (c === tn || c.startsWith(tn.replace(/\/?$/, '/')) || tn.startsWith(c.replace(/\/?$/, '/')) || base(c) === base(tn)) return `touches ${t}`;
  }
  const ct = tokens(c), tt = new Set([...tokens(tf), ...(test.touches || []).flatMap((x) => [...tokens(x)]), ...(test.areas || []).map((a) => String(a).toLowerCase())]);
  for (const tok of ct) if (tt.has(tok)) return `shared area "${tok}"`;
  const cs = stem(c);
  if (cs && cs.length >= 3 && stem(tf) === cs) return `same unit "${cs}"`;
  return null;
}

/**
 * @param changedPaths string[] — zmienione pliki (np. z `git diff --name-only`).
 * @param tests        Array<{id, file?, touches?:string[], areas?:string[], markers?:string[], always?:boolean}>
 * @param opts         { onEmptyChange?: 'all'|'none' } — co zrobić, gdy nie znamy zmian (domyślnie 'all').
 * @returns { run:[{id,reason}], skip:[{id}], total, selected, ratio, broad:boolean, reasonAll?:string }
 */
function select(changedPaths, tests, opts = {}) {
  const list = Array.isArray(tests) ? tests.filter((t) => t && t.id != null) : [];
  const changed = (Array.isArray(changedPaths) ? changedPaths : []).map(norm).filter(Boolean);
  const runAll = (reasonAll) => ({ run: list.map((t) => ({ id: t.id, reason: reasonAll })), skip: [], total: list.length, selected: list.length, ratio: 1, broad: true, reasonAll });
  if (!changed.length) return opts.onEmptyChange === 'none'
    ? { run: [], skip: list.map((t) => ({ id: t.id })), total: list.length, selected: 0, ratio: 0, broad: false }
    : runAll('no change information: running the whole suite');
  const broad = changed.find((c) => BROAD.some((re) => re.test(c)));
  if (broad) return runAll(`a broad change (${base(broad)}) can affect anything`);
  const run = [], skip = [];
  for (const t of list) {
    // „Zmapowany" znaczy: wiemy, co test ćwiczy (touches/areas). Sam plik testu tego nie mówi, więc bez mapowania
    // test uruchamiamy zawsze (bezpieczny domysł) — a zmianę samego pliku testu i tak obejmuje to uruchomienie.
    const mapped = (t.touches && t.touches.length) || (t.areas && t.areas.length);
    if (t.always || !mapped) { run.push({ id: t.id, reason: t.always ? 'marked always-run' : 'no mapping: run to be safe' }); continue; }
    let why = null;
    for (const c of changed) { why = affects(c, t); if (why) break; }
    if (why) run.push({ id: t.id, reason: why }); else skip.push({ id: t.id });
  }
  return { run, skip, total: list.length, selected: run.length, ratio: list.length ? run.length / list.length : 0, broad: false };
}

/** Parsuje `git diff --name-only` / `--name-status` albo listę ścieżek po jednej na linię. */
function changedFromDiff(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^[AMDRCTU]\d*\t(.+)$/); // name-status: "M\tpath" albo "R100\told\tnew"
    if (m) { const parts = m[1].split('\t'); out.push(parts[parts.length - 1]); continue; }
    if (/^(diff --git|index |---|\+\+\+|@@)/.test(line)) continue; // pełny diff: pomiń nagłówki
    out.push(line);
  }
  return [...new Set(out.map(norm).filter(Boolean))];
}

/** Jedno zdanie do raportu/UI: ile uruchomić z ilu i dlaczego. */
function summary(sel) {
  if (!sel || !sel.total) return 'Test impact: no tests to consider.';
  if (sel.broad) return `Test impact: running all ${sel.total} tests — ${sel.reasonAll}.`;
  const pct = Math.round(sel.ratio * 100);
  return `Test impact: ${sel.selected}/${sel.total} tests selected (${pct}%); ${sel.skip.length} unaffected by this change.`;
}

module.exports = { select, changedFromDiff, summary, _affects: affects, _tokens: tokens, BROAD };
