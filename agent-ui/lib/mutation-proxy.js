#!/usr/bin/env node
// Mutation testing autotestów przez mutację odpowiedzi API (bez przebudowy aplikacji, dla każdego stosu).
//
// Proxy stoi między suitą a aplikacją (suita dostaje BASE_URL = adres proxy). Najpierw przebieg bazowy: suita musi
// przejść, a proxy zapisuje, jakie odpowiedzi widziała. Z nich powstają mutanty — każdy zmienia JEDNĄ rzecz w
// odpowiedziach jednego endpointu: liczbę o 1, tekst, wartość logiczną, usuwa pole, skraca listę albo zamienia
// odpowiedź błędu na sukces. Dla każdego mutanta suita biegnie od nowa:
//   killed      — suita padła: jakiś test sprawdza tę rzecz,
//   survived    — suita przeszła mimo zmiany: ŻADEN test tego nie sprawdza (konkretna luka w asercjach),
//   not-reached — w tym przebiegu nikt nie wywołał endpointu (nie liczy się do wyniku).
// Suita musi przejść dwa razy z rzędu bez mutanta (powtarzalność): inaczej porażki wynikają ze stanu danych, nie z
// mutacji, i wynik byłby zawyżony.
// Wynik mutacyjny = killed / (killed + survived). Pola identyfikatorów, dat i linków nie są mutowane: ich zmiana
// psuje następne wywołania i "zabijałaby" mutanta sztucznie, zawyżając wynik.
//
// CLI: node lib/mutation-proxy.js --target https://test.example.com --cmd "npx playwright test" [--env BASE_URL]
//      [--max 40] [--only "GET /orders"] [--timeout 600] [--json]
// Bez zależności — plik można skopiować do repozytorium testów i uruchomić w CI.
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

const SKIP_FIELD = /(^|_|\.)(id|uuid|guid|token|etag|href|url|uri|link|links|self|cursor|next|prev|created\w*|updated\w*|modified\w*|timestamp|date|time|expires\w*)$|Id$|At$/i;
const MAX_DEPTH = 3;

/** /orders/42/items/3fa8... → /orders/{id}/items/{id} */
const template = (p) => String(p).split('?')[0].split('/').map((s) => (/^\d+$/.test(s) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(s) || /^[0-9a-f]{24}$/i.test(s) ? '{id}' : s)).join('/');

