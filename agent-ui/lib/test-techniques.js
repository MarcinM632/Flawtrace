// Deterministyczny silnik technik projektowania testów ISTQB (CTFL 4.0, rozdz. 4.2): klasy równoważności (EP),
// analiza wartości brzegowych (BVA, 2- i 3-punktowa), tablice decyzyjne (DT), przejścia stanów (ST) i pairwise (PW).
//
// Zasada: model nie zgaduje elementów pokrycia ani oczekiwanych wyników. Liczy je ten moduł — z ograniczeń w
// specyfikacji OpenAPI (minimum/maximum/minLength/maxLength/enum/required/format/type) albo z modelu reguł, który
// agent wypisał z ticketu (tablica decyzyjna, maszyna stanów, zbiór parametrów) ze źródłem. Każdy element pokrycia
// ma stały identyfikator (ten sam przy każdym przeliczeniu), oczekiwany wynik i wyrocznię (skąd ten wynik).
// Dzięki temu aplikacja mierzy pokrycie techniki faktami ("BVA quantity: 4/4"), a nie deklaracją modelu.
//
// Identyfikatory:  EP:<endpoint>:<pole>:<partycja>   BVA:<endpoint>:<pole>:<punkt>
//                  DT:<tablica>:<kolumna>            ST:<maszyna>:<stan>+<zdarzenie>       PW:<zbiór>:<wiersz>
// <endpoint> to np. "post-orders" (metoda + ścieżka), cel (target) to identyfikator bez ostatniej części.
const fs = require('fs');
const path = require('path');

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const TECH = {
  EP: 'Equivalence partitioning',
  BVA: 'Boundary value analysis',
  DT: 'Decision table',
  ST: 'State transition',
  PW: 'Pairwise',
};
const MAX_DT_CONDITIONS = 6; // 2^6 = 64 kolumny; więcej to tablica do podziału, nie do testu
const MAX_ITEMS = 2000;

/* ------------------------------------------------ pomocnicze ------------------------------------------------ */
const epSlug = (method, p) => (String(method).toLowerCase() + '-' + String(p).replace(/[{}]/g, '')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const valSlug = (v) => String(v).replace(/\s+/g, '_').replace(/[^\w.\-+=@]/g, '') || 'empty';
const idSlug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9_.\-]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
const decimals = (x) => { const s = String(x); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; };
const roundTo = (x, d) => Number(Number(x).toFixed(Math.min(d, 10)));
const sameOp = (a, b) => String(a || '').toUpperCase() === String(b || '').toUpperCase();
/** Szablon ścieżki pasuje do ścieżki (parametry {x} dowolne). */
const pathMatch = (tpl, p) => {
  const norm = (s) => String(s).replace(/\/+$/, '').replace(/\{[^}]+\}/g, '{}');
  return norm(tpl) === norm(p);
};

