// Checkout in the „card first” variant (TRIAL_REQUIRES_CARD=1): the trial starts only after a payment method is added.
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
// Fake Stripe: prices, customers, checkout sessions (created and read back), billing portal, subscriptions.
const stripeSessions = {}; let custN = 0;
function fakeStripe(method, url) {
  if (url.startsWith('/v1/prices/')) {
    const id = url.split('/').pop();
    return { price_1: { id, unit_amount: 2900, currency: 'eur', recurring: { interval: 'month', interval_count: 1 } }, price_6: { id, unit_amount: 15000, currency: 'eur', recurring: { interval: 'month', interval_count: 6 } },
      price_12: { id, unit_amount: 27600, currency: 'eur', recurring: { interval: 'year', interval_count: 1 } }, price_bad: { id, unit_amount: 100, currency: 'eur', recurring: { interval: 'month', interval_count: 1 } } }[id] || {};
  }
  if (method === 'POST' && url === '/v1/customers') return { id: 'cus_new_' + (++custN) };
  if (url.startsWith('/v1/customers/')) return { id: url.split('/').pop() };
  if (method === 'GET' && url.startsWith('/v1/checkout/sessions/')) return stripeSessions[decodeURIComponent(url.split('/').pop())] || { id: 'cs_x', status: 'open' };
  if (url.includes('checkout')) return { url: 'https://checkout.stripe.test/pay' };
  if (url.includes('portal')) return { url: 'https://billing.stripe.test/portal' };
  return { id: 'sub_1', status: 'canceled' };
}
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const SITE = () => `localhost:${port}`, APPH = () => `app.localhost:${port}`;

/** One request to the gateway with a chosen Host header. Returns { status, headers, text, json }. */
function req(host, method, p, { body, cookie, headers = {}, raw } = {}) {
  return new Promise((resolve, reject) => {
    const payload = raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined;
    // agent:false forces a fresh socket per request: the gateway does not keep connections alive, and reusing a
    // half-closed keep-alive socket made this suite flaky on Linux CI (an occasional empty 400 on the next request).
    const r = http.request({ host: '127.0.0.1', port, method, path: p, agent: false, headers: { host: host(), connection: 'close', ...(payload !== undefined ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}), ...(cookie ? { cookie } : {}), ...headers } }, (res) => {
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
  stripe = http.createServer((q, s) => { let b = ''; q.on('data', (c) => { b += c; }); q.on('end', () => { stripeCalls.push({ method: q.method, url: q.url, body: b, auth: q.headers.authorization }); s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify(fakeStripe(q.method, q.url))); }); });
  await new Promise((r) => stripe.listen(0, '127.0.0.1', r));
  stripeBase = 'http://127.0.0.1:' + stripe.address().port;
  port = await freePort();
  data = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-cloud-'));
  gw = spawn('node', ['cloud/server.js'], { cwd: APP, env: { ...process.env, CLOUD_PORT: String(port), CLOUD_DATA: data, SITE_HOST: SITE(), APP_HOST: APPH(), CLOUD_MASTER_SECRET: 'test-master-secret-0123456789abcdef', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRICE_ID: 'price_1', STRIPE_PRICE_SEMIANNUAL: 'price_6', STRIPE_PRICE_ANNUAL: 'price_12', PRICE_CURRENCY: 'EUR', PRICE_MONTHLY: '29', PRICE_SEMIANNUAL: '150', PRICE_ANNUAL: '276', STRIPE_WEBHOOK_SECRET: WH_SECRET, STRIPE_API_BASE: stripeBase, COMPANY_NAME: 'Test Co', MAX_SEATS: '3', SIGNUPS_PER_HOUR_PER_IP: '1000', PRICE_LABEL: '29 EUR / month', TRIAL_DAYS: '14', TRIAL_REQUIRES_CARD: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  gw.stderr.on('data', (c) => { out += c; });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('gateway did not start: ' + out)), 20000);
    gw.stdout.on('data', (c) => { out += c; if (String(c).includes('listening on')) { clearTimeout(t); resolve(); } });
    gw.on('exit', (code) => reject(new Error('gateway exited early: ' + code + out)));
  });
});
after(async () => { if (gw) { gw.kill(); await new Promise((r) => setTimeout(r, 800)); } if (stripe) stripe.close(); try { fs.rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch (_) { /* temp */ } });


test('card first: sign-up leads to the checkout, no access before it, the trial runs in Stripe', async () => {
  const r = await signup('cardfirst@x.test');
  assert.equal(r.status, 201); assert.equal(r.json.next, '/_gw/verify-needed', 'e-mail confirmation still comes first');
  const cookie = await signedIn('cardfirst2@x.test');
  let me = (await req(APPH, 'GET', '/_gw/api/me', { cookie })).json;
  assert.equal(me.access.ok, false); assert.equal(me.access.state, 'payment_required'); assert.match(me.access.label, /14-day free trial/);
  const page = await req(APPH, 'GET', '/', { cookie, headers: { accept: 'text/html' } });
  assert.equal(page.status, 302); assert.match(page.headers.location, /\/_gw\/checkout$/);
  assert.equal((await req(APPH, 'GET', '/api/agents', { cookie })).status, 402);
  const plan = (await req(APPH, 'GET', '/_gw/api/plan', { cookie })).json;
  assert.equal(plan.stripeTrialDays, 14); assert.equal(plan.trialRequiresCard, true);
  const signupPage = await req(APPH, 'GET', '/_gw/signup');
  assert.match(signupPage.text, /a card is needed to start/);
  const home = await req(SITE, 'GET', '/'); assert.match(home.text, /a card is needed to start/);
  const o = { cookie, headers: { origin: `http://${APPH()}` } };
  stripeCalls.length = 0;
  assert.equal((await req(APPH, 'POST', '/_gw/api/checkout', { ...o, body: { acceptTerms: true } })).status, 200);
  const sess = new URLSearchParams(stripeCalls.find((c) => c.url === '/v1/checkout/sessions').body);
  assert.equal(sess.get('subscription_data[trial_period_days]'), '14', 'the free trial runs in Stripe; the first charge comes after it');
  const orgId = sess.get('client_reference_id');
  stripeSessions.cs_t = { id: 'cs_t', status: 'complete', payment_status: 'no_payment_required', client_reference_id: orgId, customer: 'cus_new_1', subscription: 'sub_t' };
  const ok = (await req(APPH, 'POST', '/_gw/api/checkout/confirm', { ...o, body: { sessionId: 'cs_t' } })).json;
  assert.equal(ok.confirmed, true); assert.equal(ok.access.ok, true);
  // a workspace that already had a subscription gets no second free trial
  const db = new DatabaseSync(path.join(data, 'gateway.db')); db.prepare("update orgs set status = 'canceled' where id = ?").run(orgId); db.close();
  stripeCalls.length = 0;
  await req(APPH, 'POST', '/_gw/api/checkout', { ...o, body: { acceptTerms: true } });
  assert.equal(new URLSearchParams(stripeCalls.find((c) => c.url === '/v1/checkout/sessions').body).get('subscription_data[trial_period_days]'), null);
});