/* ------------------------------------------------ mutanty ------------------------------------------------ */
function paths(v, prefix = '', depth = 0, out = []) {
  if (depth > MAX_DEPTH || v == null || typeof v !== 'object') return out;
  if (Array.isArray(v)) {
    out.push({ path: prefix, kind: 'array', value: v });
    if (v.length && typeof v[0] === 'object') paths(v[0], `${prefix}[0]`, depth + 1, out);
    return out;
  }
  for (const [k, x] of Object.entries(v)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (SKIP_FIELD.test(k)) continue;
    if (x !== null && typeof x === 'object') { paths(x, p, depth + 1, out); continue; }
    out.push({ path: p, kind: typeof x, value: x });
  }
  return out;
}
/** Mutanty z zapisanych odpowiedzi: { id, endpoint, op, path, describe } — kolejność stała. */
function generate(recorded, { max = 40, only = '' } = {}) {
  const out = [];
  const keys = Object.keys(recorded).filter((k) => !only || k.startsWith(only)).sort();
  for (const key of keys) {
    const r = recorded[key];
    // Najpierw "błąd → sukces": sprawdza, czy testy negatywne w ogóle coś weryfikują; nie może wypaść przez limit.
    if (r.error) out.push({ endpoint: key, op: 'error-to-success', path: '', describe: `${r.error.status} error → 200 OK (the API "accepts" what it refused)` });
    if (r.ok) {
      for (const f of paths(r.ok.body)) {
        const at = f.path || '(body)';
        if (f.kind === 'number') out.push({ endpoint: key, op: 'num+1', path: f.path, describe: `${at}: ${f.value} → ${f.value + 1}` });
        else if (f.kind === 'string') out.push({ endpoint: key, op: 'str', path: f.path, describe: `${at}: "${String(f.value).slice(0, 30)}" → changed text` });
        else if (f.kind === 'boolean') out.push({ endpoint: key, op: 'bool', path: f.path, describe: `${at}: ${f.value} → ${!f.value}` });
        else if (f.kind === 'array' && f.value.length) out.push({ endpoint: key, op: 'drop-last', path: f.path, describe: `${at}: list of ${f.value.length} → ${f.value.length - 1} (last element dropped)` });
        if (f.path && f.kind !== 'array') out.push({ endpoint: key, op: 'remove', path: f.path, describe: `${at}: field removed` });
      }
    }
  }
  // Równomiernie po endpointach, gdy mutantów jest więcej niż limit (żeby nie zjeść limitu na jednym endpoincie).
  const byEp = new Map();
  for (const m of out) { if (!byEp.has(m.endpoint)) byEp.set(m.endpoint, []); byEp.get(m.endpoint).push(m); }
  const pick = [];
  for (let i = 0; pick.length < Math.min(max, out.length); i++) for (const list of byEp.values()) if (list[i] && pick.length < max) pick.push(list[i]);
  return pick.map((m, i) => ({ id: `M${i + 1}`, ...m }));
}
function getAt(o, p) { return p.split(/\.|\[(\d+)\]/).filter(Boolean).reduce((a, k) => (a == null ? undefined : a[k]), o); }
function parentOf(o, p) {
  const parts = p.split(/\.|\[(\d+)\]/).filter(Boolean);
  const last = parts.pop();
  return { parent: parts.reduce((a, k) => (a == null ? undefined : a[k]), o), key: last };
}
/** Zastosuj mutanta do ciała JSON (kopia). Zwraca { body, status } albo null, gdy nie ma czego zmienić. */
function apply(m, status, body) {
  if (m.op === 'error-to-success') return status >= 400 && status < 500 ? { status: 200, body } : null;
  if (status < 200 || status >= 300 || body == null || typeof body !== 'object') return null;
  const b = JSON.parse(JSON.stringify(body));
  const targets = Array.isArray(b) && /^\[0\]/.test(m.path) ? b.map((_, i) => m.path.replace(/^\[0\]/, `[${i}]`)) : [m.path];
  let changed = false;
  for (const p of targets) {
    if (m.op === 'drop-last') { const arr = p ? getAt(b, p) : b; if (Array.isArray(arr) && arr.length) { arr.pop(); changed = true; } continue; }
    const { parent, key } = parentOf(b, p);
    if (!parent || !(key in parent)) continue;
    const v = parent[key];
    if (m.op === 'remove') { delete parent[key]; changed = true; }
    else if (m.op === 'num+1' && typeof v === 'number') { parent[key] = v + 1; changed = true; }
    else if (m.op === 'str' && typeof v === 'string') { parent[key] = v ? v + '~mut' : 'mut'; changed = true; }
    else if (m.op === 'bool' && typeof v === 'boolean') { parent[key] = !v; changed = true; }
  }
  return changed ? { status, body: b } : null;
}

/* ------------------------------------------------ proxy ------------------------------------------------ */
function startProxy(target) {
  const t = new URL(target);
  const lib = t.protocol === 'https:' ? https : http;
  const state = { mode: 'record', mutant: null, applied: 0, recorded: {} };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const headers = { ...req.headers, host: t.host, 'accept-encoding': 'identity' };
      const basePath = t.pathname.replace(/\/+$/, '');
      const up = lib.request({ protocol: t.protocol, hostname: t.hostname, port: t.port || (t.protocol === 'https:' ? 443 : 80), method: req.method, path: basePath + req.url, headers }, (ur) => {
        const out = [];
        ur.on('data', (c) => out.push(c));
        ur.on('end', () => {
          let buf = Buffer.concat(out);
          let status = ur.statusCode;
          const h = { ...ur.headers };
          const key = `${req.method} ${template(req.url)}`;
          const isJson = /json/i.test(h['content-type'] || '');
          let body = null;
          if (isJson) { try { body = JSON.parse(buf.toString('utf8') || 'null'); } catch (_) { body = null; } }
          if (state.mode === 'record' && isJson) {
            const r = state.recorded[key] || (state.recorded[key] = { calls: 0 });
            r.calls++;
            if (status >= 200 && status < 300 && !r.ok && body != null) r.ok = { status, body };
            if (status >= 400 && status < 500 && !r.error) r.error = { status };
          } else if (state.mode === 'mutate' && state.mutant && state.mutant.endpoint === key) {
            const m = apply(state.mutant, status, body);
            if (m) {
              state.applied++;
              status = m.status;
              buf = Buffer.from(JSON.stringify(m.body));
              h['content-type'] = 'application/json';
            }
          }
          delete h['content-length']; delete h['transfer-encoding']; delete h['content-encoding'];
          h['content-length'] = buf.length;
          res.writeHead(status, h);
          res.end(buf);
        });
      });
      up.on('error', (e) => { res.writeHead(502, { 'content-type': 'text/plain' }); res.end('mutation proxy: ' + e.message); });
      up.end(Buffer.concat(chunks));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, state, close: () => new Promise((r) => server.close(r)) })));
}

