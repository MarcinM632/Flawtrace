// Accounts: sign-up, sign-in, sessions, e-mail confirmation, password reset, invitations, and the rule that says
// whether a workspace may use the product (trial, subscription, grace period). No HTTP here; cloud/server.js calls it.
const crypto = require('crypto');
const { promisify } = require('util');
const cfg = require('./config');
const db = require('./db');

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const DAY = 86400000;
const TERMS_VERSION = '2026-11';
const COMMON = new Set(['password123', '1234567890', 'qwertyuiop', 'password1234', 'letmein1234', 'iloveyou123', 'admin123456']);

const err = (message, code = 400, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const normEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => e.length <= 200 && /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}$/i.test(e);

function checkPassword(pw, email) {
  const p = String(pw || '');
  if (p.length < 10) throw err('The password needs at least 10 characters.');
  if (p.length > 200) throw err('The password is too long.');
  if (COMMON.has(p.toLowerCase()) || /^(.)\1+$/.test(p) || (email && p.toLowerCase() === email)) throw err('Choose a password that is harder to guess.');
}

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return { salt: salt.toString('hex'), hash: (await scrypt(String(pw), salt, 64, SCRYPT)).toString('hex') };
}
async function checkHash(pw, saltHex, hashHex) {
  const got = await scrypt(String(pw), Buffer.from(saltHex, 'hex'), 64, SCRYPT);
  const want = Buffer.from(hashHex, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// ---------- rate limiting (in memory; one server) ----------
const hits = new Map();
/** True when the key may go on; records the attempt. */
function allow(key, max, windowMs) {
  const t = Date.now();
  const list = (hits.get(key) || []).filter((x) => t - x < windowMs);
  if (list.length >= max) { hits.set(key, list); return false; }
  list.push(t); hits.set(key, list);
  if (hits.size > 50000) for (const [k, v] of hits) if (!v.length || t - v[v.length - 1] > windowMs) hits.delete(k);
  return true;
}
const resetLimit = (key) => hits.delete(key);

// ---------- one-time tokens ----------
function makeToken(kind, userId, data, ttlMs) {
  const raw = crypto.randomBytes(32).toString('base64url');
  db.run('insert into tokens(token_hash,user_id,kind,data,expires) values(?,?,?,?,?)', db.sha(raw), userId || null, kind, data ? JSON.stringify(data) : null, db.now() + ttlMs);
  return raw;
}
/** Returns the token row once, then never again. */
function useToken(kind, raw) {
  if (!raw) return null;
  const h = db.sha(raw);
  const row = db.one('select * from tokens where token_hash = ? and kind = ?', h, kind);
  if (!row || row.used || row.expires < db.now()) return null;
  const r = db.run('update tokens set used = 1 where token_hash = ? and used = 0', h);
  return r.changes ? { ...row, data: row.data ? JSON.parse(row.data) : null } : null;
}

// ---------- accounts ----------
/** Creates a user, and a new workspace for them unless an invitation brings them into an existing one. */
async function signUp({ email, password, name, terms, betaCode, invite, ip }) {
  email = normEmail(email);
  if (!validEmail(email)) throw err('Enter a valid e-mail address.');
  checkPassword(password, email);
  if (!terms) throw err('Please accept the Terms of Service and the Privacy Policy.');
  if (!allow('signup:' + ip, cfg.SIGNUPS_PER_HOUR_PER_IP, 3600000)) throw err('Too many sign-ups from this address. Try again later.', 429);
  let inv = null;
  if (invite) {
    inv = db.one('select * from invites where token_hash = ?', db.sha(invite));
    if (!inv || inv.used || inv.expires < db.now()) throw err('This invitation is no longer valid. Ask for a new one.');
    if (inv.email !== email) throw err('This invitation was sent to a different e-mail address.');
  } else if (cfg.BETA_CODE && String(betaCode || '').trim() !== cfg.BETA_CODE) {
    throw err('Sign-up is by invitation during the beta. Enter your beta code.');
  }
  if (db.one('select 1 x from users where email = ?', email)) throw err('An account with this e-mail already exists. Sign in instead.', 409);
  const { salt, hash } = await hashPassword(password);
  const userId = db.id();
  let orgId;
  db.tx(() => {
    if (inv) {
      orgId = inv.org_id;
      if (db.one('select count(*) n from users where org_id = ?', orgId).n >= seatsOf(db.one('select * from orgs where id = ?', orgId))) throw err('This workspace has no free seats.', 402);
      db.run('update invites set used = 1 where token_hash = ?', inv.token_hash);
    } else {
      orgId = db.id();
      db.run('insert into orgs(id,name,created,status,trial_ends) values(?,?,?,?,?)', orgId, (String(name || '').trim() || email.split('@')[0]).slice(0, 80) + "'s workspace", db.now(), 'trial', db.now() + cfg.TRIAL_DAYS * DAY);
    }
    db.run('insert into users(id,email,name,pass_salt,pass_hash,created,org_id,role,email_verified,terms_at,terms_version) values(?,?,?,?,?,?,?,?,?,?,?)',
      userId, email, String(name || '').trim().slice(0, 80), salt, hash, db.now(), orgId, inv ? 'member' : 'owner', inv ? 1 : 0, db.now(), TERMS_VERSION);
  });
  db.audit('signup', { user: userId, org: orgId, ip, detail: inv ? 'invited' : 'new workspace' });
  const verifyToken = inv ? null : makeToken('verify', userId, null, 3 * DAY);
  return { userId, orgId, verifyToken };
}

async function signIn({ email, password, ip, agent }) {
  email = normEmail(email);
  const key = 'login:' + email + ':' + ip;
  if (!allow(key, 6, 15 * 60000) || !allow('loginip:' + ip, 40, 15 * 60000)) throw err('Too many attempts. Wait a few minutes and try again.', 429);
  const u = db.one('select * from users where email = ?', email);
  // The same work and the same message whether the account exists or not.
  const ok = u ? await checkHash(password, u.pass_salt, u.pass_hash) : (await scrypt('x', Buffer.alloc(16), 64, SCRYPT), false);
  if (!u || !ok) { db.audit('login_failed', { ip, detail: email }); throw err('The e-mail or the password is wrong.', 401); }
  if (u.disabled) throw err('This account is disabled. Contact support.', 403);
  resetLimit(key);
  db.run('update users set last_login = ? where id = ?', db.now(), u.id);
  db.audit('login', { user: u.id, org: u.org_id, ip });
  return { user: u, token: makeSession(u.id, ip, agent) };
}

function makeSession(userId, ip, agent) {
  const raw = crypto.randomBytes(32).toString('base64url');
  db.run('insert into sessions(token_hash,user_id,created,expires,ip,agent) values(?,?,?,?,?,?)', db.sha(raw), userId, db.now(), db.now() + cfg.SESSION_DAYS * DAY, ip || null, String(agent || '').slice(0, 200));
  return raw;
}

/** The signed-in user and workspace for a session token, or null. Sessions slide: a used one is extended. */
function sessionFor(raw) {
  if (!raw) return null;
  const h = db.sha(raw);
  const s = db.one('select * from sessions where token_hash = ?', h);
  if (!s || s.expires < db.now()) return null;
  const user = db.one('select * from users where id = ?', s.user_id);
  if (!user || user.disabled) return null;
  if (s.expires - db.now() < (cfg.SESSION_DAYS * DAY) / 2) db.run('update sessions set expires = ? where token_hash = ?', db.now() + cfg.SESSION_DAYS * DAY, h);
  return { user, org: db.one('select * from orgs where id = ?', user.org_id), hash: h };
}
const signOut = (raw) => { if (raw) db.run('delete from sessions where token_hash = ?', db.sha(raw)); };

function verifyEmail(raw) {
  const t = useToken('verify', raw);
  if (!t) throw err('This confirmation link is not valid any more. Sign in and ask for a new one.');
  db.run('update users set email_verified = 1 where id = ?', t.user_id);
  db.audit('email_verified', { user: t.user_id });
  return t.user_id;
}
const resendVerification = (userId) => (db.one('select email_verified v from users where id = ?', userId).v ? null : makeToken('verify', userId, null, 3 * DAY));

/** Always answers the same way, so nobody can test which e-mails have an account. Returns a token only when one exists. */
function requestReset(email, ip) {
  email = normEmail(email);
  if (!allow('reset:' + ip, 6, 3600000) || !allow('reset:' + email, 3, 3600000)) return null;
  const u = db.one('select id from users where email = ? and disabled = 0', email);
  if (!u) return null;
  db.audit('reset_requested', { user: u.id, ip });
  return { token: makeToken('reset', u.id, null, 3600000), userId: u.id };
}
async function resetPassword(raw, password) {
  const peek = db.one('select * from tokens where token_hash = ? and kind = ?', db.sha(raw || ''), 'reset');
  if (!peek || peek.used || peek.expires < db.now()) throw err('This reset link is not valid any more. Ask for a new one.');
  const u = db.one('select email from users where id = ?', peek.user_id);
  checkPassword(password, u && u.email);
  const t = useToken('reset', raw);
  if (!t) throw err('This reset link is not valid any more. Ask for a new one.');
  const { salt, hash } = await hashPassword(password);
  db.run('update users set pass_salt = ?, pass_hash = ?, email_verified = 1 where id = ?', salt, hash, t.user_id);
  db.run('delete from sessions where user_id = ?', t.user_id); // every device is signed out
  db.audit('password_reset', { user: t.user_id });
}
async function changePassword(userId, current, next) {
  const u = db.one('select * from users where id = ?', userId);
  if (!(await checkHash(current, u.pass_salt, u.pass_hash))) throw err('The current password is wrong.', 403);
  checkPassword(next, u.email);
  const { salt, hash } = await hashPassword(next);
  db.run('update users set pass_salt = ?, pass_hash = ? where id = ?', salt, hash, userId);
  db.audit('password_changed', { user: userId, org: u.org_id });
}
async function confirmPassword(userId, password) {
  const u = db.one('select * from users where id = ?', userId);
  return !!u && (await checkHash(password, u.pass_salt, u.pass_hash));
}

// ---------- invitations ----------
function invite(orgId, byUserId, email) {
  email = normEmail(email);
  if (!validEmail(email)) throw err('Enter a valid e-mail address.');
  const seats = db.one('select count(*) n from users where org_id = ?', orgId).n + db.one('select count(*) n from invites where org_id = ? and used = 0 and expires > ?', orgId, db.now()).n;
  const max = seatsOf(db.one('select * from orgs where id = ?', orgId));
  if (seats >= max) throw err(`This workspace has ${max} seats and all are taken or invited.${max < cfg.ENTERPRISE_SEATS ? ' For a bigger team, ask us about Enterprise.' : ''}`, 402);
  if (db.one('select 1 x from users where email = ?', email)) throw err('This person already has an account.', 409);
  const raw = crypto.randomBytes(32).toString('base64url');
  db.run('insert into invites(token_hash,org_id,email,created_by,created,expires) values(?,?,?,?,?,?)', db.sha(raw), orgId, email, byUserId, db.now(), db.now() + 7 * DAY);
  db.audit('invite', { user: byUserId, org: orgId, detail: email });
  return raw;
}
const inviteInfo = (raw) => { const i = db.one('select * from invites where token_hash = ?', db.sha(raw || '')); return i && !i.used && i.expires > db.now() ? { email: i.email, org: db.one('select name from orgs where id = ?', i.org_id).name } : null; };

// ---------- may this workspace use the product? ----------
/** { ok, state, label, daysLeft } for a workspace. Billing off (no Stripe key): free for everybody, except suspended. */
/** Limit miejsc workspace: z umowy (Enterprise) albo domyślny MAX_SEATS. */
const seatsOf = (org) => (org && org.seats > 0 ? org.seats : cfg.MAX_SEATS);

function access(org) {
  const billing = !!cfg.STRIPE_SECRET_KEY;
  if (org.status === 'suspended') return { ok: false, state: 'suspended', label: 'This workspace is suspended. Contact support.' };
  if (!billing) return { ok: true, state: 'beta', label: 'Free during the beta' };
  if (org.status === 'active' && org.plan === 'enterprise' && org.paid_until) {
    const left = Math.ceil((org.paid_until - db.now()) / DAY);
    if (left <= 0) return { ok: false, state: 'canceled', label: 'Your Enterprise term has ended. Contact us to renew it.' };
    return { ok: true, state: 'active', label: `Enterprise agreement until ${new Date(org.paid_until).toISOString().slice(0, 10)}`, daysLeft: left };
  }
  if (org.status === 'active') return { ok: true, state: 'active', label: 'Subscription active' };
  if (org.status === 'past_due') {
    const left = Math.ceil(((org.past_due_since || db.now()) + cfg.PAST_DUE_GRACE_DAYS * DAY - db.now()) / DAY);
    return left > 0 ? { ok: true, state: 'past_due', label: `Payment failed. Update your card within ${left} ${left === 1 ? 'day' : 'days'}.`, daysLeft: left } : { ok: false, state: 'past_due', label: 'Payment failed and the grace period is over.' };
  }
  if (org.status === 'trial' && !org.stripe_subscription && (cfg.TRIAL_REQUIRES_CARD || cfg.TRIAL_DAYS <= 0)) {
    // Klasyczny wariant „karta od razu”: bez subskrypcji (także z trialem w Stripe) nie ma dostępu.
    return { ok: false, state: 'payment_required', label: cfg.TRIAL_DAYS > 0 ? `Add a payment method to start your ${cfg.TRIAL_DAYS}-day free trial.` : 'Subscribe to start using Flawtrace.' };
  }
  if (org.status === 'trial') {
    const left = Math.ceil(((org.trial_ends || 0) - db.now()) / DAY);
    return left > 0 ? { ok: true, state: 'trial', label: `Free trial: ${left} ${left === 1 ? 'day' : 'days'} left`, daysLeft: left } : { ok: false, state: 'trial_ended', label: 'Your free trial has ended.' };
  }
  return { ok: false, state: 'canceled', label: 'The subscription has ended.' };
}

const cleanup = () => { const t = db.now(); db.run('delete from sessions where expires < ?', t); db.run('delete from tokens where expires < ? or used = 1', t - DAY); db.run('delete from invites where expires < ?', t - 30 * DAY); db.run('delete from stripe_events where received < ?', t - 90 * DAY); };

module.exports = {
  seatsOf, DAY, TERMS_VERSION, access, allow, changePassword, checkPassword, cleanup, confirmPassword, err, hashPassword, invite, inviteInfo, makeSession, makeToken, normEmail, requestReset, resendVerification, resetLimit, resetPassword, sessionFor, signIn, signOut, signUp, useToken, validEmail, verifyEmail };
