// Wyrocznia i śledzalność projektu testów (Test design), sprawdzane przez aplikację, bez modelu.
//
// 1. Źródło każdego oczekiwanego wyniku: każde "(src: ...)" checka jest rozwiązywane — klucz Jiry musi być w
//    tickecie albo w pobranych materiałach, endpoint w zaimportowanej specyfikacji, bug w rejestrze błędów, wpis
//    "kb:<serwis>#<sekcja>" w bazie wiedzy serwisu. Check, którego żadne źródło się nie rozwiązuje, ma wynik
//    oczekiwany bez pokrycia w źródłach — wraca do agenta: popraw odwołanie albo przenieś do "To confirm".
// 2. Macierz śledzalności (ISTQB: test basis → warunek → przypadek): przypadek biznesowy → punkt → check →
//    źródła (ze statusem) → elementy pokrycia technik.
// 3. Pokrycie technik liczone przez lib/test-techniques.js: punkt, który deklaruje technikę, musi przywołać
//    policzone elementy pokrycia ("ci: BVA:post-orders:quantity:max+1"), wszystkie wymagane elementy celu muszą
//    być pokryte albo świadomie wpisane do "Not covered:" / "To confirm", a oczekiwany wynik checka nie może
//    przeczyć wyroczni elementu (np. "201 created" dla wartości poza zakresem). Luki w regułach (kolumna tablicy
//    decyzyjnej bez reguły, nieosiągalny stan) to defekty wymagania — muszą trafić do "To confirm".
const fs = require('fs');
const path = require('path');
const tech = require('./test-techniques');

const PROOF_RE = /^[A-Za-z0-9_./-]*[A-Za-z0-9_-]\.[A-Za-z][A-Za-z0-9]{0,5}:\d+(?:-\d+)?$/;
const REJECT = /\b(4\d\d|reject(?:ed|s)?|refus\w*|errors?|invalid|denied|not allowed|forbidden|conflict|fails?|validation|unchanged|nothing (?:is )?(?:stored|saved|created))\b/i;
const ACCEPT = /\b(2\d\d|accept(?:ed|s)?|created|succe\w*|saved|stored|ok)\b/i;
const TECH_OF = [
  [/\bbva\b|boundary/i, 'BVA'],
  [/equivalence|partition|\bep\b/i, 'EP'],
  [/decision/i, 'DT'],
  [/state/i, 'ST'],
  [/pairwise|all[- ]pairs|combinatorial/i, 'PW'],
];