function runCommand(cmd, { cwd, env, timeoutMs }) {
  return new Promise((resolve) => {
    const p = spawn(cmd, { cwd, env, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out = (out + d).slice(-4000); });
    p.stderr.on('data', (d) => { out = (out + d).slice(-4000); });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; p.kill('SIGKILL'); }, timeoutMs);
    p.on('close', (code) => { clearTimeout(timer); resolve({ code: timedOut ? -1 : code, timedOut, tail: out }); });
  });
}

/**
 * @param {object} o { target, cmd, cwd, envVar='BASE_URL', max=40, only='', timeoutMs=600000, log }
 * @returns {{ baseline, score, killed, survived, notReached, mutants, survivors }}
 */
async function run({ target, cmd, cwd = process.cwd(), envVar = 'BASE_URL', env = process.env, max = 40, only = '', timeoutMs = 600000, log = () => {} } = {}) {
  const proxy = await startProxy(target);
  try {
    const envFor = { ...env, [envVar]: proxy.url };
    const base = await runCommand(cmd, { cwd, env: envFor, timeoutMs });
    if (base.code !== 0) return { baseline: { ok: false, code: base.code, tail: base.tail }, error: 'The suite fails without any mutant — fix it first; a mutation score of a red suite means nothing.' };
    // Drugi przebieg bazowy, już bez zapisu: suita, która pada przy powtórce na tych samych danych (zależy od stanu
    // zostawionego przez poprzedni przebieg, np. od liczby rekordów), "zabijałaby" każdego mutanta sama — wynik
    // byłby zawyżony. Taka suita nie dostaje wyniku.
    proxy.state.mode = 'pass';
    const again = await runCommand(cmd, { cwd, env: envFor, timeoutMs });
    if (again.code !== 0) return { baseline: { ok: false, repeatable: false, code: again.code, tail: again.tail }, error: 'The suite passes once but fails when run again on the same data — it depends on state left by an earlier run. Make the tests independent (create their own data, assert on it, not on totals), then measure.' };
    const endpoints = Object.keys(proxy.state.recorded).length;
    const mutants = generate(proxy.state.recorded, { max, only });
    log(`baseline passed, ${endpoints} endpoint(s) seen, ${mutants.length} mutant(s)`);
    proxy.state.mode = 'mutate';
    for (const m of mutants) {
      proxy.state.mutant = m;
      proxy.state.applied = 0;
      const r = await runCommand(cmd, { cwd, env: envFor, timeoutMs });
      m.result = !proxy.state.applied ? 'not-reached' : r.code !== 0 ? 'killed' : 'survived';
      if (r.timedOut) m.timeout = true;
      log(`${m.id} ${m.result.padEnd(11)} ${m.endpoint} ${m.describe}`);
    }
    const n = (k) => mutants.filter((m) => m.result === k).length;
    const killed = n('killed'), survived = n('survived');
    const survivors = {};
    for (const m of mutants.filter((x) => x.result === 'survived')) (survivors[m.endpoint] = survivors[m.endpoint] || []).push(m.describe);
    return { baseline: { ok: true, endpoints }, score: killed + survived ? Math.round((killed / (killed + survived)) * 1000) / 10 : null, killed, survived, notReached: n('not-reached'), mutants, survivors };
  } finally { await proxy.close(); }
}

module.exports = { run, generate, apply, startProxy, template, paths };

if (require.main === module) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const target = arg('--target'), cmd = arg('--cmd');
  if (!target || !cmd) { console.error('usage: node mutation-proxy.js --target <app url> --cmd "<test command>" [--env BASE_URL] [--max 40] [--only "GET /orders"] [--timeout 600] [--json]'); process.exit(2); }
  const json = process.argv.includes('--json');
  run({ target, cmd, envVar: arg('--env', 'BASE_URL'), max: Number(arg('--max', 40)), only: arg('--only', ''), timeoutMs: Number(arg('--timeout', 600)) * 1000, log: json ? () => {} : console.log }).then((r) => {
    if (json) { console.log(JSON.stringify(r, null, 2)); process.exit(r.error ? 1 : 0); }
    if (r.error) { console.error(r.error + '\n' + (r.baseline.tail || '')); process.exit(1); }
    console.log(`\nmutation score: ${r.score}% (${r.killed} killed, ${r.survived} survived, ${r.notReached} not reached)`);
    for (const [ep, list] of Object.entries(r.survivors)) console.log(`\nNo test fails when, in ${ep}:\n` + list.map((d) => '  - ' + d).join('\n'));
  }).catch((e) => { console.error(e); process.exit(2); });
}
