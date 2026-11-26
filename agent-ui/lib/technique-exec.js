// Wykonanie elementów pokrycia technik (lib/test-techniques.js) na żywym API — deterministycznie, bez modelu.
//
// EP/BVA wykonuje się sam: poprawne ciało żądania z ograniczeń specyfikacji, jedno pole zmienione na wartość
// elementu (albo pominięte), wysyłka i porównanie z wyrocznią. Asercja jest na STANIE, nie tylko na statusie:
// - wartość przyjęta musi być zapisana tak, jak ją wysłano (odczyt zwrotny GET <ścieżka>/{id}),
// - wartość odrzucona nie może niczego zapisać (liczność listy GET <ścieżka> przed i po),
// - 5xx to zawsze defekt (wejście niepoprawne ma dostać 4xx, nie awarię).
// DT/ST/PW potrzebują wiedzy, jak ustawić warunki i odczytać wynik — to wiązanie (bind) podaje wywołujący.
const tech = require('./test-techniques');

const getPath = (o, p) => String(p).split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
function setPath(o, p, v, omit) {
  const ks = String(p).split('.');
  let cur = o;
  for (const k of ks.slice(0, -1)) { if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {}; cur = cur[k]; }
  if (omit) delete cur[ks[ks.length - 1]]; else cur[ks[ks.length - 1]] = v;
}
/** Poprawne ciało żądania operacji: każde pole z wartością typową (tech.validValue). */
function validBody(fields) {
  const body = {};
  for (const f of fields) if (f.in === 'body' && f.type !== 'object' && f.type !== 'array') setPath(body, f.name, tech.validValue(f));
  return body;
}
const same = (a, b) => (typeof a === 'number' || typeof b === 'number' ? Number(a) === Number(b) : JSON.stringify(a) === JSON.stringify(b));

/** Klient HTTP. onCall(wpis) → numer dowodu (np. "c7"), gdy wywołujący prowadzi log wywołań. */
function client({ baseUrl, headers = {}, fetchImpl = fetch, timeoutMs = 10000, onCall = null, readOnly = false }) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  return async function call(method, p, body) {
    if (readOnly && !['GET', 'HEAD'].includes(method)) return { status: 0, json: null, text: `the environment is read only, ${method} is not allowed`, ref: null, refused: true };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const started = Date.now();
    let out;
    try {
      const res = await fetchImpl(base + p, { method, headers: { 'content-type': 'application/json', accept: 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal });
      const text = await res.text();
      let json = null; try { json = text ? JSON.parse(text) : null; } catch (_) { /* nie JSON */ }
      out = { status: res.status, json, text: text.slice(0, 500) };
    } catch (e) { out = { status: 0, json: null, text: String(e && e.message || e) }; } finally { clearTimeout(timer); }
    out.ref = onCall ? onCall({ method, path: p, body, status: out.status, response: out.json != null ? out.json : out.text, ms: Date.now() - started }) : null;
    return out;
  };
}

const deepMerge = (a, b) => {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b === undefined ? a : b;
  const out = { ...(a && typeof a === 'object' ? a : {}) };
  for (const [k, v] of Object.entries(b)) out[k] = deepMerge(out[k], v);
  return out;
};
const fillPath = (tpl, params) => {
  let missing = null;
  const p = tpl.replace(/\{([^}]+)\}/g, (_, k) => { if (params[k] === undefined) { missing = missing || k; return ''; } return encodeURIComponent(String(params[k])); });
  return missing ? { missing } : { path: p };
};

/**
 * Żądanie kontrolne: poprawne ciało (wygenerowane + baseBody od wywołującego) musi zostać przyjęte, zanim cokolwiek
 * zostanie uznane za defekt. Na prawdziwym środowisku wygenerowany wzorzec bywa odrzucony z powodów spoza
 * specyfikacji (klient musi istnieć, unikalny e-mail) — wtedy przypadki endpointu są "blocked", nie fałszywe "fail".
 */
async function control(o, ctx) {
  const key = `${o.method} ${o.path}`;
  if (ctx.controls.has(key)) return ctx.controls.get(key);
  const fp = fillPath(o.path, ctx.pathParams || {});
  let res;
  if (fp.missing) res = { ok: false, why: `path parameter "${fp.missing}" is needed (pass path_params)` };
  else {
    const body = deepMerge(validBody(tech.endpointFields(o)), (ctx.baseBody || {})[key]);
    const r = await ctx.call(o.method, fp.path, ['GET', 'DELETE'].includes(o.method) ? undefined : body);
    res = r.refused ? { ok: false, why: r.text }
      : r.status >= 200 && r.status < 300 ? { ok: true, path: fp.path, body, ref: r.ref }
      : { ok: false, ref: r.ref, why: `the control request with a valid body was refused (${r.status}${r.json && (r.json.error || r.json.message) ? ': ' + String(r.json.error || r.json.message).slice(0, 120) : ''}) — pass base_body with real values for ${key}` };
  }
  ctx.controls.set(key, res);
  return res;
}