/* ------------------------------------------------ parsowanie raportu ------------------------------------------------ */
/** Punkty i checki projektu z numerem linii, techniką z nagłówka, "Not covered:" i tekstem "To confirm". */
function parse(report) {
  const out = { sections: [], confirm: '', businessCases: [] };
  let sec = null, mode = 'head', last = null;
  for (const raw of String(report || '').split('\n')) {
    const t = raw.trim();
    const bcl = t.match(/^Business cases:\s*(.*)$/i);
    if (bcl) {
      for (const part of bcl[1].split('|')) {
        const m = part.match(/\b(BC\d+)\b(.*?)(?:→|->)\s*(.+)$/);
        if (m) out.businessCases.push({ id: m[1], situation: m[2].trim(), sections: [...m[3].matchAll(/§\s*(\d+)/g)].map((x) => +x[1]), toConfirm: /to confirm/i.test(m[3]) });
      }
      continue;
    }
    const h = t.match(/^##\s+(\d+)\.\s+(.*?)\s*(?:\[([^\]]+)\])?\s*$/);
    if (h) { sec = { n: +h[1], title: h[2], technique: h[3] || '', techniques: [], checks: [], notCovered: '' }; sec.techniques = TECH_OF.filter(([re]) => re.test(sec.technique)).map(([, k]) => k); out.sections.push(sec); mode = 'sec'; last = null; continue; }
    if (/^##\s+To confirm/i.test(t)) { mode = 'confirm'; continue; }
    if (/^##\s+/.test(t)) { mode = 'other'; continue; }
    if (mode === 'confirm') { out.confirm += t + '\n'; continue; }
    if (mode !== 'sec' || !sec || !t) continue;
    const nc = t.match(/^Not covered:\s*(.*)$/i);
    if (nc) { sec.notCovered += nc[1] + '\n'; continue; }
    const b = t.match(/^[-*]\s+(.*)$/);
    if (b && /=>/.test(b[1])) { last = { text: b[1] }; sec.checks.push(last); continue; }
    if (last && !b) last.text += ' ' + t;
  }
  for (const s of out.sections) {
    s.checks = s.checks.map((c, i) => {
      const sm = c.text.match(/\(src:\s*([^)]*)\)\s*$/) || c.text.match(/\(src:\s*([^)]*)\)/);
      const src = sm ? sm[1] : '';
      const body = sm ? c.text.slice(0, sm.index) : c.text;
      const [action, ...rest] = body.split(/\s*=>\s*/);
      return { n: i + 1, ref: `§${s.n}.${i + 1}`, action: action.trim(), expected: rest.join(' => ').trim(), src, ci: tech.ciRefs(src) };
    });
  }
  return out;
}

/* ------------------------------------------------ kontekst źródeł ------------------------------------------------ */
function readTexts(dir, max = 4e6) {
  let acc = '';
  let list = [];
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return acc; }
  for (const e of list) {
    if (!e.isFile() || !/\.(md|txt|json)$/i.test(e.name)) continue;
    try { acc += '\n' + fs.readFileSync(path.join(dir, e.name), 'utf8'); } catch (_) { /* nieczytelny */ }
    if (acc.length > max) break;
  }
  return acc;
}
/**
 * Wszystko, z czym aplikacja porównuje odwołania. Każde pole opcjonalne: brak danego źródła oznacza, że odwołania
 * tego rodzaju są "unchecked" (nie da się ich sprawdzić), a nie błędne.
 */
function context({ ticket = '', notes = '', workDir = '', specsDir = '', docs = null, endpoints = null, bugs = [], knowledgeDir = '', models = null } = {}) {
  const docsList = docs || (specsDir ? tech.loadDocs(specsDir) : []);
  const eps = endpoints || tech.operations(docsList).map((o) => ({ method: o.method, path: o.path, name: String(o.op.operationId || '') }));
  const kb = {};
  if (knowledgeDir) {
    const dir = path.join(knowledgeDir, 'services');
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json'); } catch (_) { /* brak bazy */ }
    for (const f of files) { try { const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); kb[f.replace(/\.json$/, '')] = d; } catch (_) { /* zły plik */ } }
  }
  const texts = `${ticket}\n${notes}\n${workDir ? readTexts(workDir) : ''}`;
  return {
    texts, hasTicket: !!(ticket || '').trim() || /[A-Z][A-Z0-9_]+-\d+/.test(texts),
    docs: docsList, endpoints: eps, bugs: bugs || [], kb, hasKb: Object.keys(kb).length > 0,
    models: models || (workDir ? tech.loadModels(workDir) : []),
  };
}

/* ------------------------------------------------ rozwiązywanie źródeł ------------------------------------------------ */
const has = (hay, needle) => new RegExp(`(^|[^A-Za-z0-9])${String(needle).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9])`, 'i').test(hay);
const pathMatch = (tpl, p) => { const n = (s) => String(s).replace(/\/+$/, '').replace(/\{[^}]+\}/g, '{}').toLowerCase(); return n(tpl) === n(p.replace(/\/\d+(?=\/|$)/g, '/{}')) || n(tpl) === n(p); };

