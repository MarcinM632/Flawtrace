// lib/transport-scan.js: the app's deterministic transport/HTTP scan of the API target (security headers,
// cookie flags, TLS, CORS, version disclosure). Drives it against a real local http server with tunable responses.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const scan = require('../lib/transport-scan');

let server, base, respond;
before(async () => {
  server = http.createServer((req, res) => respond(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());

const run = (set) => { respond = set; return scan.scan({ baseUrl: base }); };
const has = (res, rule) => res.findings.some((f) => f.rule === rule);

test('insecure defaults: cleartext, missing headers, weak cookie, version disclosure', async () => {
  const res = await run((req, res) => {
    res.setHeader('Server', 'nginx/1.18.0');
    res.setHeader('X-Powered-By', 'Express');
    res.setHeader('Set-Cookie', 'sid=abc');
    res.end('{}');
  });
  assert.equal(res.available, true);
  assert.ok(has(res, 'cleartext-http'), 'cleartext');
  assert.ok(has(res, 'no-x-content-type-options'), 'nosniff');
  assert.ok(has(res, 'no-csp'), 'csp');
  assert.ok(has(res, 'server-version-disclosure'), 'server version');
  assert.ok(has(res, 'x-powered-by-disclosure'), 'x-powered-by');
  assert.ok(has(res, 'cookie-no-httponly'), 'httponly');
  assert.ok(has(res, 'cookie-no-samesite'), 'samesite');
  // Over plain HTTP the Secure-flag rule does not fire (it is about HTTPS leakage).
  assert.ok(!has(res, 'cookie-no-secure'), 'no secure-flag finding over http');
});

test('hardened server: no findings', async () => {
  const res = await run((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Set-Cookie', 'sid=abc; HttpOnly; SameSite=Strict; Path=/');
    res.end('{}');
  });
  // Over http, cleartext-http is inherent; everything else should be clean.
  const nonTls = res.findings.filter((f) => f.rule !== 'cleartext-http');
  assert.deepEqual(nonTls, [], 'unexpected findings: ' + JSON.stringify(nonTls));
});

test('CORS: reflects arbitrary Origin with credentials -> high', async () => {
  const res = await run((req, res) => {
    const origin = req.headers.origin;
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Access-Control-Allow-Credentials', 'true'); }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.end('{}');
  });
  assert.ok(has(res, 'cors-reflect-credentials'), 'cors reflect+creds: ' + JSON.stringify(res.findings.map((f) => f.rule)));
  assert.equal(res.findings.find((f) => f.rule === 'cors-reflect-credentials').severity, 'high');
});

test('unreachable / no target -> available:false, no crash, no issues', async () => {
  const dead = await scan.scan({ baseUrl: 'http://127.0.0.1:1' });
  assert.equal(dead.available, false);
  assert.equal(scan.transportIssues(dead, '').length, 0);
  const none = await scan.scan({ baseUrl: '' });
  assert.equal(none.available, false);
});

test('correction issues only for unmentioned critical/high', async () => {
  const res = await run((req, res) => res.end('{}')); // cleartext-http (high) + low header findings
  assert.ok(scan.transportIssues(res, 'clean report').length === 1, 'cleartext not mentioned -> issue');
  assert.equal(scan.transportIssues(res, 'the API is cleartext-http which is a problem').length, 0, 'mentioned -> no issue');
});

test('injected fetch is used (no real network needed)', async () => {
  const fakeHeaders = new Headers({ 'set-cookie': 'a=1' });
  const res = await scan.scan({ baseUrl: 'https://example.test' }, { doFetch: async () => ({ status: 200, headers: fakeHeaders }) });
  assert.equal(res.available, true);
  assert.equal(res.https, true);
  assert.ok(has(res, 'cookie-no-secure'), 'secure flag missing over https');
  assert.ok(has(res, 'no-hsts'), 'hsts missing over https');
});
