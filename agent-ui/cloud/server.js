#!/usr/bin/env node
// Flawtrace Cloud gateway. One small HTTP server that
//   - serves the public site (landing, pricing, legal) on SITE_HOST,
//   - serves sign-up, sign-in, account and billing pages on APP_HOST under /_gw/,
//   - and, for a signed-in customer with a valid trial or subscription, forwards every other request on APP_HOST to that
//     customer's own Flawtrace process (cloud/tenants.js), after adding the gateway secret that process insists on.
// No dependencies: node:sqlite for the database, fetch for Stripe and e-mail.
const http = require('http');
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const db = require('./db');
const auth = require('./auth');
const mailer = require('./mailer');
const billing = require('./billing');
const plans = require('./plans');
const tenants = require('./tenants');
const tar = require('./tar');

const SITE_DIR = path.join(__dirname, 'site');
const COOKIE = cfg.SECURE ? '__Host-ft_session' : 'ft_session';
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

// ---------- small helpers ----------
const clientIp = (req) => (process.env.TRUST_PROXY === '1' ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '') || req.socket.remoteAddress || '';
const hostOf = (req) => String(req.headers.host || '').toLowerCase();
const wantsHtml = (req) => req.method === 'GET' && String(req.headers.accept || '').includes('text/html');

function baseHeaders(extra = {}) {
  return { 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', 'x-frame-options': 'DENY', 'permissions-policy': 'camera=(), microphone=(), geolocation=()', ...(cfg.SECURE ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' } : {}), ...extra };
}
function send(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, baseHeaders({ 'content-type': type, 'cache-control': 'no-store', ...extra }));
  res.end(body);
}
const json = (res, status, obj, extra) => send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8', extra);
const redirect = (res, to, extra = {}) => { res.writeHead(302, baseHeaders({ location: to, 'cache-control': 'no-store', ...extra })); res.end(); };

function readBody(req, limit = 100 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(Object.assign(new Error('The request is too large.'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) {
  if (!/^application\/json/i.test(String(req.headers['content-type'] || ''))) throw Object.assign(new Error('Send JSON.'), { code: 415 });
  const raw = await readBody(req);
  try { return JSON.parse(raw.toString('utf8') || '{}'); } catch (_) { throw Object.assign(new Error('Invalid JSON.'), { code: 400 }); }
}

function cookies(req) { return Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => { const i = c.indexOf('='); return i < 0 ? [] : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())]; }).filter((p) => p.length)); }
const sessionCookie = (token, maxAgeSec) => `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${cfg.SECURE ? '; Secure' : ''}`;
const sessionOf = (req) => auth.sessionFor(cookies(req)[COOKIE]);

/** A state-changing request must come from our own pages. Browsers tell us with Origin / Sec-Fetch-Site. */
function sameOrigin(req) {
  const o = req.headers.origin;
  if (o) return o === cfg.appUrl;
  const s = req.headers['sec-fetch-site'];
  return !s || s === 'same-origin' || s === 'none';
}

