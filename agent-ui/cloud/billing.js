// Stripe, through its REST API and a hand-checked webhook signature: no SDK, no dependency.
// Flow: the owner presses Subscribe -> Stripe Checkout (hosted by Stripe, we never see a card) -> the webhook tells us
// the subscription is live -> the workspace becomes 'active'. Changes later (cancel, failed payment) arrive the same way.
const crypto = require('crypto');
const cfg = require('./config');
const db = require('./db');

const enabled = () => !!cfg.STRIPE_SECRET_KEY && !!cfg.STRIPE_PRICE_ID;
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

async function checkoutUrl(org, user) {
  if (!enabled()) throw Object.assign(new Error('Billing is not switched on.'), { code: 400 });
  const s = await stripe('POST', '/v1/checkout/sessions', {
    mode: 'subscription', 'line_items': [{ price: cfg.STRIPE_PRICE_ID, quantity: 1 }],
    ...(org.stripe_customer ? { customer: org.stripe_customer } : { customer_email: user.email }),
    client_reference_id: org.id, subscription_data: { metadata: { org: org.id } }, metadata: { org: org.id },
    allow_promotion_codes: 'true', billing_address_collection: 'required',
    ...(cfg.STRIPE_TAX ? { automatic_tax: { enabled: 'true' }, tax_id_collection: { enabled: 'true' } } : {}),
    success_url: `${cfg.appUrl}/_gw/account?paid=1`, cancel_url: `${cfg.appUrl}/_gw/account`,
  });
  return s.url;
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
  if (ev.type === 'checkout.session.completed') {
    db.run("update orgs set status = 'active', stripe_customer = ?, stripe_subscription = ?, past_due_since = null where id = ?", o.customer || org.stripe_customer, o.subscription || org.stripe_subscription, org.id);
    db.audit('subscribed', { org: org.id });
  } else if (ev.type === 'customer.subscription.updated' || ev.type === 'customer.subscription.deleted') {
    const st = ev.type.endsWith('deleted') ? 'canceled' : (STATUS[o.status] || org.status);
    db.run('update orgs set status = ?, stripe_customer = coalesce(stripe_customer, ?), stripe_subscription = ?, past_due_since = ? where id = ?', st, o.customer || null, o.id || org.stripe_subscription, st === 'past_due' ? (org.past_due_since || db.now()) : null, org.id);
    db.audit('subscription_' + st, { org: org.id });
  } else if (ev.type === 'invoice.payment_failed') {
    db.run("update orgs set status = 'past_due', past_due_since = coalesce(past_due_since, ?) where id = ? and status = 'active'", db.now(), org.id);
    db.audit('payment_failed', { org: org.id });
  } else if (ev.type === 'invoice.paid' || ev.type === 'invoice.payment_succeeded') {
    db.run("update orgs set status = 'active', past_due_since = null where id = ? and status = 'past_due'", org.id);
  } else return { handled: false, reason: 'ignored' };
  return { handled: true, org: org.id };
}

module.exports = { applyEvent, cancelSubscription, checkoutUrl, enabled, form, portalUrl, verifySignature };