/** Jeden element EP/BVA. */
async function runField(item, ctx) {
  const { docs, call, readBack } = ctx;
  const o = tech.findOperation(docs, item.endpoint);
  if (!o) return { verdict: 'skip', why: `${item.endpoint} not in the specification` };
  const fields = tech.endpointFields(o);
  const f = fields.find((x) => x.name === item.field);
  if (!f) return { verdict: 'skip', why: `field ${item.field} not found` };
  const ctl = await control(o, ctx);
  if (!ctl.ok) return { verdict: 'blocked', why: ctl.why, calls: ctl.ref ? [ctl.ref] : [] };
  const calls = [];
  const track = async (...a) => { const r = await call(...a); if (r.ref) calls.push(r.ref); return r; };
  const body = JSON.parse(JSON.stringify(ctl.body));
  let query = '';
  if (f.in === 'query') { if (!item.omit) query = `?${encodeURIComponent(f.name)}=${encodeURIComponent(item.value)}`; } else setPath(body, item.field, item.value, item.omit);
  const listOp = readBack && tech.operations(docs).find((x) => x.method === 'GET' && x.path === o.path);
  const count = async () => { if (!listOp) return null; const r = await track('GET', ctl.path); return Array.isArray(r.json) ? r.json.length : Array.isArray(r.json && r.json.items) ? r.json.items.length : null; };
  const before = item.expect === 'reject' ? await count() : null;
  const res = await track(o.method, ctl.path + query, ['GET', 'DELETE'].includes(o.method) ? undefined : body);
  const out = { status: res.status, sent: item.omit ? `${item.field} omitted` : { [item.field]: item.value }, calls };
  if (res.status >= 500 || res.status === 0) return { ...out, verdict: 'fail', why: `server error ${res.status} for ${item.omit ? 'a missing' : 'the'} value — invalid input must get a 4xx` };
  if (item.expect === 'reject') {
    if (res.status >= 200 && res.status < 300) return { ...out, verdict: 'fail', why: `accepted a value the specification forbids (${item.oracle})` };
    const after = before == null ? null : await count();
    if (before != null && after != null && after > before) return { ...out, verdict: 'fail', why: `answered ${res.status} but stored a record anyway (${before} → ${after})` };
    return { ...out, verdict: 'pass' };
  }
  if (!(res.status >= 200 && res.status < 300)) return { ...out, verdict: 'fail', why: `rejected (${res.status}) a value the specification allows (${item.oracle})` };
  if (readBack && res.json && res.json.id != null) {
    const one = tech.operations(docs).find((x) => x.method === 'GET' && x.path.replace(/\{[^}]+\}$/, '') === o.path.replace(/\/+$/, '') + '/');
    if (one) {
      const g = await track('GET', ctl.path.replace(/\/+$/, '') + '/' + encodeURIComponent(res.json.id));
      const stored = getPath(g.json, item.field);
      if (!same(stored, item.value)) return { ...out, verdict: 'fail', why: `accepted ${JSON.stringify(item.value)} but stored ${JSON.stringify(stored)}`, observed: stored };
    }
  }
  return { ...out, verdict: 'pass' };
}

/**
 * Wykonuje elementy pokrycia po kolei (bez równoległości: odczyty licznika muszą być spójne).
 * @param {object} o { baseUrl, docs, items, headers, bind: { DT, ST, PW: async (item, {call}) => {verdict, why} }, readBack=true, fetchImpl }
 */
async function runItems({ baseUrl, docs, items, headers, bind = {}, readBack = true, fetchImpl, timeoutMs, onCall, readOnly, baseBody, pathParams } = {}) {
  const call = client({ baseUrl, headers, fetchImpl, timeoutMs, onCall, readOnly });
  const ctx = { docs, call, readBack, baseBody, pathParams, controls: new Map() };
  const results = [];
  for (const it of items || []) {
    let r;
    try {
      if (it.expect === 'unknown') r = { verdict: 'skip', why: 'no expected result in the source (To confirm)' };
      else if (it.technique === 'EP' || it.technique === 'BVA') r = await runField(it, ctx);
      else if (bind[it.technique]) r = await bind[it.technique](it, { call, readBack });
      else r = { verdict: 'skip', why: `no binding for ${it.technique}` };
    } catch (e) { r = { verdict: 'fail', why: 'executor error: ' + String(e && e.message || e) }; }
    results.push({ id: it.id, technique: it.technique, required: it.required, ...r });
  }
  const sum = (v) => results.filter((x) => x.verdict === v).length;
  return { results, summary: { total: results.length, pass: sum('pass'), fail: sum('fail'), blocked: sum('blocked'), skip: sum('skip') } };
}

module.exports = { runItems, validBody, client, setPath, getPath, deepMerge };