// ---------- static files ----------
const cache = new Map();
function fileFor(rel) {
  const abs = path.resolve(SITE_DIR, rel);
  if (!abs.startsWith(SITE_DIR + path.sep)) return null;
  try { const st = fs.statSync(abs); return st.isFile() ? abs : null; } catch (_) { return null; }
}
const placeholders = () => ({
  GOVERNING_LAW: cfg.GOVERNING_LAW, BACKUP_DAYS: String(cfg.BACKUP_DAYS), COMPANY_NAME: cfg.COMPANY_NAME, COMPANY_ADDRESS: cfg.COMPANY_ADDRESS, COMPANY_ID: cfg.COMPANY_ID, CONTACT_EMAIL: cfg.CONTACT_EMAIL, HOSTING_REGION: cfg.HOSTING_REGION, HOSTING_PROVIDER: cfg.HOSTING_PROVIDER,
  SITE_URL: cfg.siteUrl, APP_URL: cfg.appUrl, TRIAL_DAYS: String(cfg.TRIAL_DAYS), PRICE_LABEL: plans.label(), ...pricePlaceholders(), TRIAL_NOTE: cfg.TRIAL_REQUIRES_CARD ? 'a card is needed to start; the first charge comes after the trial' : 'no card needed', YEAR: String(new Date().getFullYear()), TERMS_VERSION: auth.TERMS_VERSION,
});
// Cennik na stronie: {{P_MONTHLY_PRICE}}, {{P_ANNUAL_PER_MONTH}}, {{P_SEMIANNUAL_SAVE}}…, {{ENT_FROM}}, {{ENT_SEATS}}, {{SEATS}}.
function pricePlaceholders() {
  const out = { CURRENCY: cfg.PRICE_CURRENCY, ENT_FROM: plans.enterprise().fromText, ENT_SEATS: String(plans.enterprise().seats), SEATS: String(cfg.MAX_SEATS) };
  for (const p of plans.PERIODS) { const c = plans.find(p.id); const k = 'P_' + p.id.toUpperCase();
    out[k + '_PRICE'] = c ? c.priceText : ''; out[k + '_PER_MONTH'] = c ? c.perMonthText : ''; out[k + '_SAVE'] = c ? String(c.save) : '0'; }
  return out;
}
const partial = (n) => { try { return fs.readFileSync(path.join(SITE_DIR, 'partials', n + '.html'), 'utf8'); } catch (_) { return ''; } };
function serveFile(res, abs, { template = false, immutable = false } = {}) {
  const ext = path.extname(abs).toLowerCase();
  let body = fs.readFileSync(abs);
  if (template && ext === '.html') { let t = body.toString('utf8'); t = t.split('{{HEADER}}').join(partial('header')).split('{{FOOTER}}').join(partial('footer')); for (const [k, v] of Object.entries(placeholders())) t = t.split(`{{${k}}}`).join(v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))); body = Buffer.from(t); }
  res.writeHead(200, baseHeaders({ 'content-type': TYPES[ext] || 'application/octet-stream', 'content-security-policy': CSP, 'cache-control': ext === '.html' ? 'no-cache' : (immutable ? 'public, max-age=3600' : 'no-cache') }));
  res.end(body);
}

// ---------- the public site ----------
const SITE_PAGES = { '/': 'index.html', '/privacy': 'legal/privacy.html', '/terms': 'legal/terms.html', '/dpa': 'legal/dpa.html', '/security': 'legal/security.html', '/subprocessors': 'legal/subprocessors.html', '/cookies': 'legal/cookies.html' };
function serveSite(req, res, p) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  if (p === '/.well-known/security.txt') return send(res, 200, `Contact: mailto:${cfg.CONTACT_EMAIL}
Expires: ${new Date(Date.now() + 365 * 86400000).toISOString()}
Preferred-Languages: en, pl
Canonical: ${cfg.siteUrl}/.well-known/security.txt
Policy: ${cfg.siteUrl}/security
`);
  if (p === '/robots.txt') return send(res, 200, `User-agent: *\nAllow: /\nSitemap: ${cfg.siteUrl}/sitemap.xml\n`);
  if (p === '/sitemap.xml') return send(res, 200, `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Object.keys(SITE_PAGES).map((u) => `<url><loc>${cfg.siteUrl}${u === '/' ? '' : u}</loc></url>`).join('')}</urlset>`, 'application/xml');
  const page = SITE_PAGES[p.replace(/(.)\/$/, '$1')];
  if (page) { const f = fileFor(page); if (f) return serveFile(res, f, { template: true }); }
  if (p.startsWith('/assets/')) { const f = fileFor(p.slice(1)); if (f) return serveFile(res, f, { immutable: true }); }
  const nf = fileFor('404.html');
  if (nf) { res.writeHead(404, baseHeaders({ 'content-type': TYPES['.html'], 'content-security-policy': CSP })); return res.end(fs.readFileSync(nf)); }
  send(res, 404, 'Not found');
}