function deref(doc, node, seen = new Set()) {
  if (!node || typeof node !== 'object' || typeof node.$ref !== 'string' || !node.$ref.startsWith('#/')) return node;
  if (seen.has(node.$ref)) return {};
  seen.add(node.$ref);
  const t = node.$ref.slice(2).split('/').reduce((o, k) => (o ? o[k.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined), doc);
  return deref(doc, t || {}, seen);
}
/** Schemat po rozwinięciu allOf (właściwości i required łączone). */
function flat(doc, schema) {
  const s = deref(doc, schema) || {};
  if (!s.allOf) return s;
  const parts = s.allOf.map((x) => flat(doc, x));
  return { ...s, type: s.type || 'object', properties: Object.assign({}, ...parts.map((x) => x.properties || {}), s.properties || {}), required: [...new Set([...parts.flatMap((x) => x.required || []), ...(s.required || [])])] };
}

/** Wszystkie operacje dokumentu: { method, path, op, doc }. */
function operations(docs) {
  const out = [];
  for (const doc of docs || []) {
    for (const [p, item] of Object.entries((doc && doc.paths) || {})) {
      for (const m of METHODS) if (item && item[m]) out.push({ method: m.toUpperCase(), path: p, op: item[m], shared: item.parameters || [], doc });
    }
  }
  return out;
}
/** Znajduje operację po "POST /orders" (albo po nazwie operationId). */
function findOperation(docs, ref) {
  const s = String(ref || '').trim();
  const m = s.match(/^([A-Za-z]+)\s+(\S+)$/);
  const all = operations(docs);
  if (m) return all.find((o) => sameOp(o.method, m[1]) && pathMatch(o.path, m[2])) || null;
  const id = s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return all.find((o) => String(o.op.operationId || '').toLowerCase().replace(/[^a-z0-9]/g, '') === id) || null;
}

/** Pola wejścia operacji z ograniczeniami: ciało JSON (płasko, kropki dla zagnieżdżeń, 2 poziomy) i parametry query. */
function endpointFields(o) {
  const { doc, op } = o;
  const fields = [];
  const add = (name, schema, required, where) => {
    const s = flat(doc, schema);
    fields.push({
      name, in: where, required: !!required,
      type: s.type || (s.enum ? typeof s.enum[0] : s.properties ? 'object' : 'string'),
      ...['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'format', 'nullable', 'example', 'default']
        .reduce((a, k) => (s[k] !== undefined ? { ...a, [k]: s[k] } : a), {}),
      ...(Array.isArray(s.enum) ? { enum: s.enum.slice(0, 50) } : {}),
      ...(s.type === 'object' || s.properties ? { schema: s } : {}),
    });
  };
  const walk = (schema, prefix, depth, parentReq) => {
    const s = flat(doc, schema);
    const req = new Set(s.required || []);
    for (const [k, v] of Object.entries(s.properties || {})) {
      const name = prefix ? `${prefix}.${k}` : k;
      const vs = flat(doc, v);
      if ((vs.type === 'object' || vs.properties) && depth < 1) walk(vs, name, depth + 1, parentReq && req.has(k));
      else add(name, v, parentReq && req.has(k), 'body');
    }
  };
  if (op.requestBody) {
    const rb = deref(doc, op.requestBody) || {};
    const ct = rb.content && (rb.content['application/json'] || Object.values(rb.content)[0]);
    if (ct && ct.schema) walk(ct.schema, '', 0, true);
  }
  for (const raw of [...(o.shared || []), ...(op.parameters || [])]) {
    const q = deref(doc, raw);
    if (!q || !q.name) continue;
    if (q.in === 'body' && q.schema) { walk(q.schema, '', 0, true); continue; } // Swagger 2
    if (q.in !== 'query') continue;
    add(q.name, q.schema || q, q.required, 'query');
  }
  return fields;
}

/* ---------------------------------------------- wartości pól ---------------------------------------------- */
const isNum = (f) => f.type === 'integer' || f.type === 'number';
const stepOf = (f) => (f.type === 'integer' ? 1 : f.multipleOf || 0.01);
/** Najmniejsza i największa dozwolona wartość liczbowa (z exclusive w formie 3.0 i 3.1). */
function range(f) {
  const st = stepOf(f);
  const d = Math.max(decimals(st), decimals(f.minimum || 0), decimals(f.maximum || 0));
  let lo = null, hi = null;
  if (typeof f.exclusiveMinimum === 'number') lo = f.exclusiveMinimum + st;
  else if (typeof f.minimum === 'number') lo = f.exclusiveMinimum === true ? f.minimum + st : f.minimum;
  if (typeof f.exclusiveMaximum === 'number') hi = f.exclusiveMaximum - st;
  else if (typeof f.maximum === 'number') hi = f.exclusiveMaximum === true ? f.maximum - st : f.maximum;
  return { lo: lo == null ? null : roundTo(lo, d), hi: hi == null ? null : roundTo(hi, d), st, d };
}
const FORMAT_OK = { email: 'qa@example.com', date: '2026-01-15', 'date-time': '2026-01-15T10:00:00Z', uuid: '3fa85f64-5717-4562-b3fc-2c963f66afa6', uri: 'https://example.com/a', url: 'https://example.com/a' };
const FORMAT_BAD = { email: 'not-an-email', date: '2026-13-45', 'date-time': 'yesterday', uuid: 'not-a-uuid', uri: 'not a uri', url: 'not a url' };

/** Typowa poprawna wartość pola (środek zakresu, przykład ze specyfikacji, pierwsza wartość enum). */
function validValue(f) {
  if (f.example !== undefined && f.example !== null && typeof f.example !== 'object') return f.example;
  if (f.enum && f.enum.length) return f.enum[0];
  if (f.default !== undefined && typeof f.default !== 'object') return f.default;
  if (isNum(f)) {
    const { lo, hi, st, d } = range(f);
    if (lo != null && hi != null) { const mid = lo + Math.floor((hi - lo) / st / 2) * st; return roundTo(mid, d); }
    if (lo != null) return roundTo(lo + st, d);
    if (hi != null) return roundTo(Math.min(hi, 1), d);
    return 1;
  }
  if (f.type === 'boolean') return true;
  if (f.type === 'array') return [];
  if (f.type === 'object') return {};
  if (f.format && FORMAT_OK[f.format]) return FORMAT_OK[f.format];
  const min = f.minLength || 0, max = f.maxLength == null ? 40 : f.maxLength;
  const len = Math.max(min, Math.min(max, 6));
  return 'qa'.repeat(len).slice(0, len) || (min === 0 ? 'qa'.slice(0, Math.max(0, Math.min(max, 2))) : '');
}

/* ------------------------------------------------ EP i BVA ------------------------------------------------ */
function fieldItems(epRef, ep, f, { bva = 2 } = {}) {
  const items = [];
  const base = (tech, label, extra) => ({
    id: `${tech}:${ep}:${f.name}:${label}`, technique: tech, target: `${tech}:${ep}:${f.name}`,
    endpoint: epRef, field: f.name, label, required: true, ...extra,
  });
  const oracle = (what) => `spec:${epRef}#${f.name}${what ? '.' + what : ''}`;
  // ---- EP: partycje poprawne i niepoprawne
  if (f.enum && f.enum.length) {
    for (const v of f.enum.slice(0, 20)) items.push(base('EP', `enum=${valSlug(v)}`, { value: v, expect: 'accept', oracle: oracle(`enum`) }));
    items.push(base('EP', 'not-in-enum', { value: typeof f.enum[0] === 'number' ? Math.max(...f.enum.filter((x) => typeof x === 'number')) + 1 : '__NOT_IN_ENUM__', expect: 'reject', oracle: oracle('enum') }));
  } else {
    items.push(base('EP', 'valid', { value: validValue(f), expect: 'accept', oracle: oracle('type') }));
  }
  if (isNum(f)) {
    const { lo, hi, st, d } = range(f);
    const span = lo != null && hi != null ? Math.max(st, hi - lo) : 10 * st;
    if (lo != null) items.push(base('EP', 'below-range', { value: roundTo(lo - span, d), expect: 'reject', oracle: oracle(`minimum=${lo}`) }));
    if (hi != null) items.push(base('EP', 'above-range', { value: roundTo(hi + span, d), expect: 'reject', oracle: oracle(`maximum=${hi}`) }));
    items.push(base('EP', 'wrong-type', { value: 'abc', expect: 'reject', oracle: oracle(`type=${f.type}`) }));
    if (f.type === 'integer') items.push(base('EP', 'non-integer', { value: roundTo((lo != null ? lo : 1) + 0.5, 1), expect: 'reject', oracle: oracle('type=integer') }));
  } else if (f.type === 'boolean') {
    items.push(base('EP', 'wrong-type', { value: 'maybe', expect: 'reject', oracle: oracle('type=boolean') }));
  } else if (f.type === 'string') {
    items.push(base('EP', 'wrong-type', { value: { unexpected: true }, expect: 'reject', oracle: oracle('type=string') }));
    if (f.format && FORMAT_BAD[f.format]) items.push(base('EP', 'bad-format', { value: FORMAT_BAD[f.format], expect: 'reject', oracle: oracle(`format=${f.format}`) }));
  }
  if (f.required) {
    items.push(base('EP', 'missing', { omit: true, expect: 'reject', oracle: oracle('required') }));
    if (!f.nullable) items.push(base('EP', 'null', { value: null, expect: 'reject', oracle: oracle('required') }));
  }
  // ---- BVA: wartości na granicach i tuż za nimi (2-punktowa: min-1,min,max,max+1; 3-punktowa dodaje min+1,max-1)
  if (isNum(f)) {
    const { lo, hi, st, d } = range(f);
    const pts = [];
    if (lo != null) { pts.push(['min-1', lo - st, 'reject', `minimum=${lo}`], ['min', lo, 'accept', `minimum=${lo}`]); if (bva === 3) pts.push(['min+1', lo + st, 'accept', `minimum=${lo}`]); }
    if (hi != null) { if (bva === 3) pts.push(['max-1', hi - st, 'accept', `maximum=${hi}`]); pts.push(['max', hi, 'accept', `maximum=${hi}`], ['max+1', hi + st, 'reject', `maximum=${hi}`]); }
    for (const [label, v, exp, what] of pts) items.push(base('BVA', label, { value: roundTo(v, d), expect: exp, oracle: oracle(what) }));
  } else if (f.type === 'string' && (f.minLength != null || f.maxLength != null)) {
    const pts = [];
    const lo = f.minLength || 0, hi = f.maxLength;
    if (lo > 0) { pts.push(['len-min-1', lo - 1, 'reject'], ['len-min', lo, 'accept']); if (bva === 3) pts.push(['len-min+1', lo + 1, 'accept']); }
    if (hi != null) { if (bva === 3 && hi - 1 > lo) pts.push(['len-max-1', hi - 1, 'accept']); pts.push(['len-max', hi, 'accept'], ['len-max+1', hi + 1, 'reject']); }
    for (const [label, n, exp] of pts) {
      // Z wzorcem (pattern) sztucznie zbudowany tekst może złamać wzorzec: element zostaje, ale z ostrzeżeniem.
      items.push(base('BVA', label, { value: 'x'.repeat(Math.max(0, n)), expect: exp, oracle: oracle(/min/.test(label) ? `minLength=${lo}` : `maxLength=${hi}`), ...(f.pattern ? { caution: `the field has a pattern (${f.pattern}); build the value of length ${n} so it matches it` } : {}) }));
    }
  }
  return items;
}

/* ------------------------------------------------ tablica decyzyjna ------------------------------------------------ */
// Model: { kind:'decision-table', id, src, conditions:[{name, values?:[..]} | {name, threshold, op:'>='|'>'|'<'|'<=', step?}],
//          rules:[{ when:{cond: value|'-'}, then:{action: value} }], infeasible?:[{cond:value}] }
// Warunek progowy (threshold) ma wartości true/false, a jako dane wejściowe dostaje wartość NA progu (true) i tuż
// obok (false) — tablica decyzyjna od razu łapie błąd granicy (">=" zamiast ">"), łącząc DT z BVA na warunku.
function thresholdInput(c, truth) {
  const st = c.step || 1, t = Number(c.threshold);
  const d = Math.max(decimals(st), decimals(t));
  const r = (x) => roundTo(x, d);
  switch (c.op || '>=') {
    case '>': return truth ? r(t + st) : t;
    case '<': return truth ? r(t - st) : t;
    case '<=': return truth ? t : r(t + st);
    default: return truth ? t : r(t - st); // '>='
  }
}
function decisionTable(model) {
  const id = idSlug(model.id || 'table');
  const conds = (model.conditions || []).map((c) => ({ ...c, values: c.threshold != null ? [true, false] : (Array.isArray(c.values) && c.values.length ? c.values : [true, false]) }));
  const problems = [];
  if (!conds.length) return { items: [], problems: [`decision table "${id}": no conditions`] };
  if (conds.length > MAX_DT_CONDITIONS) return { items: [], problems: [`decision table "${id}": ${conds.length} conditions give ${2 ** conds.length}+ columns — split it into smaller tables`] };
  let cols = [{}];
  for (const c of conds) cols = cols.flatMap((col) => c.values.map((v) => ({ ...col, [c.name]: v })));
  const eq = (a, b) => String(a) === String(b);
  const matches = (rule, col) => Object.entries(rule.when || {}).every(([k, v]) => v === '-' || v === '*' || eq(v, col[k]));
  const infeasible = (col) => (model.infeasible || []).some((x) => Object.entries(x).every(([k, v]) => eq(v, col[k])));
  const items = [];
  cols.forEach((col, i) => {
    if (infeasible(col)) return;
    const n = i + 1;
    const hit = (model.rules || []).filter((r) => matches(r, col));
    const desc = Object.entries(col).map(([k, v]) => `${k}=${v}`).join(', ');
    const inputs = Object.fromEntries(conds.map((c) => [c.name, c.threshold != null ? thresholdInput(c, col[c.name] === true || col[c.name] === 'true') : col[c.name]]));
    let expect = null;
    if (!hit.length) problems.push(`decision table "${id}" column ${n} (${desc}): no rule says what should happen — a gap in the requirement`);
    else {
      const outs = [...new Set(hit.map((r) => JSON.stringify(r.then || {})))];
      if (outs.length > 1) problems.push(`decision table "${id}" column ${n} (${desc}): rules contradict each other (${outs.join(' vs ')})`);
      else expect = hit[0].then || {};
    }
    items.push({ id: `DT:${id}:${n}`, technique: 'DT', target: `DT:${id}`, table: id, label: String(n), conditions: col, inputs, expect: expect ? { action: expect } : 'unknown', oracle: model.src ? `${model.src} (rule ${hit.length ? (model.rules.indexOf(hit[0]) + 1) : '-'})` : 'model', required: true });
  });
  return { items, problems };
}

/* ------------------------------------------------ przejścia stanów ------------------------------------------------ */
// Model: { kind:'state-machine', id, src, initial, states?:[..], events?:[..], transitions:[{from, event, to}] }
// Elementy wymagane: każde poprawne przejście (pokrycie 0-switch). Niepoprawne pary stan×zdarzenie są elementami
// zalecanymi (required:false) — test negatywny "zdarzenie w złym stanie jest odrzucone, stan bez zmian".
function stateMachine(model) {
  const id = idSlug(model.id || 'machine');
  const tr = (model.transitions || []).filter((t) => t && t.from != null && t.event != null && t.to != null);
  const states = [...new Set([model.initial, ...(model.states || []), ...tr.flatMap((t) => [t.from, t.to])].filter((x) => x != null).map(String))];
  const events = [...new Set([...(model.events || []), ...tr.map((t) => t.event)].map(String))];
  const problems = [];
  if (!tr.length) return { items: [], problems: [`state machine "${id}": no transitions`] };
  const initial = model.initial != null ? String(model.initial) : String(tr[0].from);
  // Najkrótsza ścieżka zdarzeń z initial do każdego stanu (BFS) — gotowy "setup" testu.
  const pathTo = { [initial]: [] };
  const queue = [initial];
  while (queue.length) {
    const s = queue.shift();
    for (const t of tr.filter((x) => String(x.from) === s)) if (!(String(t.to) in pathTo)) { pathTo[String(t.to)] = [...pathTo[s], String(t.event)]; queue.push(String(t.to)); }
  }
  for (const s of states) if (!(s in pathTo)) problems.push(`state machine "${id}": state "${s}" cannot be reached from "${initial}" — either a missing transition or a dead state in the requirement`);
  const dup = new Map();
  for (const t of tr) { const k = `${t.from}+${t.event}`; if (dup.has(k) && dup.get(k) !== String(t.to)) problems.push(`state machine "${id}": "${t.event}" in "${t.from}" leads to two states (${dup.get(k)}, ${t.to})`); dup.set(k, String(t.to)); }
  const items = [];
  for (const t of tr) {
    items.push({ id: `ST:${id}:${valSlug(t.from)}+${valSlug(t.event)}`, technique: 'ST', target: `ST:${id}`, machine: id, label: `${t.from}+${t.event}`, from: String(t.from), event: String(t.event), path: pathTo[String(t.from)] || null, expect: { state: String(t.to) }, oracle: model.src || 'model', required: true, valid: true });
  }
  for (const s of states) for (const e of events) {
    if (dup.has(`${s}+${e}`)) continue;
    items.push({ id: `ST:${id}:${valSlug(s)}+${valSlug(e)}`, technique: 'ST', target: `ST:${id}`, machine: id, label: `${s}+${e}`, from: s, event: e, path: pathTo[s] || null, expect: 'reject', unchanged: s, oracle: model.src || 'model', required: false, valid: false });
  }
  return { items, problems, initial, states, events };
}

/* ------------------------------------------------ pairwise ------------------------------------------------ */
// Model: { kind:'pairwise', id, src, parameters:{name:[values]} } albo { kind:'pairwise', id, endpoint:'POST /x', fields:[..] }
// (wartości z enum w specyfikacji), opcjonalnie excluded:[{a:'x', b:'y'}] — pary niemożliwe biznesowo.
// Deterministyczny zachłanny generator (w stylu AETG bez losowości): każdy wiersz zaczyna od pierwszej niepokrytej
// pary i dobiera resztę parametrów tak, by pokryć jak najwięcej nowych par. Ten sam model = te same wiersze.
function pairwise(model, docs) {
  const id = idSlug(model.id || 'set');
  let params = model.parameters || {};
  const problems = [];
  if (model.endpoint && Array.isArray(model.fields)) {
    const o = findOperation(docs, model.endpoint);
    if (!o) return { items: [], problems: [`pairwise "${id}": endpoint ${model.endpoint} is not in the specification`] };
    const fs_ = endpointFields(o);
    params = {};
    for (const n of model.fields) { const f = fs_.find((x) => x.name === n); if (f && f.enum) params[n] = f.enum; else if (f && f.type === 'boolean') params[n] = [true, false]; else problems.push(`pairwise "${id}": field "${n}" has no enum in the specification`); }
  }
  const names = Object.keys(params).filter((k) => Array.isArray(params[k]) && params[k].length);
  if (names.length < 2) return { items: [], problems: [...problems, `pairwise "${id}": needs at least two parameters with values`] };
  const ex = (model.excluded || []).map((e) => Object.entries(e));
  const bad = (row) => ex.some((pairs) => pairs.every(([k, v]) => k in row && String(row[k]) === String(v)));
  const key = (i, a, j, b) => `${i}=${a}|${j}=${b}`;
  const uncovered = new Set();
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) for (const a of params[names[i]]) for (const b of params[names[j]]) {
    if (!bad({ [names[i]]: a, [names[j]]: b })) uncovered.add(key(i, String(a), j, String(b)));
  }
  const totalPairs = uncovered.size;
  const rows = [];
  const newPairs = (row) => { let n = 0; const set = Object.keys(row).map((k) => names.indexOf(k)).sort((x, y) => x - y); for (let x = 0; x < set.length; x++) for (let y = x + 1; y < set.length; y++) if (uncovered.has(key(set[x], String(row[names[set[x]]]), set[y], String(row[names[set[y]]])))) n++; return n; };
  // Wiersz zbudowany od pary-ziarna: reszta parametrów dobrana zachłannie, w stałej kolejności (bez losowości).
  const grow = (seed) => {
    const [p1, p2] = seed.split('|');
    const [i, a] = p1.split('='), [j, b] = p2.split('=');
    const row = { [names[+i]]: params[names[+i]].find((v) => String(v) === a), [names[+j]]: params[names[+j]].find((v) => String(v) === b) };
    for (const n of names) {
      if (n in row) continue;
      let best = null, bestScore = -1;
      for (const v of params[n]) { const cand = { ...row, [n]: v }; if (bad(cand)) continue; const s = newPairs(cand); if (s > bestScore) { best = v; bestScore = s; } }
      row[n] = best === null ? params[n][0] : best;
    }
    // Stała kolejność kluczy = kolejność parametrów modelu.
    return Object.fromEntries(names.map((n) => [n, row[n]]));
  };
  let guard = 0;
  while (uncovered.size && guard++ < 1000) {
    // Kilka kandydatów (każdy od innej niepokrytej pary) i wybór tego, który pokrywa najwięcej nowych par.
    let row = null, score = -1;
    for (const seed of [...uncovered].slice(0, 40)) { const cand = grow(seed); const s = newPairs(cand); if (s > score) { row = cand; score = s; } }
    const before = uncovered.size;
    for (let x = 0; x < names.length; x++) for (let y = x + 1; y < names.length; y++) uncovered.delete(key(x, String(row[names[x]]), y, String(row[names[y]])));
    if (uncovered.size === before) break; // nie powinno się zdarzyć; chroni przed pętlą
    rows.push(row);
  }
  const items = rows.map((row, k) => ({ id: `PW:${id}:${k + 1}`, technique: 'PW', target: `PW:${id}`, set: id, label: String(k + 1), endpoint: model.endpoint || null, inputs: row, expect: model.expect || 'accept', oracle: model.src || (model.endpoint ? `spec:${model.endpoint}#enum` : 'model'), required: true }));
  const exhaustive = names.reduce((a, n) => a * params[n].length, 1);
  return { items, problems, pairs: totalPairs, exhaustive };
}

/* ------------------------------------------------ formularze UI ------------------------------------------------ */
// Ograniczenia pól formularza z jego kodu: HTML (maxlength="50", required, min/max/step, pattern, type, <select>) i JSX
// (maxLength={50}, required, min={1}). Wynik ma kształt pól endpointu, więc EP/BVA liczą się tak samo jak dla API.
const ATTR_RE = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*["']?([^}"']*)["']?\s*\}|([^\s>]+)))?/g;
function attrs(tag) {
  const out = {};
  const body = tag.replace(/^<\s*[\w-]+/, '').replace(/\/?>$/, '');
  for (const m of body.matchAll(ATTR_RE)) {
    const k = m[1].toLowerCase();
    const v = m[2] ?? m[3] ?? m[4] ?? m[5];
    out[k] = v === undefined ? true : v;
  }
  return out;
}
const num = (v) => (v === undefined || v === true || v === '' || isNaN(Number(v)) ? undefined : Number(v));
/** Pola formularza z jego kodu: [{ name, in:'form', required, type, minimum, maximum, multipleOf, minLength, maxLength, pattern, format, enum }] */
function formFields(html) {
  const src = String(html || '');
  const fields = [];
  const seen = new Set();
  const add = (f) => { if (!f.name || seen.has(f.name)) return; seen.add(f.name); fields.push(f); };
  // <input>, <textarea> i komponenty JSX z nazwą pola (<TextField name=... inputProps={{ maxLength: 20 }} />).
  for (const m of src.matchAll(/<\s*(input|textarea|[A-Z][\w.]*)\b(?:[^>{]|\{\{[^}]*\}\}|\{[^}]*\})*>/g)) {
    const a = attrs(m[0].replace(/\{\{[^}]*\}\}/g, '""'));
    const isComp = /^[A-Z]/.test(m[1]);
    if (isComp && !a.name) continue;
    // inputProps={{ maxLength: 20, min: 1 }} i podobne obiekty w JSX: klucze ograniczeń wprost z obiektu.
    for (const o of m[0].matchAll(/\b(maxLength|minLength|min|max|step|pattern)\s*:\s*["']?([^,}"']+)["']?/g)) a[o[1].toLowerCase()] = o[2].trim();
    if (isComp && /select/i.test(m[1]) && !a.type) a.type = 'text';
    const name = a.name || a.id || a['data-testid'] || a['aria-label'];
    if (!name || name === true) continue;
    const t = String(m[1].toLowerCase() === 'textarea' ? 'textarea' : (a.type && a.type !== true ? a.type : 'text')).toLowerCase();
    if (/^(hidden|submit|button|reset|image|file|radio)$/.test(t)) continue;
    const req = a.required !== undefined && a.required !== 'false';
    const base = { name: String(name), in: 'form', required: req };
    if (t === 'checkbox') { add({ ...base, type: 'boolean' }); continue; }
    if (t === 'number' || t === 'range') {
      const st = num(a.step);
      add({ ...base, type: st != null && !Number.isInteger(st) ? 'number' : 'integer', minimum: num(a.min), maximum: num(a.max), ...(st != null && !Number.isInteger(st) ? { multipleOf: st } : {}) });
      continue;
    }
    const format = { email: 'email', url: 'url', date: 'date', 'datetime-local': 'date-time' }[t];
    add({ ...base, type: 'string', minLength: num(a.minlength), maxLength: num(a.maxlength), ...(a.pattern && a.pattern !== true ? { pattern: a.pattern } : {}), ...(format ? { format } : {}) });
  }
  for (const m of src.matchAll(/<\s*select\b([^>]*)>([\s\S]*?)<\/\s*select\s*>/gi)) {
    const a = attrs('<select' + m[1] + '>');
    const name = a.name || a.id || a['data-testid'];
    if (!name || name === true) continue;
    const opts = [...m[2].matchAll(/<\s*option\b([^>]*)>([^<]*)/gi)].map((o) => { const oa = attrs('<option' + o[1] + '>'); return oa.value !== undefined && oa.value !== true ? String(oa.value) : o[2].trim(); }).filter((v) => v !== '');
    add({ name: String(name), in: 'form', required: a.required !== undefined && a.required !== 'false', type: 'string', ...(opts.length ? { enum: opts } : {}) });
  }
  // Pola bez żadnego ograniczenia nie dają elementów pokrycia poza "valid" — zostawiamy tylko te z ograniczeniem.
  return fields.filter((f) => f.required || f.enum || f.type === 'boolean' || ['minimum', 'maximum', 'minLength', 'maxLength', 'format'].some((k) => f[k] !== undefined));
}
/** Elementy EP/BVA formularza: identyfikatory "EP:form-<nazwa>:<pole>:<partycja>". Oczekiwany wynik "reject" znaczy
 * w UI: formularz nie zostaje wysłany albo pokazuje błąd walidacji, a dane nie są zapisane. */
