// Deterministyczny skan warstwy TRANSPORTU/HTTP celu API — klasy, na które pentest przez serwer MCP `qa` jest
// ślepy, bo MCP widzi tylko treść odpowiedzi endpointu, nie nagłówki, cookies, TLS ani zachowanie CORS. Liczy to
// APLIKACJA, nie agent: kilka bezpiecznych żądań GET do bazowego adresu celu (read-only, mało ruchu — zgodnie z
// zasadą ostrożnego testu) i deterministyczna inspekcja odpowiedzi. Wynik to fakty z nagłówków, nie twierdzenie
// modelu. To odpowiednik lib/pentest-coverage.js (warstwa API) i lib/repo-scan.js (warstwa kodu) dla transportu.
//
// Zakres i granice (świadomie): to NIE jest aktywny DAST (brak fuzzingu, brak XSS/CSRF na żywo, brak łamania auth).
// To pasywna inspekcja transportu: nagłówki bezpieczeństwa, flagi cookies, cleartext vs TLS, odbicie CORS,
// ujawnienie wersji serwera. Aktywne XSS/CSRF/clickjacking sprawdza zakładka UI Tests (Playwright); pełny DAST
// (nuclei/ZAP) to osobny, izolowany runner z jawną autoryzacją celu. Na zahartowanym hostingu żądania przechodzą
// przez strażnika SSRF (net-guard), więc cel w sieci prywatnej jest odrzucany — wtedy available=false z powodem.
const PROBE_ORIGIN = 'https://flawtrace-cors-probe.example';
const TIMEOUT_MS = 15000;

// --- Reguły nagłówków: obecność/wartość nagłówka odpowiedzi -> znalezisko, gdy brak albo słaba wartość. ---
const headerFinding = (h, url, isHttps) => {
  const out = [];
  const get = (n) => h.get(n);
  const server = get('server'), xpb = get('x-powered-by');
  // Cleartext / TLS.
  if (!isHttps) out.push({ rule: 'cleartext-http', severity: 'high', cwe: 'CWE-319', title: 'API served over cleartext HTTP (no TLS): traffic and tokens can be read or modified in transit' });
  else if (!get('strict-transport-security')) out.push({ rule: 'no-hsts', severity: 'medium', cwe: 'CWE-319', title: 'No Strict-Transport-Security header: a client can be downgraded to HTTP' });
  else if (/max-age\s*=\s*0/i.test(get('strict-transport-security'))) out.push({ rule: 'hsts-zero', severity: 'medium', cwe: 'CWE-319', title: 'Strict-Transport-Security has max-age=0 (HSTS effectively disabled)' });
  // Nagłówki ochronne.
  if (!get('x-content-type-options')) out.push({ rule: 'no-x-content-type-options', severity: 'low', cwe: 'CWE-693', title: 'No X-Content-Type-Options: nosniff header (MIME sniffing)' });
  if (!get('content-security-policy')) out.push({ rule: 'no-csp', severity: 'low', cwe: 'CWE-693', title: 'No Content-Security-Policy header' });
  if (!get('x-frame-options') && !/frame-ancestors/i.test(get('content-security-policy') || '')) out.push({ rule: 'no-frame-protection', severity: 'low', cwe: 'CWE-1021', title: 'No X-Frame-Options and no CSP frame-ancestors (clickjacking if any HTML is served)' });
  if (!get('referrer-policy')) out.push({ rule: 'no-referrer-policy', severity: 'low', cwe: 'CWE-200', title: 'No Referrer-Policy header' });
  // Ujawnienie wersji (fingerprint stacku -> dopasowanie CVE).
  if (server && /\d/.test(server)) out.push({ rule: 'server-version-disclosure', severity: 'low', cwe: 'CWE-200', title: `Server header reveals software/version: "${server.slice(0, 80)}"`, detail: server.slice(0, 120) });
  if (xpb) out.push({ rule: 'x-powered-by-disclosure', severity: 'low', cwe: 'CWE-200', title: `X-Powered-By reveals the stack: "${xpb.slice(0, 80)}"`, detail: xpb.slice(0, 120) });
  return out;
};

// --- Cookies: każdy Set-Cookie sprawdzamy na Secure/HttpOnly/SameSite. ---
function cookieFindings(setCookie, isHttps) {
  const out = [];
  const cookies = Array.isArray(setCookie) ? setCookie : (setCookie ? [setCookie] : []);
  for (const c of cookies) {
    const name = String(c).split('=')[0].trim().slice(0, 40);
    const low = String(c).toLowerCase();
    if (isHttps && !/;\s*secure/.test(low)) out.push({ rule: 'cookie-no-secure', severity: 'high', cwe: 'CWE-614', title: `Cookie "${name}" set without the Secure flag over HTTPS (can leak over HTTP)` });
    if (!/;\s*httponly/.test(low)) out.push({ rule: 'cookie-no-httponly', severity: 'medium', cwe: 'CWE-1004', title: `Cookie "${name}" set without HttpOnly (readable by JavaScript / XSS)` });
    if (!/;\s*samesite/.test(low)) out.push({ rule: 'cookie-no-samesite', severity: 'low', cwe: 'CWE-352', title: `Cookie "${name}" set without SameSite (CSRF exposure)` });
  }
  return out;
}