// ---------- the account API (under /_gw/api) ----------
const publicUser = (s) => {
  const { user, org } = s;
  const members = db.all('select email, name, role from users where org_id = ? order by created', org.id);
  const invites = user.role === 'owner' ? db.all('select email, expires from invites where org_id = ? and used = 0 and expires > ? order by created', org.id, db.now()) : [];
  return {
    email: user.email, name: user.name, role: user.role, emailVerified: !!user.email_verified, needsVerification: cfg.REQUIRE_VERIFIED_EMAIL && !user.email_verified,
    org: { name: org.name, status: org.status, created: org.created, trialEnds: org.trial_ends, plan: org.plan, paidUntil: org.paid_until || null },
    access: auth.access(org), billing: { enabled: billing.enabled(), subscribed: !!org.stripe_subscription, priceLabel: cfg.PRICE_LABEL, hasCustomer: !!org.stripe_customer },
    members, invites, seats: auth.seatsOf(org), termsVersion: user.terms_version, admin: cfg.ADMIN_EMAILS.includes(user.email),
  };
};

async function api(req, res, p) {
  const ip = clientIp(req);
  if (req.method === 'POST' && p === '/_gw/stripe/webhook') {
    const raw = (await readBody(req, 1024 * 1024)).toString('utf8');
    if (!billing.verifySignature(raw, req.headers['stripe-signature'])) return json(res, 400, { error: 'bad signature' });
    let ev; try { ev = JSON.parse(raw); } catch (_) { return json(res, 400, { error: 'bad json' }); }
    return json(res, 200, billing.applyEvent(ev));
  }
  if (req.method === 'GET' && p === '/_gw/api/config') return json(res, 200, { betaCode: !!cfg.BETA_CODE, billing: billing.enabled(), trialDays: cfg.TRIAL_DAYS, trialRequiresCard: cfg.TRIAL_REQUIRES_CARD, siteUrl: cfg.siteUrl, termsVersion: auth.TERMS_VERSION });
  if (req.method === 'GET' && p === '/_gw/api/plan') {
    const s = sessionOf(req);
    const trialDays = s ? billing.stripeTrialDays(s.org) : (cfg.TRIAL_REQUIRES_CARD ? cfg.TRIAL_DAYS : 0);
    const list = [];
    for (const pl of plans.catalog()) {
      const price = await billing.priceInfo(pl.id);
      const match = billing.matchesCatalog(pl, price);
      if (match === false) console.error(`pricing: the Stripe price of plan "${pl.id}" (${price.amount} ${price.currency}, ${price.intervalCount} ${price.interval}) differs from the price list (${pl.price} ${pl.currency} / ${pl.months} mo)`);
      list.push({ id: pl.id, name: pl.name, months: pl.months, every: pl.every, price: pl.price, priceText: pl.priceText, perMonthText: pl.perMonthText, save: pl.save, currency: pl.currency, sellable: pl.sellable && match !== false, stripe: price, matchesStripe: match });
    }
    const def = plans.defaultPlan();
    return json(res, 200, { billing: billing.enabled(), name: cfg.PLAN_NAME, plans: list, defaultPlan: def && def.id, current: s ? s.org.plan : null, enterprise: plans.enterprise(),
      seats: s ? auth.seatsOf(s.org) : cfg.MAX_SEATS, taxAtCheckout: cfg.STRIPE_TAX, trialDays: cfg.TRIAL_DAYS, trialRequiresCard: cfg.TRIAL_REQUIRES_CARD, stripeTrialDays: trialDays, firstCharge: s ? billing.firstChargeAt(s.org) : null,
      termsVersion: auth.TERMS_VERSION, siteUrl: cfg.siteUrl, contact: cfg.CONTACT_EMAIL });
  }
  if (req.method === 'GET' && p === '/_gw/api/invite-info') { const i = auth.inviteInfo(new URL(req.url, 'http://x').searchParams.get('token')); return i ? json(res, 200, i) : json(res, 404, { error: 'This invitation is no longer valid.' }); }
  if (req.method === 'GET' && p === '/_gw/api/me') { const s = sessionOf(req); return s ? json(res, 200, publicUser(s)) : json(res, 401, { error: 'signin' }); }
  if (req.method !== 'POST' && req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  if (req.method === 'POST' && !sameOrigin(req)) return json(res, 403, { error: 'Cross-site request refused.' });

  if (req.method === 'POST') {
    if (p === '/_gw/api/signup') {
      const b = await readJson(req);
      const r = await auth.signUp({ ...b, ip });
      if (r.verifyToken) { const u = db.one('select email from users where id = ?', r.userId); mailer.verifyMail(u.email, r.verifyToken); }
      const token = auth.makeSession(r.userId, ip, req.headers['user-agent']);
      const org = db.one('select o.* from orgs o join users u on u.org_id = o.id where u.id = ?', r.userId);
      const pay = billing.enabled() && !auth.access(org).ok && auth.access(org).state === 'payment_required';
      return json(res, 201, { ok: true, next: r.verifyToken ? '/_gw/verify-needed' : pay ? '/_gw/checkout' : '/' }, { 'set-cookie': sessionCookie(token, cfg.SESSION_DAYS * 86400) });
    }
    if (p === '/_gw/api/login') {
      const b = await readJson(req);
      const { token } = await auth.signIn({ ...b, ip, agent: req.headers['user-agent'] });
      return json(res, 200, { ok: true }, { 'set-cookie': sessionCookie(token, cfg.SESSION_DAYS * 86400) });
    }
    if (p === '/_gw/api/logout') { auth.signOut(cookies(req)[COOKIE]); return json(res, 200, { ok: true }, { 'set-cookie': sessionCookie('', 0) }); }
    if (p === '/_gw/api/forgot') {
      const b = await readJson(req);
      const r = auth.requestReset(b.email, ip);
      if (r) mailer.resetMail(auth.normEmail(b.email), r.token);
      return json(res, 200, { ok: true });
    }
    if (p === '/_gw/api/reset') { const b = await readJson(req); await auth.resetPassword(b.token, b.password); return json(res, 200, { ok: true }); }
  }

  const s = sessionOf(req);
  if (!s) return json(res, 401, { error: 'signin' });
  const owner = s.user.role === 'owner';
  const needOwner = () => { if (!owner) throw auth.err('Only the owner of the workspace can do this.', 403); };

  if (req.method === 'GET' && p === '/_gw/api/export') {
    const data = { exportedAt: new Date().toISOString(), user: { email: s.user.email, name: s.user.name, created: s.user.created, termsAcceptedAt: s.user.terms_at, termsVersion: s.user.terms_version }, workspace: { name: s.org.name, status: s.org.status, created: s.org.created }, members: db.all('select email, role from users where org_id = ?', s.org.id), activity: db.all('select ts, type, detail from audit where org_id = ? order by ts desc limit 500', s.org.id) };
    return send(res, 200, JSON.stringify(data, null, 2), 'application/json; charset=utf-8', { 'content-disposition': 'attachment; filename="flawtrace-account.json"' });
  }
  if (req.method === 'GET' && p === '/_gw/api/export-data') {
    const dir = tenants.orgDir(s.org.id);
    const skip = (rel, isDir) => /^(repos|home|specs-backup)(\/|$)/.test(rel) || /(^|\/)work(\/|$)/.test(rel) || /^(llm|sources)\.json$/.test(rel) || /\.(log|lock)$/.test(rel) || (isDir && rel === 'ui-shots-cache');
    const files = tar.listFiles(dir, skip);
    res.writeHead(200, baseHeaders({ 'content-type': 'application/gzip', 'content-disposition': 'attachment; filename="flawtrace-workspace-data.tar.gz"', 'cache-control': 'no-store' }));
    db.audit('export_data', { user: s.user.id, org: s.org.id, ip });
    return tar.pack(files, res, 'flawtrace-workspace/');
  }
  if (req.method !== 'POST') return json(res, 404, { error: 'Not found' });

  if (p === '/_gw/api/resend-verification') {
    if (!auth.allow('resend:' + s.user.id, 3, 3600000)) throw auth.err('Wait a while before asking again.', 429);
    const t = auth.resendVerification(s.user.id);
    if (t) mailer.verifyMail(s.user.email, t);
    return json(res, 200, { ok: true, already: !t });
  }
  if (p === '/_gw/api/change-password') { const b = await readJson(req); await auth.changePassword(s.user.id, b.current, b.next); return json(res, 200, { ok: true }); }
  if (p === '/_gw/api/invite') {
    needOwner(); const b = await readJson(req);
    const token = auth.invite(s.org.id, s.user.id, b.email);
    mailer.inviteMail(auth.normEmail(b.email), token, s.user.name || s.user.email, s.org.name);
    return json(res, 200, { ok: true });
  }
  if (p === '/_gw/api/revoke-invite') { needOwner(); const b = await readJson(req); db.run('update invites set used = 1 where org_id = ? and email = ?', s.org.id, auth.normEmail(b.email)); return json(res, 200, { ok: true }); }
  if (p === '/_gw/api/remove-member') {
    needOwner(); const b = await readJson(req);
    const u = db.one('select * from users where email = ? and org_id = ?', auth.normEmail(b.email), s.org.id);
    if (!u || u.id === s.user.id) throw auth.err('That member cannot be removed.');
    db.run('delete from users where id = ?', u.id); db.audit('member_removed', { user: s.user.id, org: s.org.id, detail: u.email });
    return json(res, 200, { ok: true });
  }
  if (p === '/_gw/api/checkout') {
    needOwner();
    const b = await readJson(req);
    if (!billing.enabled()) return json(res, 400, { error: 'Billing is not switched on: Flawtrace is free during the beta.' });
    if (auth.access(s.org).state === 'active' && s.org.stripe_subscription) return json(res, 409, { error: 'This workspace already has an active subscription. Manage it in the billing portal.' });
    if (b.acceptTerms !== true) return json(res, 400, { error: 'Accept the Terms of Service and the automatic monthly renewal to continue.' });
    const email = String(b.billingEmail || s.user.email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return json(res, 400, { error: 'Enter a valid billing e-mail address.' });
    const company = String(b.company || '').trim().slice(0, 120);
    if (company) db.run('update orgs set name = ? where id = ?', company, s.org.id);
    const plan = plans.find(String(b.plan || '') || (plans.defaultPlan() || {}).id);
    if (!plan || !plan.sellable) return json(res, 400, { error: 'Choose an available billing period.' });
    if (billing.matchesCatalog(plan, await billing.priceInfo(plan.id)) === false) return json(res, 503, { error: 'This price is being updated. Try again in a few minutes or choose another period.' });
    const customer = await billing.ensureCustomer(s.org, { email, name: company || s.org.name });
    db.audit('checkout_started', { user: s.user.id, org: s.org.id, ip, detail: `plan ${plan.id} ${plan.priceText} ${plan.every}; terms ${auth.TERMS_VERSION}; auto-renewal accepted` });
    return json(res, 200, { url: await billing.checkoutUrl({ ...s.org, stripe_customer: customer }, s.user, { customer, plan }) });
  }
  if (p === '/_gw/api/checkout/confirm') {
    const b = await readJson(req);
    const r = await billing.confirmSession(s.org, b.sessionId);
    const org = db.one('select * from orgs where id = ?', s.org.id);
    // W trialu (Stripe nic jeszcze nie pobrał) strona sukcesu podaje datę pierwszej płatności.
    const firstCharge = r.trial ? (!cfg.TRIAL_REQUIRES_CARD && org.trial_ends > Date.now() ? org.trial_ends : Date.now() + cfg.TRIAL_DAYS * 86400000) : null;
    return json(res, 200, { ...r, firstCharge, access: auth.access(org) });
  }
  if (p === '/_gw/api/portal') { needOwner(); return json(res, 200, { url: await billing.portalUrl(s.org) }); }
  if (p === '/_gw/api/delete-workspace') {
    needOwner(); const b = await readJson(req);
    if (b.confirm !== 'DELETE') throw auth.err('Type DELETE to confirm.');
    if (!auth.allow('delete:' + s.user.id, 5, 3600000)) throw auth.err('Too many attempts.', 429);
    if (!(await auth.confirmPassword(s.user.id, b.password))) throw auth.err('The password is wrong.', 403);
    await billing.cancelSubscription(s.org);
    await tenants.remove(s.org.id);
    db.tx(() => { db.run('delete from users where org_id = ?', s.org.id); db.run('delete from invites where org_id = ?', s.org.id); db.run('delete from orgs where id = ?', s.org.id); });
    db.audit('workspace_deleted', { org: s.org.id, ip, detail: s.org.name });
    return json(res, 200, { ok: true }, { 'set-cookie': sessionCookie('', 0) });
  }
  return json(res, 404, { error: 'Not found' });
}

// ---------- the product: authenticated reverse proxy to the customer's own process ----------
const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length']);
const STRIP_IN = new Set(['cookie', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded', 'x-real-ip', 'x-flawtrace-gateway', 'origin', 'referer', 'accept-encoding']);
const MAX_UPLOAD = 40 * 1024 * 1024;

function forward(req, res, t, { inject = false, retry = true, orgId }) {
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) && !STRIP_IN.has(k)) headers[k] = v;
  headers['x-flawtrace-gateway'] = t.token; headers.host = `127.0.0.1:${t.port}`; headers['accept-encoding'] = 'identity';
  if (req.headers['content-length']) headers['content-length'] = req.headers['content-length'];
  let sent = 0;
  const up = http.request({ host: '127.0.0.1', port: t.port, method: req.method, path: req.url, headers }, (pr) => {
    const out = {};
    for (const [k, v] of Object.entries(pr.headers)) if (!HOP.has(k) || k === 'content-length') out[k] = v;
    delete out['set-cookie']; // the product never sets cookies; the session belongs to the gateway
    Object.assign(out, baseHeaders());
    const isHtml = inject && /text\/html/i.test(String(pr.headers['content-type'] || '')) && pr.statusCode === 200;
    if (isHtml) {
      const chunks = []; pr.on('data', (c) => chunks.push(c));
      pr.on('end', () => {
        let html = Buffer.concat(chunks).toString('utf8');
        const tag = '<script src="/_gw/static/shell.js" defer></script>';
        html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, tag + '</body>') : html + tag;
        delete out['content-length']; delete out.etag; out['cache-control'] = 'no-store';
        res.writeHead(200, out); res.end(html);
      });
      return;
    }
    res.writeHead(pr.statusCode, out);
    if (String(pr.headers['content-type'] || '').includes('text/event-stream')) { res.flushHeaders(); pr.on('data', (c) => { res.write(c); }); pr.on('end', () => res.end()); }
    else pr.pipe(res);
    req.on('close', () => pr.destroy());
  });
  up.setTimeout(0);
  up.on('error', async () => {
    if (res.headersSent) return res.destroy();
    tenants.stop(orgId); // the process died: forget it, start it again once
    if (retry && ['GET', 'HEAD'].includes(req.method)) { try { return forward(req, res, await tenants.ensure(orgId), { inject, retry: false, orgId }); } catch (_) { /* fall through */ } }
    send(res, 502, 'Your workspace is restarting. Reload in a few seconds.');
  });
  req.on('data', (c) => { sent += c.length; if (sent > MAX_UPLOAD) { up.destroy(); req.destroy(); } });
  req.pipe(up);
}

async function product(req, res, p) {
  const s = sessionOf(req);
  if (!s) {
    if (wantsHtml(req)) return redirect(res, '/_gw/login' + (p === '/' ? '' : '?next=' + encodeURIComponent(req.url)));
    return json(res, 401, { error: 'signin' });
  }
  if (cfg.REQUIRE_VERIFIED_EMAIL && !s.user.email_verified) return wantsHtml(req) ? redirect(res, '/_gw/verify-needed') : json(res, 403, { error: 'Confirm your e-mail first.' });
  const acc = auth.access(s.org);
  if (!acc.ok) return wantsHtml(req) ? redirect(res, s.user.role === 'owner' && billing.enabled() && acc.state !== 'suspended' ? '/_gw/checkout' : '/_gw/account') : json(res, 402, { error: acc.label, state: acc.state });
  if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) return json(res, 403, { error: 'Cross-site request refused.' });
  let t;
  try { t = await tenants.ensure(s.org.id); } catch (e) { return wantsHtml(req) ? send(res, e.code || 503, `<!doctype html><meta charset=utf-8><title>Flawtrace</title><p style="font:16px system-ui;max-width:520px;margin:15vh auto">${String(e.message).replace(/[<&]/g, '')}</p>`, 'text/html; charset=utf-8') : json(res, e.code || 503, { error: e.message }); }
  tenants.touch(s.org.id);
  forward(req, res, t, { inject: req.method === 'GET' && (p === '/' || p === '/index.html'), orgId: s.org.id });
}

