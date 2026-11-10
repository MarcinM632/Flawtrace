// Raporty agentów: parsowanie na strukturę dla widoku (karty zamiast surowego tekstu) i audyt halucynacji
// liczony przez apkę, niezależnie od agenta: endpointy w raporcie QA MCP kontra te naprawdę wywołane,
// dowody "plik:linia" z Analyses / Test design kontra pobrany kod.
const fs = require('fs');
const path = require('path');

const clean = (s) => String(s || '').replace(/\*\*/g, '').trim();
const BAD_MARK = /^\[BŁĄD\]\s*/i;

// ---------------------------------------------------------------- QA MCP ----
const QA_SECTIONS = ['WYNIK', 'ZLECENIE', 'KROKI', 'BŁĘDY', 'STAN KOŃCOWY'];
const QA_ERR_FIELDS = { KROK: 'step', ENDPOINT: 'endpoint', OCZEKIWANO: 'expected', OTRZYMANO: 'actual', RODZAJ: 'kind', BRAMKA: 'gate' };

/** Nowy format QA MCP (sekcje WYNIK / ZLECENIE / KROKI / BŁĘDY / STAN KOŃCOWY). */
function parseQamcpNew(text, status) {
  const out = { kind: 'qamcp', format: 'steps', verdict: status || '', summary: '', scope: [], steps: [], errors: [], endState: '', chatCases: [] };
  let sec = null, err = null, field = null, tc = null;
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const head = line.match(/^\**(WYNIK|ZLECENIE|KROKI|BŁĘDY|PRZYPADKI CZATU|STAN KOŃCOWY)\**\s*:\s*(.*)$/i);
    if (head) {
      sec = head[1].toUpperCase(); err = null; field = null;
      if (sec === 'WYNIK') out.summary = clean(head[2]);
      if (sec === 'STAN KOŃCOWY') out.endState = clean(head[2]);
      continue;
    }
    if (sec === 'ZLECENIE') {
      const s = line.match(/^[-*]\s*\[([^\]]+)\]\s*(.*)$/);
      if (s) out.scope.push({ tag: s[1].trim().toUpperCase(), text: clean(s[2]) });
      else if (out.scope.length) out.scope[out.scope.length - 1].text += ' ' + clean(line);
    } else if (sec === 'KROKI') {
      const s = line.match(/^(\d+)[.)]\s+(.*)$/);
      if (s) out.steps.push({ n: +s[1], text: clean(s[2].replace(BAD_MARK, '')), bad: BAD_MARK.test(s[2]) });
      else if (out.steps.length) out.steps[out.steps.length - 1].text += ' ' + clean(line);
    } else if (sec === 'BŁĘDY') {
      const t = line.match(/^#{2,4}\s*(.*)$/) || line.match(/^(\d+)\.\s+(?!.*:)(.*)$/);
      if (t) { err = { title: clean(t[t.length - 1]) }; out.errors.push(err); field = null; continue; }
      const f = line.match(/^(KROK|ENDPOINT|OCZEKIWANO|OTRZYMANO|RODZAJ|BRAMKA)\s*:\s*(.*)$/i);
      if (f && err) { field = QA_ERR_FIELDS[f[1].toUpperCase()]; err[field] = clean(f[2]).replace(/`/g, ''); }
      else if (err && field) err[field] += ' ' + clean(line);
    } else if (sec === 'PRZYPADKI CZATU') {
      // Przypadek testowy czatu MCP: agent podaje cel, warunki, oczekiwanie i werdykt; wejście i wynik rzeczywisty
      // apka bierze z dziennika wywołań (chatCases), więc agent nie może ich przepisać inaczej, niż poszły.
      const t = line.match(/^#{2,4}\s*(TC\s*-?\s*\d+)\b.*?(?:\[(c\d+)\])?\s*$/i);
      if (t) { tc = { id: t[1].replace(/\s|-/g, '').toUpperCase(), ref: t[2] || '' }; out.chatCases.push(tc); field = null; continue; }
      const f = line.match(/^(CEL|WARUNKI WSTĘPNE|OCZEKIWANO|WERDYKT|ROZBIEŻNOŚĆ)\s*:\s*(.*)$/i);
      if (f && tc) { field = CHAT_FIELDS[f[1].toUpperCase()]; tc[field] = clean(f[2]); }
      else if (tc && field) tc[field] += ' ' + clean(line);
    } else if (sec === 'WYNIK') out.summary += ' ' + clean(line);
    else if (sec === 'STAN KOŃCOWY') out.endState += ' ' + clean(line);
  }
  out.chatCases.forEach((c) => { c.checks = chatChecks(c.verdict); });
  return out;
}

const CHAT_FIELDS = { CEL: 'objective', 'WARUNKI WSTĘPNE': 'preconditions', OCZEKIWANO: 'expected', WERDYKT: 'verdict', ROZBIEŻNOŚĆ: 'deviation' };
const CHAT_LEVELS = { NARZĘDZIE: 'tool', DANE: 'data', HALUCYNACJA: 'hallucination', ZAKRES: 'scope' };
/** "NARZĘDZIE PASS | DANE FAIL | …" -> { tool: 'PASS', data: 'FAIL', …, overall } ; overall liczy apka, nie agent. */
function chatChecks(verdict) {
  const out = {};
  for (const [pl, key] of Object.entries(CHAT_LEVELS)) {
    const m = String(verdict || '').match(new RegExp(pl + '\\s*[:=]?\\s*(PASS|FAIL|N/?A)', 'i'));
    if (m) out[key] = m[1].toUpperCase().replace('NA', 'N/A');
  }
  const vals = Object.values(out);
  out.overall = !vals.length ? '' : vals.includes('FAIL') ? 'FAIL' : vals.every((v) => v === 'N/A') ? 'N/A' : 'PASS';
  return out;
}

/** Wiadomości wysłane do czatu MCP w runie (general_read_ask_mcp_chat z dziennika), złączone z przypadkami z raportu. */
function chatCases(view, workDir) {
  let lines = [];
  try { lines = fs.readFileSync(path.join(workDir || '', 'calls.jsonl'), 'utf8').split('\n'); } catch (_) { return []; }
  const byRef = new Map(((view && view.chatCases) || []).filter((c) => c.ref).map((c) => [c.ref, c]));
  const out = [];
  for (const line of lines) {
    let c; try { c = JSON.parse(line); } catch (_) { continue; }
    if (c.tool !== 'general_read_ask_mcp_chat') continue;
    const r = c.response || {};
    out.push({
      ref: c.ref, message: (c.args || {}).message || '', followUpOf: (c.args || {}).sessionId || '',
      ok: !!c.ok, error: c.error || '', answer: r.answer || '', model: r.model || '', costUsd: r.costUsd ?? null,
      toolCalls: (r.toolCalls || []).map((t) => ({ tool: t.tool, input: t.input, isError: !!t.isError, output: JSON.stringify(t.output ?? null).slice(0, 4000) })),
      latencyMs: r.latencyMs ?? null, files: (r.files || []).map((f) => ({ name: f.name, bytes: f.bytes, content: String(f.content).slice(0, 4000) })),
      expect: (c.args || {}).expect || null, afterChange: !!(c.args || {}).afterChange, evaluation: r.evaluation || null,
      case: byRef.get(c.ref) || null,
    });
  }
  return out;
}

/** Minimalna liczba pytań czatu na narzędzie MCP, z kryteriów akceptacji (czytane przy każdym audycie). */
function chatMinCases() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'kryteria', 'kryteria_akceptacji_mcp.json'), 'utf8')).battery.minCasesPerTool || 50; }
  catch (_) { return 50; }
}

/** Baterie pytań (general_read_ask_mcp_chat_battery): pełne wyniki, które mcp-server zapisał obok dziennika wywołań. */
function chatBatteries(workDir) {
  let names = [];
  try { names = fs.readdirSync(workDir || '').filter((n) => /^battery-.*\.json$/.test(n)).sort(); } catch (_) { return []; }
  const out = [];
  for (const n of names) { try { out.push(JSON.parse(fs.readFileSync(path.join(workDir, n), 'utf8'))); } catch (_) { /* uszkodzony plik */ } }
  return out;
}

/** Stary format QA MCP: "**SUKCES** — ...", "Replikacja:", "Błędy:" z Gdzie / Oczekiwano / Otrzymano, "Pominięte:". */
function parseQamcpLegacy(text, status) {
  const out = { kind: 'qamcp', format: 'legacy', verdict: status || '', summary: '', scope: [], steps: [], errors: [], endState: '', skipped: '' };
  let sec = 'head', err = null, field = null;
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const v = line.match(/^\*\*([^*]+)\*\*\s*[—-]\s*(.*)$/);
    if (v && sec === 'head') { out.verdict = out.verdict || v[1].trim(); out.summary = clean(v[2]); continue; }
    if (/^Replikacja\s*:/i.test(line)) { sec = 'steps'; continue; }
    if (/^Błędy\s*:/i.test(line)) { sec = 'errors'; continue; }
    const sk = line.match(/^Pominięte\s*:\s*(.*)$/i);
    if (sk) { sec = 'skipped'; out.skipped = clean(sk[1]); continue; }
    if (sec === 'steps') {
      const s = line.match(/^(\d+)[.)]\s+(.*)$/);
      if (s) out.steps.push({ n: +s[1], text: clean(s[2]), bad: false });
      else if (out.steps.length) out.steps[out.steps.length - 1].text += ' ' + clean(line);
    } else if (sec === 'errors') {
      const g = line.match(/^(?:\d+\.\s*)?Gdzie\s*:\s*(.*)$/i);
      if (g) {
        const ep = (g[1].match(/`([^`]+)`/) || [])[1] || '';
        const st = (g[1].match(/krok(?:u)?\s+([^\s,;]+)/i) || [])[1] || '';
        err = { title: '', endpoint: ep, step: st, where: clean(g[1]).replace(/`/g, '') }; out.errors.push(err); field = null; continue;
      }
      const f = line.match(/^(Oczekiwano|Otrzymano|bramka)\s*:\s*(.*)$/i);
      if (f && err) { field = /^Ocz/i.test(f[1]) ? 'expected' : /^Otrz/i.test(f[1]) ? 'actual' : 'gate'; err[field] = clean(f[2]); }
      else if (err && field) err[field] += ' ' + clean(line);
    } else if (sec === 'skipped') out.skipped += ' ' + clean(line);
    else if (sec === 'head') out.summary += (out.summary ? ' ' : '') + clean(line);
  }
  return out;
}

function parseQamcp(text, status) {
  return /^\s*\**(WYNIK|KROKI)\**\s*:/im.test(text) ? parseQamcpNew(text, status) : parseQamcpLegacy(text, status);
}

// ------------------------------------------------------------- Analyses ----
const AN_FIELDS = { 'Co się dzieje': 'actual', 'Powinno być': 'expected', 'Dlaczego to groźne': 'impact', 'Ścieżka do replikacji': 'path', 'Dowód': 'proof' };
const AN_TAIL = { 'Do sprawdzenia ręcznie': 'manual', 'Sprawdzone i czyste': 'clean' };

/** Kroki replikacji "1) ... 2) ..." w jednej linii albo w osobnych liniach. */
function splitSteps(s) {
  const parts = String(s || '').split(/(?:^|\s)(\d+)\)\s+/).slice(1);
  const steps = [];
  for (let i = 0; i < parts.length; i += 2) {
    const t = clean(parts[i + 1]);
    if (t) steps.push({ n: +parts[i], text: t.replace(BAD_MARK, ''), bad: BAD_MARK.test(t) });
  }
  return steps;
}

function parseAnalysis(text, status) {
  const out = { kind: 'analysis', verdict: status || '', ticket: '', none: '', cases: [], manual: '', clean: '', coverage: '' };
  let cur = null, field = null, tail = null;
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\r$/, '');
    const t = line.trim();
    if (!t) continue;
    if (!out.ticket) { out.ticket = t; continue; }
    if (/brak krytycznych przypadk/i.test(t) && !cur) { out.none = clean(t); continue; }
    const cov = t.match(/^whitebox:\s*\d+\s*\|.*$/);
    if (cov) { out.coverage = t; tail = null; field = null; continue; }
    const c = t.match(/^(\d+)\.\s+(.*)$/);
    if (c) { cur = { n: +c[1], title: clean(c[2]) }; out.cases.push(cur); field = null; tail = null; continue; }
    const tl = t.match(/^(Do sprawdzenia ręcznie|Sprawdzone i czyste)\s*:\s*(.*)$/);
    if (tl) { tail = AN_TAIL[tl[1]]; out[tail] = clean(tl[2]); cur = null; field = null; continue; }
    if (tail) { out[tail] += ' ' + clean(t); continue; }
    const f = t.match(/^(Co się dzieje|Powinno być|Dlaczego to groźne|Ścieżka do replikacji|Dowód)\s*:\s*(.*)$/);
    if (f && cur) { field = AN_FIELDS[f[1]]; cur[field] = f[2].trim(); continue; }
    if (cur && field) cur[field] += (field === 'path' ? '\n' : ' ') + t;
  }
  for (const c of out.cases) {
    c.steps = splitSteps(c.path);
    // Stary format nie oznaczał kroku z błędem: obserwacja jest w ostatnim kroku.
    if (c.steps.length && !c.steps.some((s) => s.bad)) c.steps[c.steps.length - 1].obs = true;
    for (const k of ['actual', 'expected', 'impact', 'proof']) if (c[k]) c[k] = clean(c[k]);
    delete c.path;
  }
  return out;
}

// ---------------------------------------------------------- Test design ----
function parseDesign(text, status) {
  const out = { kind: 'design', verdict: status || '', title: '', head: [], sections: [], summary: [], confirm: [] };
  let sec = null, mode = 'head';
  for (const raw of String(text).split('\n')) {
    const t = raw.trim();
    if (!t) continue;
    if (!out.title) { out.title = t; continue; }
    const h = t.match(/^##\s+(\d+)\.\s+(.*?)\s*(?:\[([^\]]+)\])?\s*$/);
    if (h) { sec = { n: +h[1], title: h[2], technique: h[3] || '', checks: [], notCovered: '' }; out.sections.push(sec); mode = 'sec'; continue; }
    if (/^##\s+Summary/i.test(t)) { mode = 'summary'; continue; }
    if (/^##\s+To confirm/i.test(t)) { mode = 'confirm'; continue; }
    if (mode === 'head') { const kv = t.match(/^([A-Za-z ]{2,20}):\s*(.*)$/); if (kv) out.head.push({ k: kv[1], v: kv[2] }); else if (out.head.length) out.head[out.head.length - 1].v += ' ' + t; continue; }
    if (mode === 'sec' && sec) {
      const nc = t.match(/^Not covered:\s*(.*)$/i);
      if (nc) { sec.notCovered = nc[1]; continue; }
      const b = t.match(/^[-*]\s+(.*)$/);
      if (b) {
        let body = b[1], src = '';
        const sm = body.match(/\s*\(src:\s*([^)]*)\)\s*$/);
        if (sm) { src = sm[1]; body = body.slice(0, sm.index); }
        const [act, exp] = body.split(/\s*=>\s*/);
        sec.checks.push({ action: act.trim(), expected: (exp || '').trim(), src });
      } else if (sec.checks.length) sec.checks[sec.checks.length - 1].expected += ' ' + t;
      continue;
    }
    if (mode === 'summary') { out.summary.push(t.split('|').map((x) => x.trim())); continue; }
    if (mode === 'confirm') { const b = t.match(/^[-*]\s+(.*)$/); if (b) out.confirm.push(b[1]); else if (out.confirm.length) out.confirm[out.confirm.length - 1] += ' ' + t; }
  }
  return out;
}

/** Widok raportu dla UI; null, gdy raport się nie poddaje (UI pokaże wtedy surowy tekst). */
function parseReport(mode, text, status) {
  if (!text) return null;
  try {
    const v = mode === 'qamcp' || mode === 'execution' ? parseQamcp(text, status) : mode === 'qa' ? parseAnalysis(text, status) : mode === 'design' ? parseDesign(text, status) : null;
    if (!v) return null;
    const empty = v.kind === 'qamcp' ? !v.summary && !v.steps.length && !v.errors.length
      : v.kind === 'analysis' ? !v.cases.length && !v.none : !v.sections.length;
    return empty ? null : v;
  } catch (_) { return null; }
}

// ---------------------------------------------------------------- audyty ----
const TOOL_RE = /\b(?:manager|admin|core|general)_[a-z0-9_]+\b/g;
const GENERAL = new Set(['general_get_status', 'general_read_list_endpoints', 'general_read_describe_endpoint', 'general_read_get_coverage', 'general_refresh_specs']);
// Prawdziwe nazwy narzędzi z katalogu mcp-server. Bez tego audyt łapał prefiksy i nazwy grup ("core_hedger_", "core_core").
let catalog = null;
function knownTools() {
  if (catalog) return catalog;
  try {
    const { ROOT } = require('./config');
    const md = fs.readFileSync(path.join(ROOT, 'mcp-server', 'ENDPOINTS.md'), 'utf8');
    catalog = new Set([...md.matchAll(/`([a-z0-9_]+)` \|/g)].map((m) => m[1]));
  } catch (_) { catalog = new Set(); }
  return catalog;
}

/**
 * QA MCP: raport może się powoływać tylko na endpointy, które run NAPRAWDĘ wywołał (sam opis przez describe to nie
 * odczyt), a status ma się zgadzać z treścią. Zwraca listę problemów (pusta = czysto).
 */
/** Dziennik wywołań runu QA MCP (mcp-server, PLAT_CALL_LOG): ref -> pełny tekst wejścia i odpowiedzi. */
function loadCalls(workDir) {
  let text = '';
  try { text = fs.readFileSync(path.join(workDir || '', 'calls.jsonl'), 'utf8'); } catch (_) { return null; }
  const calls = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { const c = JSON.parse(line); calls.set(c.ref, JSON.stringify({ args: c.args, response: c.response, error: c.error })); } catch (_) { /* ucięta linia */ }
  }
  return calls;
}

const REF_RE = /\[(c\d+(?:\s*[,;]\s*c\d+)*)\]/g;
const LOT_SIZES = [10, 100, 1000, 100000];
/** Liczby z wywołania, także po przeliczeniu jednostki ↔ loty (Manager API podaje wolumen w jednostkach). */
function callNumbers(text) {
  const out = new Set();
  // "164,1" w odpowiedzi czatu po polsku to 164.1, więc przecinek dziesiętny też liczymy (lineNumbers robi to samo).
  for (const t of [...(String(text).match(/-?\d+(?:\.\d+)?/g) || []), ...(String(text).match(/-?\d+,\d+/g) || []).map((x) => x.replace(',', '.'))]) {
    const n = Number(t); if (!Number.isFinite(n)) continue;
    out.add(n); out.add(Math.abs(n));
    for (const f of LOT_SIZES) { out.add(Math.round((n / f) * 1e6) / 1e6); out.add(Math.abs(Math.round((n / f) * 1e6) / 1e6)); }
  }
  return out;
}
/** Liczby, które linia raportu przypisuje wywołaniom: bez numeru kroku, godzin, dat i samych referencji. */
function lineNumbers(line) {
  const body = line.replace(REF_RE, ' ').replace(/^\s*\d+[.)]\s*/, '').replace(/\b\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?\b/g, ' ')
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\b/g, ' ').replace(/\b[A-Z][A-Z0-9]+-\d+\b/g, ' ').replace(/§\s*\d+/g, ' ');
  return (body.match(/-?\d+(?:[.,]\d+)?/g) || []).map((t) => Number(t.replace(',', '.'))).filter(Number.isFinite);
}

/**
 * Wartość przypisana wywołaniu "[c17]" musi być w zapisanym wejściu albo odpowiedzi c17 (z tolerancją na przeliczenie
 * jednostek na loty). Linie oczekiwań i wyliczeń nie są sprawdzane — to nie odczyty.
 */
function auditCallRefs(claims, calls) {
  const issues = [];
  if (!calls || !calls.size) return issues;
  const lines = String(claims).split('\n');
  const hasRef = /\[c\d+/; // bez flagi g: test() na regexie globalnym przeskakiwał co drugą linię
  const withRefs = lines.filter((l) => hasRef.test(l));
  const readLines = lines.filter((l) => /^\s*(\d+[.)]|OTRZYMANO\s*:)/i.test(l) && /\d/.test(l.replace(/^\s*\d+[.)]/, '')));
  if (!withRefs.length && readLines.length) {
    issues.push({ code: 'no-call-refs', text: 'The report gives values in KROKI / OTRZYMANO but cites no call reference ([cN] from the _call field of each response), so none of them can be checked against what the environment returned' });
    return issues;
  }
  const unknown = new Set(), missing = [];
  for (const line of withRefs) {
    const refs = [...line.matchAll(REF_RE)].flatMap((m) => m[1].split(/\s*[,;]\s*/));
    const known = refs.filter((r) => calls.has(r));
    refs.filter((r) => !calls.has(r)).forEach((r) => unknown.add(r));
    if (!known.length || /OCZEKIWANO|wylicz|oczekiw|expected|computed|suma\b/i.test(line)) continue;
    const have = new Set(known.flatMap((r) => [...callNumbers(calls.get(r))]));
    const absent = lineNumbers(line).filter((n) => !have.has(n) && !have.has(Math.abs(n)));
    if (absent.length) missing.push(`${line.trim().slice(0, 90)} → ${absent.slice(0, 4).join(', ')} not in ${known.join(', ')}`);
  }
  if (unknown.size) issues.push({ code: 'unknown-call-ref', items: [...unknown], text: `The report cites call reference(s) this run never made: ${[...unknown].join(', ')}` });
  if (missing.length) issues.push({ code: 'value-not-in-call', items: missing.slice(0, 6), text: `${missing.length} line(s) give values that are not in the call they cite:\n  ` + missing.slice(0, 6).join('\n  ') });
  return issues;
}

function auditQamcp(report, status, events, workDir) {
  const issues = [];
  if (!report) return issues;
  const called = new Set(events.filter((e) => e.type === 'endpoint').map((e) => String(e.text).split(' · ')[0]));
  // Narzędzia serwera MCP wywołane przez testowany czat też są "wywołane" — raport słusznie je nazywa (np. ENDPOINT błędu).
  for (const s of chatCases(null, workDir)) for (const t of s.toolCalls) called.add(t.tool);
  const described = new Set(events.filter((e) => e.type === 'endpoint' && /general_read_describe_endpoint/.test(e.text))
    .map((e) => (String(e.input || '').match(/"(?:tool|name|endpoint)"\s*:\s*"([a-z0-9_]+)"/) || [])[1]).filter(Boolean));
  const known = knownTools();
  // W nowym formacie twierdzenia o wykonaniu są w KROKI i BŁĘDY; punkt zlecenia oznaczony jako niewykonany
  // może opisywać endpoint, którego celowo nie wywołano. W starym formacie sprawdzamy całość.
  const isNew = /^\s*\**(WYNIK|KROKI)\**\s*:/im.test(report);
  const claims = isNew ? (String(report).match(/^\s*\**(?:KROKI|BŁĘDY)\**\s*:[\s\S]*?(?=^\s*\**(?:WYNIK|ZLECENIE|PRZYPADKI CZATU|STAN KOŃCOWY)\**\s*:|(?![\s\S]))/gim) || []).join('\n') : String(report);
  const named = [...new Set(claims.match(TOOL_RE) || [])].filter((n) => !GENERAL.has(n) && (!known.size || known.has(n)));
  const notCalled = named.filter((n) => !called.has(n));
  if (notCalled.length) {
    issues.push({ code: 'uncalled-endpoint', items: notCalled,
      text: `The report names endpoint${notCalled.length > 1 ? 's' : ''} this run never called: ${notCalled.join(', ')}`
        + (notCalled.some((n) => described.has(n)) ? ' (only their description was read, which says nothing about the environment)' : '') });
  }
  const v = parseQamcp(report, status);
  if (v.format === 'steps') {
    const miss = ['WYNIK', 'ZLECENIE', 'KROKI', 'STAN KOŃCOWY'].filter((s) => !new RegExp('^\\s*\\**' + s + '\\**\\s*:', 'im').test(report));
    if (miss.length) issues.push({ code: 'missing-section', items: miss, text: `Missing section${miss.length > 1 ? 's' : ''}: ${miss.join(', ')}` });
    if (/SUKCES/i.test(status || '') && (v.errors.length || v.steps.some((s) => s.bad))) {
      issues.push({ code: 'status-mismatch', text: 'Status is SUKCES but the report lists a failed step or an error' });
    }
    if (/BŁĄD/i.test(status || '') && !v.errors.length) issues.push({ code: 'status-mismatch', text: 'Status is BŁĄD but the report lists no error' });
    // BŁĄD znaczy: znaleziony błąd produktu. Same ograniczenia środowiska albo odrzucona konfiguracja testu to NIEWERYFIKOWALNE.
    const product = v.errors.filter((e) => /PRODUKT/i.test(e.kind || ''));
    if (/BŁĄD/i.test(status || '') && v.errors.length && v.errors.every((e) => e.kind) && !product.length) {
      issues.push({ code: 'status-mismatch', text: 'Status is BŁĄD but no error has RODZAJ: PRODUKT — with only test-configuration or environment limits the status is NIEWERYFIKOWALNE' });
    }
    if (/NIEWERYFIKOWALNE/i.test(status || '') && product.length) issues.push({ code: 'status-mismatch', text: 'Status is NIEWERYFIKOWALNE but an error has RODZAJ: PRODUKT, so the status is BŁĄD' });
    const badEp = v.errors.filter((e) => e.endpoint && !called.has(e.endpoint.replace(/[^a-z0-9_].*$/, '')));
    if (badEp.length && !notCalled.length) issues.push({ code: 'uncalled-endpoint', text: 'An error points at an endpoint that was not called: ' + badEp.map((e) => e.endpoint).join(', ') });
    issues.push(...auditCallRefs(claims, loadCalls(workDir)));
    // Pytania do czatu MCP ocenia mcp-server (expect → TP/TN/FP/FN/WRONG); raport ich nie opisuje, więc audyt nie wymaga
    // przypadku TCn na każde pytanie (wymóg wymuszał tury korekty i bardzo długie raporty).
    const sent = chatCases(v, workDir);
    // Test czatu MCP jest probabilistyczny: o narzędziu mówi dopiero bateria z liczbą pytań z kryteriów akceptacji.
    // Run, który wysłał kilka pytań, dostaje turę korekty z poleceniem dołożenia brakujących (bateria to odczyt).
    const batteries = chatBatteries(workDir);
    if (sent.length || batteries.length) {
      const min = chatMinCases();
      const perTool = {};
      const add = (tool) => { const k = tool || '(no MCP tool named in expect/intent)'; perTool[k] = (perTool[k] || 0) + 1; };
      batteries.forEach((b) => b.cases.forEach((c) => add(c.intent || (c.expect && c.expect.tool))));
      sent.forEach((s) => add(s.expect && s.expect.tool));
      const short = Object.entries(perTool).filter(([, n]) => n < min);
      if (short.length) issues.push({ code: 'chat-too-few', items: short.map(([t, n]) => `${t}: ${n}`),
        text: `Too few chat questions to judge the MCP tools (the acceptance criteria ask for at least ${min} per tool): `
          + short.map(([t, n]) => `${t} ${n}`).join(', ') + '. Run ONE general_read_ask_mcp_chat_battery with the missing questions for all of them (templates × data, tool = the MCP tool name)' });
    }
    const sentRefs = new Set(sent.map((s) => s.ref));
    const stray = v.chatCases.filter((c) => !sentRefs.has(c.ref)).map((c) => c.id + (c.ref ? ' [' + c.ref + ']' : ''));
    if (stray.length) issues.push({ code: 'chat-case-ref', items: stray,
      text: `Test case${stray.length > 1 ? 's' : ''} not tied to a message sent to the chat (the [cN] must be the general_read_ask_mcp_chat call): ${stray.join(', ')}` });
  }
  return issues;
}

const PROOF_RE = /([A-Za-z0-9_./-]*[A-Za-z0-9_-]\.[A-Za-z][A-Za-z0-9]{0,5}):(\d+)(?:-(\d+))?/g;

/** Indeks plików pobranego kodu: nazwa pliku -> ścieżki. Raz na audyt. */
function indexCode(dirs) {
  const byName = new Map();
  const walk = (dir, depth) => {
    if (depth > 18) return;
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      if (e.name.startsWith('.') || ['node_modules', 'build', 'target', 'dist'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else { if (!byName.has(e.name)) byName.set(e.name, []); byName.get(e.name).push(p); }
    }
  };
  for (const d of dirs) walk(d, 0);
  return byName;
}

/**
 * Analyses / Test design: każdy "plik:linia" w raporcie musi istnieć w pobranym kodzie (kod-po albo kod-przed),
 * a linia mieścić się w pliku. Zwraca { checked, issues } albo null, gdy nie ma pobranego kodu.
 */
function auditEvidence(report, workDir) {
  // kod-po / kod-przed pierwszego repo i kod-po-<repo> / kod-przed-<repo> każdego następnego (qa-git.sh prepare).
  let entries = []; try { entries = fs.readdirSync(workDir); } catch (_) { /* brak katalogu */ }
  const dirs = entries.filter((d) => /^kod-(po|przed)(-[\w.-]+)?$/.test(d)).map((d) => path.join(workDir, d)).filter((d) => fs.statSync(d).isDirectory());
  if (!report || !dirs.length) return null;
  const refs = [];
  // Dowód w Analyses jest w linii "Dowód:", a w Test design w "(src: ...)" — tylko tam szukamy, żeby nie łapać wersji czy kwot.
  const spots = [...String(report).matchAll(/^Dowód:\s*(.+)$/gm)].map((m) => m[1])
    .concat([...String(report).matchAll(/\(src:\s*([^)]*)\)/g)].map((m) => m[1]));
  for (const s of spots) for (const m of s.matchAll(PROOF_RE)) refs.push({ ref: m[0], file: m[1], line: +m[2], to: m[3] ? +m[3] : +m[2] });
  if (!refs.length) return { checked: 0, issues: [] };
  const idx = indexCode(dirs);
  const lines = new Map();
  const count = (p) => { if (!lines.has(p)) { try { lines.set(p, fs.readFileSync(p, 'utf8').split('\n').length); } catch (_) { lines.set(p, 0); } } return lines.get(p); };
  const missing = [], beyond = [];
  for (const r of [...new Map(refs.map((x) => [x.ref, x])).values()]) {
    const base = path.basename(r.file);
    const want = r.file.replace(/\\/g, '/');
    const cands = (idx.get(base) || []).filter((p) => !want.includes('/') || p.split(path.sep).join('/').endsWith('/' + want) || p.split(path.sep).join('/').endsWith(want));
    if (!cands.length) { missing.push(r.ref); continue; }
    if (!cands.some((p) => count(p) >= r.to)) beyond.push(r.ref);
  }
  const issues = [];
  if (missing.length) issues.push({ code: 'evidence-missing-file', items: missing, text: `Evidence points at file${missing.length > 1 ? 's' : ''} not in the downloaded code: ${missing.join(', ')}` });
  if (beyond.length) issues.push({ code: 'evidence-bad-line', items: beyond, text: `Evidence points past the end of the file: ${beyond.join(', ')}` });
  return { checked: refs.length, issues };
}

/** Czy tekst testera to flow (opis, JAK sprawdzić), a nie sam klucz ticketu albo jednozdaniowe zlecenie. */
function hasTesterFlow(ticket, notes) {
  const text = [ticket, notes].map((s) => String(s || '')).join('\n')
    .replace(/https?:\/\/\S+/g, ' ').replace(/\b[A-Z][A-Z0-9]+-\d+\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length < 60) return false;
  // Długość to za mało: "find any regressions, cover high percentage" (run 12b7) to prośba o zakres, nie flow, a audyt
  // kazał agentowi wymyślić "F2 high coverage". Flow ma mechanikę: kroki, warunek ("if I turn off…"), pole z API, liczby.
  const steps = (String(notes || '').match(/^\s*(\d+[.)]|[-*•])\s+\S/gm) || []).length;
  return steps >= 2
    || /\b[a-z]+[A-Z][A-Za-z]+\b/.test(text)
    || /\b(if (i|we|you)|when (i|we|the|a|an)|then|jeśli|jeżeli|gdy|kiedy|potem|następnie|najpierw)\b|→|->/i.test(text)
    || /\b\d+(\.\d+)?\s*(lot|lots|lotów|ms|%)/i.test(text);
}

/**
 * Test design przy flow testera: flow ma być zmapowany (linia "Flow:"), a sprawdzenia mają go wykonywać, a nie
 * w większości zapisywać konfigurację reguły ("Save ... => saved / rejected"), czego tester nie zamawiał.
 */
function auditDesignFlow(report, ticket, notes) {
  if (!report || !hasTesterFlow(ticket, notes)) return [];
  const issues = [];
  if (!/^Flow:\s*\S/m.test(report)) {
    issues.push({ code: 'flow-missing', text: 'The tester gave a flow, but the design has no "Flow:" line mapping each of its elements (F1, F2, …) to a point or to To confirm' });
  }
  const checks = String(report).split('\n').filter((l) => /^- .* => /.test(l));
  const configOnly = checks.filter((l) => /^-\s*(Save|Create|Update|Edit)\b[^=]*=>\s*(saved|rejected|accepted|refused|returns? 400)/i.test(l));
  if (checks.length && configOnly.length * 3 > checks.length) {
    issues.push({ code: 'flow-replaced', text: `${configOnly.length} of ${checks.length} checks only save a rule configuration and look at the save result; the tester asked for a flow to be run on the system` });
  }
  return issues;
}

/**
 * Test design zbudowany wokół przypadków biznesowych: linia "Business cases:" mapuje przypadki na punkty, każdy punkt
 * należy do przypadku, a tytuł opisuje sytuację użycia, nie technikę ani mechanikę (tak samo liczy validate-design.sh).
 */
const TECHNIQUE_TITLE = /^(equivalence (partition|class)|boundary( value)?s?( analysis)?|decision table|state transitions?|pairwise|validation( boundaries)?|field validation|input validation)\b/i;
function auditDesignBusiness(report) {
  if (!report || !/^TEST DESIGN/m.test(report)) return [];
  const issues = [];
  const line = (String(report).match(/^Business cases:(.*)$/m) || [])[1];
  if (!line) {
    issues.push({ code: 'business-missing', text: 'The design has no "Business cases:" line: its points are not tied to how the feature is used in the business (BC1 <situation>→§n | … | BCn→To confirm)' });
    return issues;
  }
  const points = [...String(report).matchAll(/^## (\d+)\.\s*(.*)$/gm)].map((m) => ({ n: m[1], title: m[2].replace(/\s*\[[^\]]*\]\s*$/, '') }));
  const unmapped = points.filter((p) => !new RegExp(`§${p.n}(?!\\d)`).test(line)).map((p) => '§' + p.n);
  if (unmapped.length) issues.push({ code: 'business-unmapped', items: unmapped, text: `Point(s) ${unmapped.join(', ')} belong to no business case in "Business cases:" — a point without a business case is a theoretical test` });
  const technical = points.filter((p) => TECHNIQUE_TITLE.test(p.title)).map((p) => p.title);
  if (technical.length) issues.push({ code: 'business-technique-title', items: technical, text: `Point title(s) name a technique or validation instead of a business situation: ${technical.join('; ')}` });
  return issues;
}

/**
 * Test design kontra rejestr błędów: rejestr ma uczyć flow i klas błędów, a nie dostarczać gotowych przypadków.
 * Wymagana linia "Bug patterns:", zakaz bug: z błędów zgłoszonych w testowanym tickecie, a sprawdzenie, które
 * przepisuje co najmniej dwie wartości liczbowe z cytowanego zgłoszenia, uznajemy za kopię przypadku testera.
 */
function auditDesignBugs(report, bugs, input, workDir) {
  if (!report) return [];
  const issues = [];
  if (!/^Bug patterns:\s*\S/m.test(report)) {
    issues.push({ code: 'bugs-missing', text: 'The design has no "Bug patterns:" line naming the registry patterns (flow and error class) it used, or "none for <service>"' });
  }
  const own = new Set(String(input || '').match(/\b[A-Z][A-Z0-9]+-\d+\b/g) || []);
  // Wartości z reguł AUTOTEST (konta, wagi, limity, progi) projekt MUSI podawać, a bugi z rejestru też ich używają.
  // Wspólne "1002" i "10" to więc nie kopia, tylko to samo środowisko (runy 6b71 i 12b7 płaciły za to korektą).
  let setupNums = new Set();
  try { setupNums = new Set(fs.readFileSync(path.join(workDir || '', 'autotest-setup.md'), 'utf8').match(/\b\d+(?:\.\d+)?\b/g) || []); } catch (_) { /* brak pliku */ }
  const nums = (s) => new Set((String(s).match(/\b\d+(?:\.\d+)?\b/g) || []).filter((n) => n.length > 1 && !setupNums.has(n)));
  const same = [];
  const copied = [];
  for (const line of String(report).split('\n').filter((l) => /^- .* => .*\bbug:/.test(l))) {
    for (const key of line.match(/bug:([A-Z][A-Z0-9]+-\d+)/g).map((k) => k.slice(4))) {
      if (own.has(key)) { same.push(key); continue; }
      const mine = nums(line.replace(/\(src:.*$/, ''));
      const hit = (bugs || []).some((b) => b.ticket === key && [...nums(`${b.title || ''} ${b.notes || ''}`)].filter((n) => mine.has(n)).length >= 2);
      if (hit) copied.push(key);
    }
  }
  if (same.length) issues.push({ code: 'bugs-same-ticket', items: [...new Set(same)], text: `Checks cite bugs the tester already reported in the ticket under test (${[...new Set(same)].join(', ')}); those must not be designed again` });
  if (copied.length) issues.push({ code: 'bugs-copied', items: [...new Set(copied)], text: `Checks reuse the values of the registry bug they cite (${[...new Set(copied)].join(', ')}); take the flow and error class, not the case` });
  return issues;
}

/**
 * Test design opisany na przykładzie: litery zastępcze (A/B/C, T, V, "units") zamiast kont, lotów i pól z API
 * oraz projekt hedgera bez żadnego konta z WORK_DIR/autotest-setup.md (tak samo liczy validate-design.sh).
 */
// Litera to symbol zastępczy tylko wtedy, gdy stoi sama: "B-book", "A-Book", "T+2" (data rozliczenia) i wartości tagów
// FIX ("59=C or D") to prawdziwe nazwy, więc przed sprawdzeniem są wycinane (tak samo w validate-design.sh).
const PLACEHOLDER = /\b[A-D] ?(,|and|or|\+) ?[A-D](?![-\w])|\b(on|to|of|for|from|with) [A-D](?![-\w])|\b[A-D] ?= ?(true|false)\b|\b[A-D] (isEnabled|false|true|holds|gets|reaches|stays|keeps)\b|\b(above|below|than|by|reach|reaches|equals?|at) [TVNs](?![-\w])|\b[TV] ?[-+] ?[0-9]|\bunits?\b(?! of lots?)/;
const placeholderText = (l) => l.replace(/\(src:.*$/, '').replace(/\b\d+=[\w.]+(\s+(or|and)\s+[\w.]+)*/g, ' ')
  .replace(/\b[AB]-?book\b/gi, ' ').replace(/\b(settle\w*|value date|SettlDate|SettlType)\b[^;,.]*?\bT ?\+ ?\d\b/gi, ' ');
function auditDesignConcrete(report, workDir) {
  if (!report) return [];
  const checks = String(report).split('\n').filter((l) => /^- .* => /.test(l));
  const issues = [];
  const abstract = checks.filter((l) => PLACEHOLDER.test(placeholderText(l)));
  if (abstract.length) issues.push({ code: 'design-abstract', items: abstract.map((l) => l.slice(0, 80)), text: `${abstract.length} check(s) use placeholders (A/B/C, T, V, units) instead of real accounts, lots and API field names` });
  let setup = '';
  try { setup = fs.readFileSync(path.join(workDir || '', 'autotest-setup.md'), 'utf8'); } catch (_) { /* brak pliku: nie dotyczy */ }
  const ids = [...setup.matchAll(/^\| \d+ \| (\d+) \|/gm), ...setup.matchAll(/klient (\d+)/g)].map((m) => m[1]);
  if (ids.length && checks.some((l) => /hedg|tranche|hedge exposure/i.test(l)) && !checks.some((l) => ids.some((id) => new RegExp(`\\b${id}\\b`).test(l)))) {
    issues.push({ code: 'design-no-accounts', text: 'The design is about the hedger but no check names an account from the AUTOTEST rules (autotest-setup.md)' });
  }
  return issues;
}

/** Tekst tury korekty dla agenta, gdy audyt coś znalazł. */
function correctionPrompt(mode, issues) {
  const list = issues.map((i) => '- ' + i.text).join('\n');
  if (mode === 'qamcp') {
    return 'APLIKACJA SPRAWDZIŁA TWÓJ RAPORT Z TYM, CO NAPRAWDĘ WYKONAŁEŚ W TYM RUNIE, i znalazła rozbieżności:\n' + list + '\n\n'
      + 'Popraw raport. Zasady: raport opisuje wyłącznie wywołania, które wykonałeś, i wartości, które naprawdę odczytałeś. '
      + 'Opis endpointu (general_read_describe_endpoint) mówi tylko, jak endpoint wygląda — nie jest odczytem środowiska; to, czego nie wywołałeś, opisz jako niewykonane albo usuń. '
      + 'Jeśli brakującą rzecz da się jeszcze sprawdzić ODCZYTEM, możesz go wykonać; niczego nie zapisuj ani nie zmieniaj. '
      + (issues.some((i) => /call-ref|value-not-in-call/.test(i.code))
        ? 'Każda odczytana wartość w KROKI i OTRZYMANO ma po sobie numer wywołania, z którego pochodzi ([c17], pole _call odpowiedzi), i musi w nim być. Wartość wyliczona przez Ciebie (suma, podział wag) to nie odczyt: oznacz ją "(wyliczone: …)". Wartości, której nie ma w żadnym wywołaniu, nie podawaj jako odczytanej. '
        : '')
      + (issues.some((i) => i.code === 'chat-too-few')
        ? 'Za mało pytań czatu MCP: general_read_ask_mcp_chat_battery to ODCZYT, więc teraz uruchom JEDNĄ baterię z brakującymi pytaniami dla wszystkich wskazanych narzędzi MCP (szablony × dane, tyle pytań, ile brakuje do minimum, z expect z wyroczni PLAT odczytanej w tym runie, intent = nazwa narzędzia MCP) i oprzyj raport na ich metrykach. '
        : '')
      + 'Zwróć CAŁĄ odpowiedź końcową od nowa, w tym samym formacie (STATUS, --- TREŚĆ ---, --- KONIEC TREŚCI ---).';
  }
  const flow = issues.some((i) => /^flow-/.test(i.code))
    ? 'Przy flow testera: rozpisz zlecenie testera na elementy F1, F2, … i dodaj linię "Flow:" mapującą każdy na punkt (§n) albo To confirm. '
      + 'Punkty, które tylko zapisują konfigurację reguły (zapisana / odrzucona), a o które tester nie prosił, zastąp sprawdzeniami WYKONUJĄCYMI jego flow '
      + 'na systemie (konfiguracja w regule AUTOTEST → zachowanie → obserwacja zleceń / ekspozycji), z wynikiem potwierdzonym w kodzie (skill spec-checks, „Flow testera"). '
    : '';
  const evidence = issues.some((i) => /^evidence-/.test(i.code))
    ? 'Dla każdego błędnego dowodu otwórz plik Read/Grep i podaj prawdziwą ścieżkę i numer linii. Jeśli twierdzenia nie da się poprzeć kodem, '
      + 'usuń je z raportu albo przenieś do "Do sprawdzenia ręcznie" / "To confirm before testing" — nie zostawiaj dowodu, którego nie ma. '
    : '';
  const bugs = issues.some((i) => /^bugs-/.test(i.code))
    ? 'Rejestr błędów to wzorzec, nie kopia: z bug-registry.md bierzesz flow testera i klasę błędu, a sprawdzenie budujesz dla testowanej funkcji '
      + 'z własnymi wartościami z repo. Usuń sprawdzenia, które powtarzają przypadek z rejestru albo dotyczą błędów z sekcji ZGLOSZONE JUZ W TESTOWANYM TICKECIE, '
      + 'i dodaj w nagłówku linię "Bug patterns: <KLUCZ> <klasa błędu> → §n | …" (albo "Bug patterns: none for <serwis>"). '
    : '';
  const concrete = issues.some((i) => /^design-(abstract|no-accounts)$/.test(i.code))
    ? 'Opisz sprawdzenia na przykładzie reguł AUTOTEST z autotest-setup.md: prawdziwe numery kont zamiast liter, wolumen w lotach na symbolu z reguły, '
      + 'progi i limity liczbą, kroki numerowane w kolejności, pola konfiguracji pod nazwą z API, wynik per konto w lotach i miejsce odczytu. '
    : '';
  const business = issues.some((i) => /^business-/.test(i.code))
    ? 'Najpierw biznes, potem ISTQB: punkty raportu to przypadki biznesowe z WORK_DIR/business-cases.md (z ticketu, komentarzy, flow, Confluence i historii błędów). '
      + 'Dodaj linię "Business cases: BC1 <sytuacja>→§n | … | BCn→To confirm", przypisz każdy punkt do przypadku, a tytuły opisz jako sytuację użycia i jej skutek '
      + '(pozycje, ekspozycja, stan, pieniądze), z techniką w nawiasie. Punkt, którego nie da się przypisać do żadnego przypadku, wytnij. '
    : '';
  return 'APLIKACJA SPRAWDZIŁA TWÓJ RAPORT (dowody z pobranym kodem, zgodność ze zleceniem testera) i znalazła problemy:\n' + list + '\n\n'
    + evidence + flow + bugs + concrete + business
    + 'Uruchom walidator raportu ponownie na poprawionej treści i zwróć CAŁĄ odpowiedź końcową od nowa, w tym samym formacie.';
}

module.exports = {
  auditDesignBugs,
  auditDesignBusiness,
  auditDesignConcrete,
  auditDesignFlow,
  auditEvidence,
  auditQamcp,
  chatBatteries,
  chatCases,
  correctionPrompt,
  hasTesterFlow,
  parseAnalysis,
  parseDesign,
  parseQamcp,
  parseReport,
  splitSteps,
};
