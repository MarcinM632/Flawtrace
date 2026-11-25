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

function client({ baseUrl, headers = {}, fetchImpl = fetch, timeoutMs = 10000 }) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  return async function call(method, p, body) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(base + p, { method, headers: { 'content-type': 'application/json', accept: 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal });
      const text = await res.text();
      let json = null; try { json = text ? JSON.parse(text) : null; } catch (_) { /* nie JSON */ }
      return { status: res.status, json, text: text.slice(0, 500) };
    } catch (e) { return { status: 0, json: null, text: String(e && e.message || e) }; } finally { clearTimeout(timer); }
  };
}

/** Jeden element EP/BVA. */
async function runField(item, { docs, call, readBack }) {
  const o = tech.findOperation(docs, item.endpoint);
  if (!o) return { verdict: 'skip', why: `${item.endpoint} not in the specification` };
  if (/\{/.test(o.path)) return { verdict: 'skip', why: 'path parameters need a binding' };
  const fields = tech.endpointFields(o);
  const f = fields.find((x) => x.name === item.field);
  if (!f) return { verdict: 'skip', why: `field ${item.field} not found` };
  const body = validBody(fields);
  let query = '';
  if (f.in === 'query') { if (!item.omit) query = `?${encodeURIComponent(f.name)}=${encodeURIComponent(item.value)}`; } else setPath(body, item.field, item.value, item.omit);
  const listOp = readBack && tech.operations(docs).find((x) => x.method === 'GET' && x.path === o.path);
  const count = async () => { if (!listOp) return null; const r = await call('GET', o.path); return Array.isArray(r.json) ? r.json.length : Array.isArray(r.json && r.json.items) ? r.json.items.length : null; };
  const before = item.expect === 'reject' ? await count() : null;
  const res = await call(o.method, o.path + query, ['GET', 'DELETE'].includes(o.method) ? undefined : body);
  const out = { status: res.status, sent: item.omit ? `${item.field} omitted` : { [item.field]: item.value } };
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
      const g = await call('GET', one.path.replace(/\{[^}]+\}$/, encodeURIComponent(res.json.id)));
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
async function runItems({ baseUrl, docs, items, headers, bind = {}, readBack = true, fetchImpl, timeoutMs } = {}) {
  const call = client({ baseUrl, headers, fetchImpl, timeoutMs });
  const results = [];
  for (const it of items || []) {
    let r;
    try {
      if (it.expect === 'unknown') r = { verdict: 'skip', why: 'no expected result in the source (To confirm)' };
      else if (it.technique === 'EP' || it.technique === 'BVA') r = await runField(it, { docs, call, readBack });
      else if (bind[it.technique]) r = await bind[it.technique](it, { call, readBack });
      else r = { verdict: 'skip', why: `no binding for ${it.technique}` };
    } catch (e) { r = { verdict: 'fail', why: 'executor error: ' + String(e && e.message || e) }; }
    results.push({ id: it.id, technique: it.technique, required: it.required, ...r });
  }
  const sum = (v) => results.filter((x) => x.verdict === v).length;
  return { results, summary: { total: results.length, pass: sum('pass'), fail: sum('fail'), blocked: sum('blocked'), skip: sum('skip') } };
}

module.exports = { runItems, validBody, client, setPath, getPath };
