// Flawtrace Cloud gateway, end to end: a real gateway process, real per-customer processes behind it, a fake Stripe.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const billing = require('../cloud/billing');

const APP = path.resolve(__dirname, '..');
const WH_SECRET = 'whsec_test_secret';
let gw, port, data, stripe, stripeBase, stripeCalls = [], out = '';
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const SITE = () => `localhost:${port}`, APPH = () => `app.localhost:${port}`;

/** One request to the gateway with a chosen Host header. Returns { status, headers, text, json }. */
function req(host, method, p, { body, cookie, headers = {}, raw } = {}) {
  return new Promise((resolve, reject) => {
    const payload = raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined;
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: { host: host(), ...(payload !== undefined ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}), ...(cookie ? { cookie } : {}), ...headers } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const buf = Buffer.concat(chunks); const text = buf.toString('utf8'); let json = null; try { json = JSON.parse(text); } catch (_) { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, buf, text, json }); });
    });
    r.on('error', reject); if (payload !== undefined) r.write(payload); r.end();
  });
}
const cookieOf = (r) => { const c = [].concat(r.headers['set-cookie'] || [])[0]; return c ? c.split(';')[0] : ''; };
const mailLink = (to, kind) => { const blocks = out.split('[mail to ').filter((b) => b.startsWith(to + ']')); const last = blocks[blocks.length - 1] || ''; const m = new RegExp('(http://app\\.localhost:\\d+/_gw/' + kind + '[^\\s]*)').exec(last); return m ? m[1] : null; };
const signup = (email, extra = {}) => req(APPH, 'POST', '/_gw/api/signup', { body: { email, password: 'correct horse battery', name: 'Tester', terms: true, ...extra } });
async function signedIn(email) { const r = await signup(email); assert.equal(r.status, 201, `signup ${email} -> ${r.status} body=${JSON.stringify(r.text)} serverTail=${JSON.stringify(out.slice(-600))}`); const c = cookieOf(r); const v = mailLink(email, 'verify'); assert.ok(v, 'verification mail'); const path_ = v.replace(/^http:\/\/[^/]+/, ''); assert.equal((await req(APPH, 'GET', path_)).status, 302); return c; }

