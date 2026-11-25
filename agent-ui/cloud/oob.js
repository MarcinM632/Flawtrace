// Serwer zwrotny (out-of-band) dla silnika pentestowego: cel testu dostaje adres z jednorazowym tokenem, np. jako
// wartość parametru `url`. Jeśli serwer celu sam go odwiedzi, mamy dowód SSRF albo ślepego wstrzyknięcia, którego
// nie widać w odpowiedzi. Token wydaje workspace przez wewnętrzny adres gatewaya, a odwiedziny przychodzą na
// publiczny /_gw/oob/<token> (dowolny host gatewaya). Zapisujemy tylko: czas, IP, metodę, ścieżkę, User-Agent.
const crypto = require('crypto');

const TTL_MS = 2 * 60 * 60 * 1000;
const PER_ORG = 500;
const tokens = new Map(); // token -> { orgId, created, hits: [] }

function sweep(now = Date.now()) { for (const [t, x] of tokens) if (x.created + TTL_MS < now) tokens.delete(t); }

function issue(orgId, count = 1) {
  sweep();
  let own = 0; for (const x of tokens.values()) if (x.orgId === orgId) own++;
  const n = Math.max(1, Math.min(50, Number(count) || 1));
  if (own + n > PER_ORG) throw Object.assign(new Error('too many callback tokens; wait for old ones to expire'), { status: 429 });
  return Array.from({ length: n }, () => { const t = crypto.randomBytes(12).toString('hex'); tokens.set(t, { orgId, created: Date.now(), hits: [] }); return t; });
}

/** Odwiedziny celu. Zwraca true, gdy token jest znany (odpowiedź i tak zawsze ta sama, żeby nie zdradzać tokenów). */
function hit(token, { ip, method, path, ua }) {
  const x = tokens.get(String(token || '').slice(0, 64));
  if (!x || x.hits.length >= 20) return false;
  x.hits.push({ at: Date.now(), ip: String(ip || '').slice(0, 64), method: String(method || '').slice(0, 10), path: String(path || '').slice(0, 300), ua: String(ua || '').slice(0, 200) });
  return true;
}

function hits(orgId, list) {
  const out = {};
  for (const t of [].concat(list || []).slice(0, 200)) { const x = tokens.get(String(t)); if (x && x.orgId === orgId) out[t] = x.hits; }
  return out;
}

const reset = () => tokens.clear();
module.exports = { hit, hits, issue, reset, TTL_MS };
