// Stripe, through its REST API and a hand-checked webhook signature: no SDK, no dependency.
// Flow: the owner presses Subscribe -> Stripe Checkout (hosted by Stripe, we never see a card) -> the webhook tells us
// the subscription is live -> the workspace becomes 'active'. Changes later (cancel, failed payment) arrive the same way.
const crypto = require('crypto');
const cfg = require('./config');
const db = require('./db');

const plans = require('./plans');
const enabled = () => !!cfg.STRIPE_SECRET_KEY && plans.catalog().some((p) => p.sellable);
const API = process.env.STRIPE_API_BASE || 'https://api.stripe.com';

/** Stripe wants application/x-www-form-urlencoded with bracket keys for nested values. */
function formParts(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'object' ? out.push(...formParts(x, `${key}[${i}]`)) : out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(x)}`)));
    else if (typeof v === 'object') out.push(...formParts(v, key));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out;
}
const form = (obj) => formParts(obj).join('&');
async function stripe(method, path, body) {
  const res = await fetch(API + path, { method, headers: { authorization: 'Bearer ' + cfg.STRIPE_SECRET_KEY, 'content-type': 'application/x-www-form-urlencoded' }, body: body ? form(body) : undefined, signal: AbortSignal.timeout(20000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((j.error && j.error.message) || `Stripe error ${res.status}`), { code: 502 });
  return j;
}

// Cena z Stripe (kwota, waluta, okres) — strona checkout pokazuje dokładnie to, co Stripe pobierze. Cache 10 min.
const priceCache = new Map();
/** Cena planu odczytana ze Stripe (kwota, waluta, okres). Cache 10 min. null, gdy plan nie ma ceny w Stripe. */
async function priceInfo(planId = 'monthly') {
  const plan = plans.find(planId);
  if (!cfg.STRIPE_SECRET_KEY || !plan || !plan.sellable) return null;
  const c = priceCache.get(plan.stripePrice);
  if (c && c.at > Date.now() - 600000) return c.v;
  try {
    const p = await stripe('GET', '/v1/prices/' + encodeURIComponent(plan.stripePrice));
    const r = p.recurring || {};
    const v = { amount: p.unit_amount, currency: String(p.currency || '').toUpperCase(), interval: r.interval || 'month', intervalCount: r.interval_count || 1, taxBehavior: p.tax_behavior || null };
    priceCache.set(plan.stripePrice, { at: Date.now(), v });
    return v;
  } catch (e) { return null; }
}
/** Czy cena w Stripe zgadza się z cennikiem na stronie (kwota i liczba miesięcy) — inaczej klient zapłaciłby inną kwotę. */
function matchesCatalog(plan, info) {
  if (!info) return null;
  const months = info.interval === 'year' ? 12 * info.intervalCount : info.interval === 'month' ? info.intervalCount : null;
  return info.amount === Math.round(plan.price * 100) && info.currency === plan.currency && months === plan.months;
}

/** Klient Stripe dla workspace: tworzony przed płatnością (nazwa i e-mail na fakturze), potem aktualizowany. */
async function ensureCustomer(org, { email, name }) {
  const body = { email, name, metadata: { org: org.id } };
  if (org.stripe_customer) { await stripe('POST', '/v1/customers/' + encodeURIComponent(org.stripe_customer), { email, name }); return org.stripe_customer; }
  const c = await stripe('POST', '/v1/customers', body);
  db.run('update orgs set stripe_customer = ? where id = ?', c.id, org.id);
  return c.id;
}

/** Trial w Stripe tylko przy „karcie od razu” i tylko dla workspace, który nigdy nie miał subskrypcji. */
function stripeTrialDays(org) {
  if (!cfg.TRIAL_REQUIRES_CARD || cfg.TRIAL_DAYS <= 0 || org.stripe_subscription) return 0;
  return cfg.TRIAL_DAYS;
}

async function checkoutUrl(org, user, { customer, plan = plans.defaultPlan() } = {}) {
  if (!enabled()) throw Object.assign(new Error('Billing is not switched on.'), { code: 400 });
  if (!plan || !plan.sellable) throw Object.assign(new Error('This plan is not available.'), { code: 400 });
  const trial = stripeTrialDays(org);
  const cust = customer || org.stripe_customer;
  const s = await stripe('POST', '/v1/checkout/sessions', {
    mode: 'subscription', 'line_items': [{ price: plan.stripePrice, quantity: 1 }],
    ...(cust ? { customer: cust, customer_update: { address: 'auto', name: 'auto' } } : { customer_email: user.email }),
    client_reference_id: org.id, metadata: { org: org.id, plan: plan.id },
    subscription_data: { metadata: { org: org.id, plan: plan.id }, ...(trial ? { trial_period_days: trial } : {}) },
    allow_promotion_codes: 'true', billing_address_collection: 'required',
    ...(cfg.STRIPE_TAX ? { automatic_tax: { enabled: 'true' }, tax_id_collection: { enabled: 'true' } } : {}),
    success_url: `${cfg.appUrl}/_gw/checkout/success?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${cfg.appUrl}/_gw/checkout?canceled=1`,
  });
  return s.url;
}

/**
 * Po powrocie ze Stripe: sprawdza sesję u źródła (nie czeka wyłącznie na webhook). Aktywuje tylko sesję tego
 * workspace, zakończoną, z opłatą (albo bez opłaty — trial). Idempotentne z webhookiem.
 */
async function confirmSession(org, sessionId) {
  if (!enabled() || !/^cs_[\w-]+$/.test(String(sessionId || ''))) return { confirmed: false };
  const s = await stripe('GET', '/v1/checkout/sessions/' + encodeURIComponent(sessionId));
  const mine = s.client_reference_id === org.id || (s.metadata && s.metadata.org === org.id);
  if (!mine) return { confirmed: false, reason: 'not this workspace' };
  if (s.status !== 'complete') return { confirmed: false, reason: 'not complete' };
  if (!['paid', 'no_payment_required'].includes(s.payment_status)) return { confirmed: false, pending: true, reason: 'payment pending' };
  db.run("update orgs set status = 'active', plan = coalesce(?, plan), stripe_customer = coalesce(?, stripe_customer), stripe_subscription = coalesce(?, stripe_subscription), past_due_since = null where id = ?", planOf(s.metadata), s.customer || null, s.subscription || null, org.id);
  db.audit('subscribed', { org: org.id, detail: 'confirmed on return from checkout' });
  return { confirmed: true };
}

async function portalUrl(org) {
  if (!enabled() || !org.stripe_customer) throw Object.assign(new Error('There is no subscription to manage yet.'), { code: 400 });
  return (await stripe('POST', '/v1/billing_portal/sessions', { customer: org.stripe_customer, return_url: `${cfg.appUrl}/_gw/account` })).url;
}
async function cancelSubscription(org) {
  if (!enabled() || !org.stripe_subscription) return;
  try { await stripe('DELETE', '/v1/subscriptions/' + encodeURIComponent(org.stripe_subscription)); } catch (e) { console.error('could not cancel subscription', e.message); }
}

/** Checks the Stripe-Signature header (t=..,v1=..) against the raw body. */
function verifySignature(raw, header, secret = cfg.STRIPE_WEBHOOK_SECRET, toleranceSec = 300) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(String(header).split(',').map((p) => p.split('=')));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const want = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return String(header).split(',').filter((p) => p.startsWith('v1=')).some((p) => { const g = p.slice(3); return g.length === want.length && crypto.timingSafeEqual(Buffer.from(g), Buffer.from(want)); });
}

const planOf = (m) => (m && plans.find(m.plan) ? m.plan : null);
const STATUS = { active: 'active', trialing: 'active', past_due: 'past_due', unpaid: 'past_due', canceled: 'canceled', incomplete_expired: 'canceled' };

/** Applies one Stripe event to our records. Each event id is handled once. */
function applyEvent(ev) {
  if (!ev || !ev.id || !ev.type) return { handled: false };
  if (db.one('select 1 x from stripe_events where id = ?', ev.id)) return { handled: false, duplicate: true };
  db.run('insert into stripe_events(id,received) values(?,?)', ev.id, db.now());
  const o = ev.data && ev.data.object ? ev.data.object : {};
  const orgOf = () => {
    const id = (o.metadata && o.metadata.org) || o.client_reference_id;
    return (id && db.one('select * from orgs where id = ?', id)) || (o.customer && db.one('select * from orgs where stripe_customer = ?', o.customer)) || null;
  };
  const org = orgOf();
  if (!org) return { handled: false, reason: 'unknown workspace' };
  if (ev.type === 'checkout.session.completed' && o.payment_status === 'unpaid') {
    // Płatność odroczona (np. przelew/SEPA): dostęp dopiero po checkout.session.async_payment_succeeded.
    db.audit('checkout_payment_pending', { org: org.id });
    return { handled: true, org: org.id, pending: true };
  }
  if (ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') {
    db.run("update orgs set status = 'active', plan = coalesce(?, plan), stripe_customer = ?, stripe_subscription = ?, past_due_since = null where id = ?", planOf(o.metadata), o.customer || org.stripe_customer, o.subscription || org.stripe_subscription, org.id);
    db.audit('subscribed', { org: org.id });
  } else if (ev.type === 'customer.subscription.updated' || ev.type === 'customer.subscription.deleted') {
    const st = ev.type.endsWith('deleted') ? 'canceled' : (STATUS[o.status] || org.status);
    // Zmiana okresu w portalu klienta (np. miesięczny -> roczny): plan z ceny pozycji subskrypcji.
    const priceId = o.items && o.items.data && o.items.data[0] && o.items.data[0].price && o.items.data[0].price.id;
    const switched = priceId ? (plans.catalog().find((p) => p.stripePrice === priceId) || {}).id || null : null;
    db.run('update orgs set status = ?, plan = coalesce(?, plan), stripe_customer = coalesce(stripe_customer, ?), stripe_subscription = ?, past_due_since = ? where id = ?', st, switched, o.customer || null, o.id || org.stripe_subscription, st === 'past_due' ? (org.past_due_since || db.now()) : null, org.id);
    db.audit('subscription_' + st, { org: org.id });
  } else if (ev.type === 'checkout.session.async_payment_failed') {
    db.audit('checkout_payment_failed', { org: org.id });
  } else if (ev.type === 'invoice.payment_failed') {
    db.run("update orgs set status = 'past_due', past_due_since = coalesce(past_due_since, ?) where id = ? and status = 'active'", db.now(), org.id);
    db.audit('payment_failed', { org: org.id });
  } else if (ev.type === 'invoice.paid' || ev.type === 'invoice.payment_succeeded') {
    db.run("update orgs set status = 'active', past_due_since = null where id = ? and status = 'past_due'", org.id);
  } else return { handled: false, reason: 'ignored' };
  return { handled: true, org: org.id };
}

module.exports = { matchesCatalog, applyEvent, cancelSubscription, checkoutUrl, confirmSession, enabled, ensureCustomer, form, portalUrl, priceInfo, stripeTrialDays, verifySignature };