before(async () => {
  stripe = http.createServer((q, s) => { let b = ''; q.on('data', (c) => { b += c; }); q.on('end', () => { stripeCalls.push({ method: q.method, url: q.url, body: b, auth: q.headers.authorization }); s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify(q.url.includes('portal') ? { url: 'https://billing.stripe.test/portal' } : q.url.includes('checkout') ? { url: 'https://checkout.stripe.test/pay' } : { id: 'sub_1', status: 'canceled' })); }); });
  await new Promise((r) => stripe.listen(0, '127.0.0.1', r));
  stripeBase = 'http://127.0.0.1:' + stripe.address().port;
  port = await freePort();
  data = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-cloud-'));
  gw = spawn('node', ['cloud/server.js'], { cwd: APP, env: { ...process.env, CLOUD_PORT: String(port), CLOUD_DATA: data, SITE_HOST: SITE(), APP_HOST: APPH(), CLOUD_MASTER_SECRET: 'test-master-secret-0123456789abcdef', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRICE_ID: 'price_1', STRIPE_WEBHOOK_SECRET: WH_SECRET, STRIPE_API_BASE: stripeBase, COMPANY_NAME: 'Test Co', MAX_SEATS: '3', SIGNUPS_PER_HOUR_PER_IP: '1000', PRICE_LABEL: '29 EUR / month', TRIAL_DAYS: '14' }, stdio: ['ignore', 'pipe', 'pipe'] });
  gw.stderr.on('data', (c) => { out += c; });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('gateway did not start: ' + out)), 20000);
    gw.stdout.on('data', (c) => { out += c; if (String(c).includes('listening on')) { clearTimeout(t); resolve(); } });
    gw.on('exit', (code) => reject(new Error('gateway exited early: ' + code + out)));
  });
});
after(async () => { if (gw) { gw.kill(); await new Promise((r) => setTimeout(r, 800)); } if (stripe) stripe.close(); try { fs.rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch (_) { /* temp */ } });

test('public site: pages render with the company data filled in and the security headers set', async () => {
  for (const p of ['/', '/privacy', '/terms', '/dpa', '/security', '/subprocessors', '/cookies']) {
    const r = await req(SITE, 'GET', p);
    assert.equal(r.status, 200, p);
    assert.ok(!/\{\{[A-Z_]+\}\}/.test(r.text), p + ' has an unfilled placeholder: ' + (r.text.match(/\{\{[A-Z_]+\}\}/) || [])[0]);
    assert.match(r.headers['content-security-policy'], /default-src 'self'/);
    assert.equal(r.headers['x-frame-options'], 'DENY');
  }
  const home = await req(SITE, 'GET', '/');
  assert.match(home.text, /29 EUR \/ month/);
  assert.match(home.text, new RegExp(`http://${APPH().replace('.', '\\.')}/_gw/signup`));
  assert.ok(!/style="/.test(home.text), 'no inline styles under a strict CSP');
  assert.equal((await req(SITE, 'GET', '/nope')).status, 404);
  assert.match((await req(SITE, 'GET', '/.well-known/security.txt')).text, /Contact: mailto:/);
  assert.match((await req(SITE, 'GET', '/sitemap.xml')).text, /\/privacy/);
  assert.equal((await req(SITE, 'GET', '/assets/site.css')).status, 200);
  assert.equal((await req(SITE, 'GET', '/assets/../../server.js')).status, 404);
  assert.equal((await req(SITE, 'GET', '/healthz')).json.ok, true);
});

test('the app host asks for a sign-in and every app page and script exists', async () => {
  const r = await req(APPH, 'GET', '/', { headers: { accept: 'text/html' } });
  assert.equal(r.status, 302); assert.match(r.headers.location, /\/_gw\/login/);
  assert.equal((await req(APPH, 'GET', '/')).status, 401, 'a script (no text/html accept) gets 401, not a redirect');
  assert.equal((await req(APPH, 'GET', '/api/agents')).status, 401);
  for (const p of ['/_gw/login', '/_gw/signup', '/_gw/forgot', '/_gw/reset']) { const x = await req(APPH, 'GET', p); assert.equal(x.status, 200, p); assert.ok(!/\{\{/.test(x.text), p); assert.ok(!/ style="|<script>/.test(x.text), p + ' must have no inline style or script'); }
  for (const f of ['gw.css', 'gw.js', 'account.js', 'signup.js', 'verify.js', 'shell.js', 'logo.svg']) assert.equal((await req(APPH, 'GET', '/_gw/static/' + f)).status, 200, f);
  { const t = await req(APPH, 'GET', '/_gw/static/..%2f..%2fserver.js'); assert.ok(t.status === 404 || t.status === 401, 'status ' + t.status); assert.ok(!t.text.includes('require(')); }
  assert.equal((await req(APPH, 'GET', '/_gw/account')).status, 302, 'account needs a session');
  assert.equal((await req(APPH, 'GET', '/_gw/api/config')).json.billing, true);
});

test('sign-up checks: weak password, missing terms, bad e-mail, duplicate', async () => {
  assert.equal((await signup('weak@x.test', { password: 'short' })).status, 400);
  assert.equal((await signup('weak@x.test', { password: 'aaaaaaaaaaaa' })).status, 400);
  assert.equal((await signup('weak@x.test', { terms: false })).status, 400);
  assert.equal((await signup('not-an-email')).status, 400);
  const ok = await signup('dup@x.test'); assert.equal(ok.status, 201);
  assert.equal((await signup('dup@x.test')).status, 409);
});

test('sign-up, confirmation, the product behind the gateway, cross-site writes refused', async () => {
  const email = 'ann@x.test';
  const r = await signup(email); assert.equal(r.status, 201); assert.equal(r.json.next, '/_gw/verify-needed');
  const cookie = cookieOf(r);
  assert.match(r.headers['set-cookie'][0], /HttpOnly/); assert.match(r.headers['set-cookie'][0], /SameSite=Lax/);
  const me = await req(APPH, 'GET', '/_gw/api/me', { cookie }); assert.equal(me.json.needsVerification, true);
  const gate = await req(APPH, 'GET', '/', { cookie, headers: { accept: 'text/html' } });
  assert.equal(gate.status, 302); assert.match(gate.headers.location, /verify-needed/);
  assert.equal((await req(APPH, 'GET', '/api/agents', { cookie })).status, 403, 'the product is closed until the e-mail is confirmed');
  const link = mailLink(email, 'verify'); assert.ok(link);
  const v = await req(APPH, 'GET', link.replace(/^http:\/\/[^/]+/, '')); assert.equal(v.status, 302); assert.match(v.headers.location, /verified=1/);
  assert.equal((await req(APPH, 'GET', link.replace(/^http:\/\/[^/]+/, ''))).headers.location.includes('error'), true, 'a link works once');
  // Now the product: a real process of this workspace starts behind the gateway.
  const home = await req(APPH, 'GET', '/', { cookie, headers: { accept: 'text/html' } });
  assert.equal(home.status, 200, home.text.slice(0, 300));
  assert.match(home.text, /\/_gw\/static\/shell\.js/, 'the account chip is injected');
  const agents = await req(APPH, 'GET', '/api/agents', { cookie }); assert.equal(agents.status, 200); assert.ok(Array.isArray(agents.json));
  assert.ok(!('set-cookie' in agents.headers), 'the product never sets cookies');
  const evil = await req(APPH, 'POST', '/api/sources', { cookie, body: { jira: { url: 'https://x.atlassian.net' } }, headers: { origin: 'http://evil.example' } });
  assert.equal(evil.status, 403);
  const own = await req(APPH, 'POST', '/api/sources', { cookie, body: { jira: { url: 'https://ann.atlassian.net', token: 'ann-token' } }, headers: { origin: `http://${APPH()}` } });
  assert.equal(own.status, 200, own.text);
  const hosted = await req(APPH, 'GET', '/api/llm', { cookie }); assert.equal(hosted.json.hosted, true);
  assert.equal((await req(APPH, 'POST', '/api/admin/restart', { cookie, body: {}, headers: { origin: `http://${APPH()}` } })).status, 403, 'blocked paths stay blocked behind the gateway');
});

test('two workspaces cannot see each other', async () => {
  const a = await signedIn('iso-a@x.test'), b = await signedIn('iso-b@x.test');
  const set = await req(APPH, 'POST', '/api/sources', { cookie: a, body: { jira: { url: 'https://only-a.atlassian.net' } }, headers: { origin: `http://${APPH()}` } });
  assert.equal(set.status, 200);
  assert.equal((await req(APPH, 'GET', '/api/sources', { cookie: a })).json.jira.url, 'https://only-a.atlassian.net');
  assert.equal((await req(APPH, 'GET', '/api/sources', { cookie: b })).json.jira.url, '');
  const dirs = fs.readdirSync(path.join(data, 'orgs'));
  assert.ok(dirs.length >= 3, 'one folder per workspace');
  const raw = fs.readFileSync(path.join(data, 'orgs', dirs.find((d) => fs.existsSync(path.join(data, 'orgs', d, 'sources.json')) && /only-a/.test(fs.readFileSync(path.join(data, 'orgs', d, 'sources.json'), 'utf8'))), 'sources.json'), 'utf8');
  assert.ok(raw.includes('only-a'));
});

test('sign-in: generic error, rate limit, sessions, sign-out', async () => {
  await signedIn('bob@x.test');
  const bad = await req(APPH, 'POST', '/_gw/api/login', { body: { email: 'bob@x.test', password: 'wrong password!!' } });
  const ghost = await req(APPH, 'POST', '/_gw/api/login', { body: { email: 'nobody@x.test', password: 'wrong password!!' } });
  assert.equal(bad.status, 401); assert.equal(ghost.status, 401); assert.equal(bad.json.error, ghost.json.error);
  const ok = await req(APPH, 'POST', '/_gw/api/login', { body: { email: 'bob@x.test', password: 'correct horse battery' } });
  assert.equal(ok.status, 200);
  const cookie = cookieOf(ok);
  assert.equal((await req(APPH, 'GET', '/_gw/api/me', { cookie })).json.email, 'bob@x.test');
  assert.equal((await req(APPH, 'POST', '/_gw/api/logout', { cookie, body: {} })).status, 200);
  assert.equal((await req(APPH, 'GET', '/_gw/api/me', { cookie })).status, 401, 'the session is gone on the server');
  let last; for (let i = 0; i < 8; i++) last = await req(APPH, 'POST', '/_gw/api/login', { body: { email: 'bob@x.test', password: 'wrong password ' + i } });
  assert.equal(last.status, 429);
  assert.equal((await req(APPH, 'POST', '/_gw/api/login', { raw: '{"email":"a@b.c","password":"x"}', headers: { 'content-type': 'text/plain', 'content-length': '30' } })).status, 415);
});

test('password reset: one use, signs out every device, the same answer for unknown addresses', async () => {
  const email = 'cara@x.test';
  const cookie = await signedIn(email);
  const unknown = await req(APPH, 'POST', '/_gw/api/forgot', { body: { email: 'ghost@x.test' } });
  const known = await req(APPH, 'POST', '/_gw/api/forgot', { body: { email } });
  assert.deepEqual(unknown.json, known.json);
  const link = mailLink(email, 'reset'); assert.ok(link);
  const token = new URL(link).searchParams.get('token');
  assert.equal((await req(APPH, 'POST', '/_gw/api/reset', { body: { token, password: 'short' } })).status, 400);
  assert.equal((await req(APPH, 'POST', '/_gw/api/reset', { body: { token, password: 'a brand new passphrase' } })).status, 200, 'the token still works after a rejected weak password');
  assert.equal((await req(APPH, 'POST', '/_gw/api/reset', { body: { token, password: 'another new passphrase' } })).status, 400, 'a reset link works once');
  assert.equal((await req(APPH, 'GET', '/_gw/api/me', { cookie })).status, 401, 'old sessions are gone');
  assert.equal((await req(APPH, 'POST', '/_gw/api/login', { body: { email, password: 'a brand new passphrase' } })).status, 200);
});

test('invitations: a member joins the workspace, seats are limited, a wrong e-mail is refused', async () => {
  const owner = await signedIn('owner@x.test');
  const inv = await req(APPH, 'POST', '/_gw/api/invite', { cookie: owner, body: { email: 'mate@x.test' }, headers: { origin: `http://${APPH()}` } });
  assert.equal(inv.status, 200, inv.text);
  const link = mailLink('mate@x.test', 'signup'); assert.ok(link);
  const token = new URL(link).searchParams.get('invite');
  assert.equal((await req(APPH, 'GET', '/_gw/api/invite-info?token=' + token)).json.email, 'mate@x.test');
  assert.equal((await signup('someone-else@x.test', { invite: token })).status, 400);
  const joined = await signup('mate@x.test', { invite: token }); assert.equal(joined.status, 201);
  assert.equal(joined.json.next, '/', 'an invited person needs no e-mail confirmation');
  const mateMe = (await req(APPH, 'GET', '/_gw/api/me', { cookie: cookieOf(joined) })).json;
  assert.equal(mateMe.role, 'member');
  const ownerMe = (await req(APPH, 'GET', '/_gw/api/me', { cookie: owner })).json;
  assert.equal(mateMe.org.name, ownerMe.org.name); assert.equal(ownerMe.members.length, 2);
  assert.equal((await signup('mate2@x.test', { invite: token })).status, 400, 'an invitation works once');
  assert.equal((await req(APPH, 'POST', '/_gw/api/invite', { cookie: cookieOf(joined), body: { email: 'x@x.test' }, headers: { origin: `http://${APPH()}` } })).status, 403, 'a member cannot invite');
  assert.equal((await req(APPH, 'POST', '/_gw/api/invite', { cookie: owner, body: { email: 'third@x.test' }, headers: { origin: `http://${APPH()}` } })).status, 200);
  assert.equal((await req(APPH, 'POST', '/_gw/api/invite', { cookie: owner, body: { email: 'fourth@x.test' }, headers: { origin: `http://${APPH()}` } })).status, 402, 'MAX_SEATS (3) counts members and open invitations');
});

const sign = (payload, secret = WH_SECRET, t = Math.floor(Date.now() / 1000)) => ({ 'stripe-signature': `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}` });

test('billing: trial, checkout, webhook signature, activation, failed payment, cancellation, trial end', async () => {
  const email = 'pay@x.test';
  const cookie = await signedIn(email);
  const o = { cookie, body: {}, headers: { origin: `http://${APPH()}` } };
  let me = (await req(APPH, 'GET', '/_gw/api/me', { cookie })).json;
  assert.equal(me.access.state, 'trial'); assert.ok(me.access.daysLeft >= 13);
  const co = await req(APPH, 'POST', '/_gw/api/checkout', o);
  assert.equal(co.json.url, 'https://checkout.stripe.test/pay');
  const call = stripeCalls.find((c) => c.url === '/v1/checkout/sessions');
  assert.equal(call.auth, 'Bearer sk_test_x');
  assert.match(decodeURIComponent(call.body), /line_items\[0\]\[price\]=price_1/); assert.match(decodeURIComponent(call.body), /mode=subscription/);
  const orgId = new URLSearchParams(call.body).get('client_reference_id'); assert.ok(orgId);
  // webhook: bad signature, stale timestamp, good signature
  const ev = (id, type, object) => JSON.stringify({ id, type, data: { object } });
  const completed = ev('evt_1', 'checkout.session.completed', { client_reference_id: orgId, customer: 'cus_1', subscription: 'sub_1', metadata: { org: orgId } });
  assert.equal((await req(APPH, 'POST', '/_gw/stripe/webhook', { raw: completed, headers: sign(completed, 'wrong') })).status, 400);
  assert.equal((await req(APPH, 'POST', '/_gw/stripe/webhook', { raw: completed, headers: sign(completed, WH_SECRET, 1000) })).status, 400);
  assert.equal((await req(APPH, 'POST', '/_gw/stripe/webhook', { raw: completed, headers: sign(completed) })).status, 200);
  me = (await req(APPH, 'GET', '/_gw/api/me', { cookie })).json; assert.equal(me.access.state, 'active'); assert.equal(me.billing.subscribed, true);
  assert.equal((await req(APPH, 'POST', '/_gw/stripe/webhook', { raw: completed, headers: sign(completed) })).json.duplicate, true, 'the same event is applied once');
  assert.equal((await req(APPH, 'POST', '/_gw/api/portal', o)).json.url, 'https://billing.stripe.test/portal');
  const failed = ev('evt_2', 'invoice.payment_failed', { customer: 'cus_1', metadata: {} });
  await req(APPH, 'POST', '/_gw/stripe/webhook', { raw: failed, headers: sign(failed) });
  me = (await req(APPH, 'GET', '/_gw/api/me', { cookie })).json; assert.equal(me.access.state, 'past_due'); assert.equal(me.access.ok, true, 'a short grace period');
  const paid = ev('evt_3', 'invoice.paid', { customer: 'cus_1', metadata: {} });
  await req(APPH, 'POST', '/_gw/stripe/webhook', { raw: paid, headers: sign(paid) });
  assert.equal((await req(APPH, 'GET', '/_gw/api/me', { cookie })).json.access.state, 'active');
  const gone = ev('evt_4', 'customer.subscription.deleted', { id: 'sub_1', customer: 'cus_1', metadata: { org: orgId } });
  await req(APPH, 'POST', '/_gw/stripe/webhook', { raw: gone, headers: sign(gone) });
  me = (await req(APPH, 'GET', '/_gw/api/me', { cookie })).json; assert.equal(me.access.ok, false);
  assert.equal((await req(APPH, 'GET', '/api/agents', { cookie })).status, 402, 'no access without a subscription');
  const page = await req(APPH, 'GET', '/', { cookie, headers: { accept: 'text/html' } }); assert.equal(page.status, 302); assert.match(page.headers.location, /_gw\/account/);
  // a trial that ran out
  const db = new DatabaseSync(path.join(data, 'gateway.db'));
  db.prepare("update orgs set status = 'trial', trial_ends = ? where id = ?").run(Date.now() - 1000, orgId); db.close();
  me = (await req(APPH, 'GET', '/_gw/api/me', { cookie })).json; assert.equal(me.access.state, 'trial_ended'); assert.equal((await req(APPH, 'GET', '/api/agents', { cookie })).status, 402);
});

test('billing.verifySignature: right secret, tampered body, old timestamp', () => {
  const body = '{"id":"evt_x"}', t = Math.floor(Date.now() / 1000), h = (b, s) => `t=${t},v1=${crypto.createHmac('sha256', s).update(`${t}.${b}`).digest('hex')}`;
  assert.equal(billing.verifySignature(body, h(body, 's'), 's'), true);
  assert.equal(billing.verifySignature(body + ' ', h(body, 's'), 's'), false);
  assert.equal(billing.verifySignature(body, h(body, 'x'), 's'), false);
  assert.equal(billing.verifySignature(body, `t=1,v1=${'0'.repeat(64)}`, 's'), false);
  assert.equal(billing.verifySignature(body, '', 's'), false);
  assert.equal(billing.form({ mode: 'subscription', line_items: [{ price: 'p', quantity: 1 }], a: { b: 'c d' } }), 'mode=subscription&line_items%5B0%5D%5Bprice%5D=p&line_items%5B0%5D%5Bquantity%5D=1&a%5Bb%5D=c%20d');
});

test('data export and workspace deletion', async () => {
  const email = 'del@x.test';
  const cookie = await signedIn(email);
  await req(APPH, 'GET', '/api/agents', { cookie }); // start the workspace so it has a folder
  const acc = await req(APPH, 'GET', '/_gw/api/export', { cookie }); assert.equal(acc.status, 200); assert.equal(acc.json.user.email, email);
  const tgz = await req(APPH, 'GET', '/_gw/api/export-data', { cookie }); assert.equal(tgz.status, 200); assert.equal(tgz.buf[0], 0x1f); assert.equal(tgz.buf[1], 0x8b);
  const zlib = require('node:zlib'); const tar = zlib.gunzipSync(tgz.buf); assert.equal(tar.length % 512, 0); assert.ok(!tar.toString('latin1').includes('llm.json'), 'AI keys are not exported');
  const o = { cookie, headers: { origin: `http://${APPH()}` } };
  assert.equal((await req(APPH, 'POST', '/_gw/api/delete-workspace', { ...o, body: { password: 'correct horse battery', confirm: 'nope' } })).status, 400);
  assert.equal((await req(APPH, 'POST', '/_gw/api/delete-workspace', { ...o, body: { password: 'wrong password!!', confirm: 'DELETE' } })).status, 403);
  const before_ = fs.readdirSync(path.join(data, 'orgs')).length;
  assert.equal((await req(APPH, 'POST', '/_gw/api/delete-workspace', { ...o, body: { password: 'correct horse battery', confirm: 'DELETE' } })).status, 200);
  assert.equal(fs.readdirSync(path.join(data, 'orgs')).length, before_ - 1, 'the folder is gone');
  assert.equal((await req(APPH, 'POST', '/_gw/api/login', { body: { email, password: 'correct horse battery' } })).status, 401, 'the account is gone');
});

test('the gateway secret and payment keys do not reach the customer process', async () => {
  const cookie = await signedIn('env@x.test');
  await req(APPH, 'GET', '/api/agents', { cookie });
  const dirs = fs.readdirSync(path.join(data, 'orgs'));
  const log = dirs.map((d) => { try { return fs.readFileSync(path.join(data, 'orgs', d, 'server.log'), 'utf8'); } catch (_) { return ''; } }).join('\n');
  assert.ok(!log.includes('sk_test_x') && !log.includes('test-master-secret'), 'no secret in a workspace log');
  assert.ok(fs.existsSync(path.join(data, 'gateway.db')));
});