/** Jedno odwołanie → { ref, kind, status: resolved | unresolved | unchecked | code } */
function resolveRef(ref, ctx) {
  const r = String(ref || '').trim().replace(/^and\s+/i, '');
  if (!r) return null;
  if (PROOF_RE.test(r)) return { ref: r, kind: 'code', status: 'code' }; // sprawdza auditEvidence (plik:linia w pobranym kodzie)
  let m;
  if ((m = r.match(/^bug:\s*([A-Z][A-Z0-9_]*-\d+)/i))) {
    const key = m[1].toUpperCase();
    const ok = ctx.bugs.some((b) => b.source === 'jira:' + key || b.key === key) || has(ctx.texts, key);
    if (!ok && !ctx.bugs.length) return { ref: r, kind: 'bug', status: 'unchecked' }; // brak rejestru: nie ma z czym porównać
    return { ref: r, kind: 'bug', status: ok ? 'resolved' : 'unresolved', ...(ok ? {} : { why: `${key} is not in the bug registry` }) };
  }
  if ((m = r.match(/^conf:\s*(.+)$/i))) return { ref: r, kind: 'confluence', status: has(ctx.texts, m[1].trim()) ? 'resolved' : 'unchecked' };
  if ((m = r.match(/^kb:\s*([\w.\-]+)(?:#([\w-]+))?/i))) {
    if (!ctx.hasKb) return { ref: r, kind: 'kb', status: 'unchecked' };
    const doc = ctx.kb[m[1].toLowerCase()] || Object.values(ctx.kb).find((d) => String(d.source || '').toLowerCase() === m[1].toLowerCase());
    if (!doc) return { ref: r, kind: 'kb', status: 'unresolved', why: `no service "${m[1]}" in the knowledge base` };
    if (m[2]) { const s = doc.sections && doc.sections[m[2]]; if (!s || !(s.items || []).length) return { ref: r, kind: 'kb', status: 'unresolved', why: `section "${m[2]}" of "${m[1]}" is empty` }; }
    return { ref: r, kind: 'kb', status: 'resolved' };
  }
  const spec = r.match(/^(?:spec:\s*|endpoint\s+)?(GET|POST|PUT|PATCH|DELETE|HEAD)\s+(\/[^\s#]*)/i);
  if (spec) {
    if (!ctx.endpoints.length) return { ref: r, kind: 'spec', status: 'unchecked' };
    const ok = ctx.endpoints.some((e) => e.method === spec[1].toUpperCase() && pathMatch(e.path, spec[2]));
    return { ref: r, kind: 'spec', status: ok ? 'resolved' : 'unresolved', ...(ok ? {} : { why: `${spec[1].toUpperCase()} ${spec[2]} is not in the imported specification` }) };
  }
  if ((m = r.match(/^endpoint\s+([\w.\-]+)$/i))) {
    if (!ctx.endpoints.length) return { ref: r, kind: 'spec', status: 'unchecked' };
    const id = m[1].toLowerCase().replace(/[^a-z0-9]/g, '');
    const ok = ctx.endpoints.some((e) => String(e.name || '').toLowerCase().replace(/[^a-z0-9]/g, '') === id);
    return { ref: r, kind: 'spec', status: ok ? 'resolved' : 'unchecked' };
  }
  if (/^[A-Z][A-Z0-9_]+-\d+$/.test(r)) {
    if (!ctx.hasTicket) return { ref: r, kind: 'ticket', status: 'unchecked' };
    return { ref: r, kind: 'ticket', status: has(ctx.texts, r) ? 'resolved' : 'unresolved', ...(has(ctx.texts, r) ? {} : { why: `${r} is neither the tested ticket nor in the downloaded material` }) };
  }
  return { ref: r, kind: 'unknown', status: 'unresolved', why: 'not a known kind of source (ticket key, conf:<title>, file:line, METHOD /path, bug:<key>, kb:<service>#<section>)' };
}
function resolveSrc(src, ctx) {
  // Elementy pokrycia ("ci: BVA:...") to nie źródła — ich wyrocznię sprawdza część o technikach.
  const rest = String(src || '').replace(/\b(?:EP|BVA|DT|ST|PW):[\w.\-]+(?::[\w.\-+=@]+)+/g, '').replace(/\bci\s*:/gi, '');
  return rest.split(/[;,]/).map((p) => resolveRef(p, ctx)).filter(Boolean);
}

/* ------------------------------------------------ porównanie z wyrocznią ------------------------------------------------ */
function contradiction(item, expected) {
  const e = String(expected || '');
  if (!e) return 'the check has no expected result';
  if (item.expect === 'unknown') return 'no rule in the source says what should happen here — this belongs in "To confirm", not in a check';
  if (item.expect === 'accept') return REJECT.test(e) && !ACCEPT.test(e) ? `the source says the value is accepted (${item.oracle}), the check expects a rejection` : null;
  if (item.expect === 'reject') return ACCEPT.test(e) && !REJECT.test(e) ? `the source says the value is rejected (${item.oracle}), the check expects success` : !REJECT.test(e) ? `the source says the value is rejected (${item.oracle}); the check does not say it is rejected` : null;
  if (item.expect && item.expect.state) return has(e, item.expect.state) ? null : `the model says the state becomes "${item.expect.state}"; the check does not name that state`;
  if (item.expect && item.expect.action) {
    const miss = Object.entries(item.expect.action).filter(([, v]) => !has(e, String(v)));
    return miss.length ? `the rule says ${miss.map(([k, v]) => `${k} = ${v}`).join(', ')} (${item.oracle}); the check does not state that value` : null;
  }
  return null;
}

/* ------------------------------------------------ audyt ------------------------------------------------ */
/**
 * @returns {{ issues, traceability, techniques }}
 *  issues: [{code, text, items?}] — do tury korekty; traceability i techniques — do meta runu i do UI.
 */
function audit(report, ctx) {
  const d = parse(report);
  const issues = [];
  const allChecks = d.sections.flatMap((s) => s.checks.map((c) => ({ ...c, section: s })));
  // ---- 1. źródła
  const rows = [];
  const unresolved = [];
  for (const c of allChecks) {
    const sources = resolveSrc(c.src, ctx);
    const okSrc = sources.some((x) => x.status !== 'unresolved');
    const status = !c.src ? 'no-source' : okSrc || (c.ci.length && !sources.length) ? 'traced' : 'unresolved';
    if (status === 'unresolved') unresolved.push(`${c.ref} (${sources.map((x) => x.ref + (x.why ? ': ' + x.why : '')).join('; ')})`);
    const bcs = d.businessCases.filter((b) => b.sections.includes(c.section.n)).map((b) => b.id);
    rows.push({ bc: bcs, section: c.section.n, title: c.section.title, technique: c.section.technique, check: c.ref, action: c.action.slice(0, 160), expected: c.expected.slice(0, 200), sources, items: c.ci, status });
  }
  const noSrc = rows.filter((r) => r.status === 'no-source').map((r) => r.check);
  if (noSrc.length) issues.push({ code: 'oracle-no-source', items: noSrc, text: `${noSrc.length} check(s) have no (src: ...) for their expected result: ${noSrc.slice(0, 10).join(', ')}` });
  if (unresolved.length) issues.push({ code: 'oracle-unresolved', items: unresolved, text: `${unresolved.length} check(s) cite a source the app could not find, so their expected result has no confirmed source: ${unresolved.slice(0, 6).join(' | ')}` });

  // ---- 2. techniki
  const cited = [...new Set(allChecks.flatMap((c) => c.ci))];
  const epSlugs = new Set(cited.filter((x) => /^(EP|BVA):/.test(x)).map((x) => x.split(':')[1]));
  const epRefs = tech.operations(ctx.docs).filter((o) => epSlugs.has(tech.epSlug(o.method, o.path))).map((o) => `${o.method} ${o.path}`);
  const res = tech.build({ docs: ctx.docs, endpoints: epRefs, models: ctx.models });
  const byId = new Map(res.items.map((x) => [x.id, x]));
  const excusedText = d.sections.map((s) => s.notCovered).join('\n') + '\n' + d.confirm;
  const excused = new Set(tech.ciRefs(excusedText));
  const cov = tech.coverage(res, cited, excused);
  const avail = { EP: ctx.docs.length > 0, BVA: ctx.docs.length > 0, DT: ctx.models.some((m) => /decision/i.test(m.kind)), ST: ctx.models.some((m) => /state/i.test(m.kind)), PW: ctx.models.some((m) => /pair/i.test(m.kind)) || ctx.docs.length > 0 };
  // Punkt deklaruje technikę, ale żaden jego check nie wskazuje policzonego elementu pokrycia.
  const untraced = [];
  for (const s of d.sections) {
    const mine = s.checks.flatMap((c) => c.ci);
    for (const t of s.techniques) {
      if (mine.some((x) => x.startsWith(t + ':'))) continue;
      if (!avail[t] && (t === 'EP' || t === 'BVA')) continue; // brak specyfikacji API: EP/BVA np. na polu UI — nie da się policzyć
      untraced.push(`§${s.n} [${s.technique}]${avail[t] ? '' : ' (no model in technique-models.json)'}`);
    }
  }
  if (untraced.length) issues.push({ code: 'technique-untraced', items: untraced, text: `${untraced.length} point(s) name a technique but no check cites a coverage item computed by the app, so its coverage cannot be measured: ${untraced.join(', ')}` });
  // Bez specyfikacji elementów EP/BVA nie da się policzyć — to nie błąd agenta, tylko brak źródła.
  cov.unknown = cov.unknown.filter((x) => ctx.docs.length || !/^(EP|BVA):/.test(x));
  if (cov.unknown.length) issues.push({ code: 'technique-unknown-item', items: cov.unknown, text: `${cov.unknown.length} cited coverage item(s) do not exist in what the app computed (wrong id, or the model is not in technique-models.json): ${cov.unknown.slice(0, 8).join(', ')}` });
  const incomplete = cov.targets.filter((t) => t.missing.length);
  if (incomplete.length) issues.push({ code: 'technique-incomplete', items: incomplete.flatMap((t) => t.missing), text: `Technique coverage is incomplete: ${incomplete.map((t) => `${t.target} ${t.covered}/${t.required} (missing ${t.missing.slice(0, 6).join(', ')}${t.missing.length > 6 ? ', …' : ''})`).join('; ')}` });
  const contra = [];
  for (const c of allChecks) for (const id of c.ci) {
    const it = byId.get(id);
    if (!it) continue;
    const why = contradiction(it, c.expected);
    if (why) contra.push(`${c.ref} ${id}: ${why}`);
  }
  if (contra.length) issues.push({ code: 'oracle-contradiction', items: contra, text: `${contra.length} expected result(s) do not match the oracle of their coverage item: ${contra.slice(0, 5).join(' | ')}` });
  // Luki w regułach (kolumna bez reguły, sprzeczność, nieosiągalny stan) — defekt wymagania, musi trafić do To confirm.
  const conf = d.confirm.toLowerCase();
  const gaps = res.problems.filter((p) => /decision table|state machine|pairwise/.test(p)).filter((p) => {
    const id = (p.match(/"([^"]+)"/) || [])[1] || '';
    const col = (p.match(/column (\d+)/) || [])[1];
    const st = (p.match(/state "([^"]+)"/) || [])[1];
    if (col && conf.includes(`dt:${id}:${col}`)) return false;
    if (st && conf.includes(st.toLowerCase())) return false;
    return true;
  });
  if (gaps.length) issues.push({ code: 'requirement-gap', items: gaps, text: `The rules from technique-models.json have gaps that are not in "To confirm": ${gaps.slice(0, 5).join(' | ')}` });

  const byKind = {};
  for (const r of rows) for (const s of r.sources) byKind[s.kind] = (byKind[s.kind] || 0) + 1;
  const traceability = {
    rows, businessCases: d.businessCases,
    summary: { checks: rows.length, traced: rows.filter((r) => r.status === 'traced').length, unresolved: rows.filter((r) => r.status === 'unresolved').length, noSource: noSrc.length, withItems: rows.filter((r) => r.items.length).length, byKind },
  };
  const techniques = { available: avail, byTechnique: cov.byTechnique, targets: cov.targets, problems: res.problems, models: ctx.models.length };
  return { issues, traceability, techniques };
}

/** Macierz śledzalności jako CSV (do arkusza / do Jiry). */
function traceabilityCsv(t) {
  const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const head = ['Business case', 'Point', 'Title', 'Technique', 'Check', 'Action', 'Expected', 'Sources', 'Coverage items', 'Status'];
  const lines = [head.map(q).join(',')];
  for (const r of (t && t.rows) || []) lines.push([r.bc.join(' '), r.section, r.title, r.technique, r.check, r.action, r.expected, r.sources.map((s) => `${s.ref} [${s.status}]`).join('; '), r.items.join(' '), r.status].map(q).join(','));
  return lines.join('\n');
}

module.exports = { audit, parse, context, resolveRef, resolveSrc, contradiction, traceabilityCsv };