// ---------- the app host ----------
function serveApp(req, res, p) {
  if (p.startsWith('/_gw/static/')) { const f = fileFor('app/' + p.slice('/_gw/static/'.length)); return f ? serveFile(res, f, { immutable: true }) : send(res, 404, 'Not found'); }
  const PAGES = { '/_gw/login': 'login', '/_gw/signup': 'signup', '/_gw/forgot': 'forgot', '/_gw/reset': 'reset', '/_gw/account': 'account', '/_gw/verify-needed': 'verify-needed', '/_gw/checkout': 'checkout', '/_gw/checkout/success': 'checkout-success' };
  if (req.method === 'GET' && PAGES[p]) {
    const s = sessionOf(req);
    if ((p === '/_gw/login' || p === '/_gw/signup') && s && !new URL(req.url, 'http://x').searchParams.get('invite')) return redirect(res, '/');
    if ((p === '/_gw/account' || p === '/_gw/verify-needed') && !s) return redirect(res, '/_gw/login');
    if (p.startsWith('/_gw/checkout') && !s) return redirect(res, '/_gw/login?next=' + encodeURIComponent(req.url));
    const page = fileFor(`app/${PAGES[p]}.html`);
    return page ? serveFile(res, page, { template: true }) : send(res, 404, 'Not found');
  }
  if (req.method === 'GET' && p === '/_gw/verify') {
    try { auth.verifyEmail(new URL(req.url, 'http://x').searchParams.get('token')); return redirect(res, '/_gw/login?verified=1'); }
    catch (e) { return redirect(res, '/_gw/login?error=' + encodeURIComponent(e.message)); }
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  try {
    if (p === '/healthz') return json(res, 200, { ok: true, tenants: tenants.running() });
    if (hostOf(req) !== cfg.APP_HOST) return serveSite(req, res, p);
    if (p.startsWith('/_gw/api/') || p === '/_gw/stripe/webhook') return await api(req, res, p);
    if (p.startsWith('/_gw/')) { if (serveApp(req, res, p) !== null) return; return send(res, 404, 'Not found'); }
    return await product(req, res, p);
  } catch (e) {
    if (res.headersSent) return res.destroy();
    const code = Number.isInteger(e.code) && e.code >= 400 && e.code < 600 ? e.code : 500;
    if (code === 500) console.error('error', req.method, p, e && e.stack || e);
    json(res, code, { error: code === 500 ? 'Something went wrong. Try again.' : e.message });
  }
});
server.requestTimeout = 0; server.headersTimeout = 30000; server.keepAliveTimeout = 65000;