// --- CORS: odbija przysłany Origin? Z Allow-Credentials:true to realna luka. ---
function corsFindings(h) {
  const allow = h.get('access-control-allow-origin');
  const creds = /true/i.test(h.get('access-control-allow-credentials') || '');
  if (!allow) return [];
  if (allow === PROBE_ORIGIN) return [{ rule: creds ? 'cors-reflect-credentials' : 'cors-reflect-origin', severity: creds ? 'high' : 'medium', cwe: 'CWE-942', title: creds ? 'CORS reflects an arbitrary Origin AND allows credentials: any site can read authenticated responses' : 'CORS reflects an arbitrary Origin: cross-origin reads from any site' }];
  if (allow === '*' && creds) return [{ rule: 'cors-wildcard-credentials', severity: 'high', cwe: 'CWE-942', title: 'CORS Allow-Origin "*" with Allow-Credentials:true (browsers block this, but it signals a broken policy)' }];
  if (allow === '*') return [{ rule: 'cors-wildcard', severity: 'low', cwe: 'CWE-942', title: 'CORS Allow-Origin is "*" (any site can read non-credentialed responses)' }];
  return [];
}

// Set-Cookie z Headers: fetch skleja je w jeden string, więc używamy getSetCookie() gdy jest.
const getSetCookie = (h) => { try { if (typeof h.getSetCookie === 'function') return h.getSetCookie(); } catch (_) { /* brak */ } const v = h.get('set-cookie'); return v ? [v] : []; };

/**
 * @param target { baseUrl, authHeader, authValue }
 * @param opts   { hosted, doFetch } — doFetch wstrzykiwalny dla testów; domyślnie global fetch za strażnikiem.
 */
async function scan(target, opts = {}) {
  const baseUrl = target && String(target.baseUrl || '').trim().replace(/\/+$/, '');
  if (!baseUrl) return { available: false, reason: 'no test API connected', findings: [], counts: emptyCounts() };
  let url;
  try { url = new URL(baseUrl); } catch (_) { return { available: false, reason: 'the API base URL is not valid', findings: [], counts: emptyCounts() }; }
  const isHttps = url.protocol === 'https:';
  if (opts.hosted) {
    try { await require('./net-guard').assertPublicUrl(baseUrl, { schemes: ['http:', 'https:'] }); }
    catch (e) { return { available: false, reason: 'blocked by the outbound guard: ' + (e && e.message || e), findings: [], counts: emptyCounts() }; }
  }
  const doFetch = opts.doFetch || ((u, init) => fetch(u, init));
  const authHeaders = target.authValue ? { [target.authHeader || 'Authorization']: target.authValue } : {};
  const timeout = () => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(TIMEOUT_MS) : undefined);
  let main;
  try { main = await doFetch(baseUrl, { method: 'GET', redirect: 'manual', headers: { ...authHeaders }, signal: timeout() }); }
  catch (e) { return { available: false, reason: 'the target is unreachable: ' + (e && e.message || e), findings: [], counts: emptyCounts() }; }
  const findings = [];
  const push = (arr) => { for (const f of arr) findings.push({ scanner: 'transport', url: baseUrl, status: main.status, ...f }); };
  push(headerFinding(main.headers, baseUrl, isHttps));
  push(cookieFindings(getSetCookie(main.headers), isHttps));
  // Druga, pojedyncza sonda: odbicie CORS dla przysłanego Origin. Best-effort — błąd nie przerywa skanu.
  try {
    const cors = await doFetch(baseUrl, { method: 'GET', redirect: 'manual', headers: { ...authHeaders, Origin: PROBE_ORIGIN }, signal: timeout() });
    push(corsFindings(cors.headers));
  } catch (_) { /* sonda CORS nieobowiązkowa */ }
  dedupeSort(findings);
  return { available: true, baseUrl, status: main.status, https: isHttps, findings, counts: countBy(findings) };
}

const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
function dedupeSort(findings) {
  const seen = new Set();
  for (let i = findings.length - 1; i >= 0; i--) { if (seen.has(findings[i].rule)) findings.splice(i, 1); else seen.add(findings[i].rule); }
  findings.sort((a, b) => (SEV_ORDER[a.severity] - SEV_ORDER[b.severity]) || (a.rule < b.rule ? -1 : 1));
}
function emptyCounts() { return { total: 0, critical: 0, high: 0, medium: 0, low: 0 }; }
function countBy(findings) { const c = emptyCounts(); for (const f of findings) { c.total++; c[f.severity] = (c[f.severity] || 0) + 1; } return c; }

/** Zarzuty do tury korekty: critical/high znaleziska transportu, których raport nie wspomina. */
function transportIssues(result, report) {
  if (!result || !result.available) return [];
  const serious = result.findings.filter((f) => f.severity === 'critical' || f.severity === 'high');
  const rep = String(report || '').toLowerCase();
  const unmentioned = serious.filter((f) => !rep.includes(f.rule) && !(f.cwe && rep.includes(f.cwe.toLowerCase())));
  if (!unmentioned.length) return [];
  const top = unmentioned.slice(0, 10).map((f) => `${f.severity.toUpperCase()} ${f.rule} (${f.cwe})`);
  return [{ code: 'pentest-transport', text: `Transport/HTTP scan found ${unmentioned.length} critical/high finding(s) not covered by the report: ${top.join('; ')}.` }];
}
function summary(result) {
  if (!result || !result.available) return result && result.reason ? `Transport scan: not run (${result.reason}).` : '';
  const c = result.counts;
  return c.total ? `Transport/HTTP scan (app): ${c.total} finding(s) — ${c.critical} critical, ${c.high} high, ${c.medium} medium, ${c.low} low.` : 'Transport/HTTP scan (app): no header/cookie/TLS/CORS issues.';
}

module.exports = { scan, transportIssues, summary, _headerFinding: headerFinding, _cookieFindings: cookieFindings, _corsFindings: corsFindings };