function formItems(name, html, { bva = 2 } = {}) {
  const ep = 'form-' + idSlug(name);
  const items = [];
  for (const f of formFields(html)) for (const it of fieldItems(`form ${name}`, ep, f, { bva })) {
    // Typów, których przeglądarka nie pozwoli wpisać w pole (obiekt w polu tekstowym, tekst w polu liczbowym), w UI
    // nie da się przetestować: zostają tylko partycje możliwe do wpisania.
    if (it.label === 'wrong-type' || it.label === 'null') continue;
    items.push({ ...it, oracle: it.oracle.replace(/^spec:form [^#]+/, `form:${name}`), ui: true });
  }
  return items;
}

/* ------------------------------------------------ złożenie ------------------------------------------------ */
/**
 * Liczy elementy pokrycia.
 * @param {object} o  { docs: [dokumenty OpenAPI], endpoints: ['POST /orders', ...] | 'all', models: [...], bva: 2|3 }
 * @returns {{ items, targets, problems, notes }}
 */
function build({ docs = [], endpoints = [], models = [], bva = 2, forms = [] } = {}) {
  const items = [], problems = [], notes = [];
  for (const fm of forms || []) {
    if (!fm || !fm.html) continue;
    const its = formItems(fm.name || 'form', fm.html, { bva });
    if (!its.length) notes.push(`form "${fm.name || 'form'}": no field with a constraint (required, min/max, length, type, options) in its code`);
    items.push(...its);
  }
  const want = endpoints === 'all' ? operations(docs).filter((o) => o.method !== 'GET' && o.method !== 'DELETE').map((o) => `${o.method} ${o.path}`) : (endpoints || []);
  for (const ref of want) {
    const o = findOperation(docs, ref);
    if (!o) { problems.push(`endpoint ${ref} is not in the imported specification`); continue; }
    const epRef = `${o.method} ${o.path}`;
    const ep = epSlug(o.method, o.path);
    const fields = endpointFields(o);
    if (!fields.length) notes.push(`${epRef}: no input fields with a schema — nothing for EP/BVA`);
    for (const f of fields) {
      if (f.type === 'object' || f.type === 'array') continue;
      items.push(...fieldItems(epRef, ep, f, { bva }));
      if (f.pattern && (f.minLength != null || f.maxLength != null)) notes.push(`${epRef} ${f.name}: has a pattern — length boundary values must be built to match it`);
    }
  }
  for (const m of models || []) {
    if (!m || typeof m !== 'object') continue;
    const kind = String(m.kind || '').toLowerCase();
    const res = /decision/.test(kind) ? decisionTable(m) : /state/.test(kind) ? stateMachine(m) : /pair/.test(kind) ? pairwise(m, docs)
      : /form/.test(kind) ? { items: formItems(m.id || 'form', m.html || '', { bva }), problems: m.html ? [] : [`form "${m.id || '?'}": no "html" (the code of the form)`] }
      : { items: [], problems: [`model "${m.id || '?'}": unknown kind "${m.kind}" (decision-table, state-machine, pairwise, form)`] };
    items.push(...res.items);
    problems.push(...res.problems);
    if (res.pairs != null) notes.push(`pairwise "${idSlug(m.id)}": ${res.items.length} rows cover all ${res.pairs} pairs (exhaustive would be ${res.exhaustive})`);
  }
  const uniq = [...new Map(items.slice(0, MAX_ITEMS).map((x) => [x.id, x])).values()];
  const targets = {};
  for (const it of uniq) {
    const t = targets[it.target] || (targets[it.target] = { target: it.target, technique: it.technique, total: 0, required: 0 });
    t.total++; if (it.required) t.required++;
  }
  if (items.length > MAX_ITEMS) notes.push(`more than ${MAX_ITEMS} coverage items — only the first ${MAX_ITEMS} are listed; narrow the endpoints`);
  return { items: uniq, targets, problems, notes };
}

/** Identyfikatory elementów pokrycia w tekście (np. w "(src: ...; ci: BVA:post-orders:quantity:max+1)"). */
const CI_RE = /\b(?:EP|BVA|DT|ST|PW):[\w.\-]+(?::[\w.\-+=@]+)+/g;
const ciRefs = (text) => [...new Set(String(text || '').match(CI_RE) || [])];
const targetOf = (id) => { const p = String(id).split(':'); return /^(EP|BVA)$/.test(p[0]) ? p.slice(0, 3).join(':') : p.slice(0, 2).join(':'); };

/**
 * Pokrycie: które elementy wymagane wskazanych celów są przywołane w projekcie.
 * @param {object} res  wynik build()
 * @param {string[]} cited  identyfikatory przywołane w checkach
 * @param {Set<string>} excused  identyfikatory wpisane do Not covered / To confirm (świadomie pominięte)
 */
function coverage(res, cited, excused = new Set()) {
  const citedSet = new Set(cited);
  const byId = new Map(res.items.map((x) => [x.id, x]));
  const targets = [...new Set(cited.filter((c) => byId.has(c)).map(targetOf))];
  const per = targets.map((t) => {
    const all = res.items.filter((x) => x.target === t);
    const req = all.filter((x) => x.required);
    const covered = req.filter((x) => citedSet.has(x.id));
    const skipped = req.filter((x) => !citedSet.has(x.id) && excused.has(x.id));
    const missing = req.filter((x) => !citedSet.has(x.id) && !excused.has(x.id));
    const optional = all.filter((x) => !x.required);
    return { target: t, technique: all[0] ? all[0].technique : t.split(':')[0], required: req.length, covered: covered.length, excused: skipped.map((x) => x.id), missing: missing.map((x) => x.id), optional: optional.length, optionalCovered: optional.filter((x) => citedSet.has(x.id)).length };
  });
  const byTechnique = {};
  for (const p of per) { const b = byTechnique[p.technique] || (byTechnique[p.technique] = { required: 0, covered: 0, excused: 0 }); b.required += p.required; b.covered += p.covered; b.excused += p.excused.length; }
  return { targets: per, byTechnique, unknown: cited.filter((c) => !byId.has(c)) };
}

/** Tekst dla agenta: elementy pokrycia pogrupowane po celu, z oczekiwanym wynikiem i wyrocznią. */
function render(res) {
  const fmt = (v) => (v === undefined ? '' : typeof v === 'string' ? JSON.stringify(v.length > 40 ? v.slice(0, 20) + `…(${v.length} chars)` : v) : JSON.stringify(v));
  const exp = (it) => (it.expect === 'accept' ? (it.ui ? 'the form is submitted and the value saved as typed' : 'accepted') : it.expect === 'reject' ? (it.ui ? 'a validation message, the form is not submitted, nothing saved' : 'rejected (4xx, nothing stored)') : it.expect === 'unknown' ? 'UNKNOWN — no rule in the source (To confirm)' : it.expect.state ? `state becomes "${it.expect.state}"` : it.expect.action ? Object.entries(it.expect.action).map(([k, v]) => `${k} = ${v}`).join(', ') : JSON.stringify(it.expect));
  const out = [];
  const groups = {};
  for (const it of res.items) (groups[it.target] = groups[it.target] || []).push(it);
  for (const [t, list] of Object.entries(groups)) {
    out.push(`### ${t}  (${TECH[list[0].technique]}, ${list.filter((x) => x.required).length} required${list.some((x) => !x.required) ? `, ${list.filter((x) => !x.required).length} optional` : ''})`);
    for (const it of list) {
      const input = it.omit ? `${it.field} omitted` : it.field ? `${it.field}=${fmt(it.value)}` : it.inputs ? Object.entries(it.inputs).map(([k, v]) => `${k}=${fmt(v)}`).join(', ') : it.from ? `in "${it.from}"${it.path && it.path.length ? ` (reach it by: ${it.path.join(' → ')})` : it.path ? ' (initial state)' : ' (unreachable)'} fire "${it.event}"` : '';
      out.push(`- \`${it.id}\` ${input} → ${exp(it)}${it.required ? '' : ' [optional]'} (oracle: ${it.oracle})${it.caution ? ` — ${it.caution}` : ''}`);
    }
  }
  if (res.problems.length) out.push('', '### Problems in the requirement / model (put them in "To confirm")', ...res.problems.map((p) => `- ${p}`));
  if (res.notes.length) out.push('', '### Notes', ...res.notes.map((n) => `- ${n}`));
  return out.join('\n') || 'No coverage items: give endpoints that have a JSON schema, or models (decision-table, state-machine, pairwise).';
}

/** Surowe dokumenty OpenAPI z katalogu specyfikacji (te same pliki co openapi.loadFolder). */
function loadDocs(dir) {
  const out = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'sources.json').sort(); } catch (_) { return out; }
  for (const f of files) { try { out.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch (_) { /* zły plik: pomijamy */ } }
  return out;
}
/** Modele reguł z WORK_DIR/technique-models.json (tablica albo { models: [...] }). */
function loadModels(workDir) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(workDir || '', 'technique-models.json'), 'utf8'));
    return Array.isArray(j) ? j : Array.isArray(j.models) ? j.models : [];
  } catch (_) { return []; }
}

module.exports = {
  TECH, build, coverage, render, ciRefs, targetOf, loadDocs, loadModels,
  endpointFields, findOperation, operations, validValue, range, epSlug, formFields, formItems,
  decisionTable, stateMachine, pairwise, fieldItems,
};