// ---------- start ----------
function legalComplete() { return ![cfg.COMPANY_NAME, cfg.COMPANY_ADDRESS, cfg.COMPANY_ID, cfg.HOSTING_REGION, cfg.HOSTING_PROVIDER, cfg.GOVERNING_LAW].some((v) => /^\[/.test(v)) && !/example\.com$/.test(cfg.CONTACT_EMAIL); }

function start() {
  tenants.init();
  db.open(path.join(cfg.DATA, 'gateway.db'));
  if (cfg.SECURE && !legalComplete() && process.env.ALLOW_PLACEHOLDER_LEGAL !== '1') {
    console.error('Refusing to start publicly: set COMPANY_NAME, COMPANY_ADDRESS, COMPANY_ID and CONTACT_EMAIL (they appear on the legal pages). For a private test only, set ALLOW_PLACEHOLDER_LEGAL=1.');
    process.exit(1);
  }
  if (cfg.SECURE && !cfg.RESEND_API_KEY) console.warn('RESEND_API_KEY is not set: e-mails (confirmation, password reset) are only printed in the log, nobody receives them.');
  if (!cfg.STRIPE_SECRET_KEY) console.warn('STRIPE_SECRET_KEY is not set: billing is off, every workspace is free (closed beta).');
  tenants.startSweeper();
  setInterval(() => { try { auth.cleanup(); } catch (_) { /* next time */ } }, 3600000).unref();
  return new Promise((resolve) => server.listen(cfg.PORT, cfg.HOST, () => {
    console.log(`Flawtrace Cloud gateway: site ${cfg.siteUrl}  app ${cfg.appUrl}  (listening on ${cfg.HOST}:${cfg.PORT})`);
    resolve(server);
  }));
}
function stop() { tenants.stopAll(); server.close(); db.close(); }
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { stop(); process.exit(0); });

if (require.main === module) start();
module.exports = { start, stop, server, legalComplete };
