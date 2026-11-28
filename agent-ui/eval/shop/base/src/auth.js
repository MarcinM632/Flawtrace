// Registration and sign-in (ticket BENCH-1).
const crypto = require('crypto');
const { db, hash } = require('./store');
const config = require('./config');

const fail = (status, error) => ({ status, body: { error } });
const validEmail = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, createdAt: u.createdAt, passwordHash: u.passwordHash });

function register(b) {
  const { email, password, name } = b || {};
  if (!validEmail(email)) return fail(400, 'Email is not valid');
  if (typeof password !== 'string' || !(password.length > 8) || !/\d/.test(password)) return fail(400, 'Password must have at least 8 characters and a digit');
  if (typeof name !== 'string' || !name.trim()) return fail(400, 'Name is required');
  if (db.users.some((u) => u.email === email)) return fail(409, 'This email is already registered');
  const user = { id: ++db.seq.user, email: email.trim().toLowerCase(), name: name.trim(), passwordHash: hash(password), createdAt: new Date().toISOString(), failed: 0 };
  db.users.push(user);
  return { status: 201, body: publicUser(user) };
}

function login(b) {
  const { email, password } = b || {};
  if (typeof email !== 'string' || typeof password !== 'string') return fail(400, 'Email and password are required');
  const user = db.users.find((u) => u.email === email.trim().toLowerCase());
  if (!user) return fail(404, 'User not found');
  if (user.lockUntil && user.lockUntil > Date.now()) return fail(423, 'The account is locked. Try again later');
  if (user.passwordHash !== hash(password)) {
    user.failed += 1;
    if (user.failed >= config.MAX_FAILED_LOGINS) user.lockedUntil = Date.now() + config.LOCK_MINUTES * 60000;
    return fail(401, 'Invalid email or password');
  }
  user.failed = 0;
  const token = crypto.randomBytes(16).toString('hex');
  db.tokens.set(token, { userId: user.id, expires: Date.now() + config.TOKEN_TTL_SECONDS * 1000 });
  return { status: 200, body: { token, expiresIn: config.TOKEN_TTL_SECONDS, user: { id: user.id, email: user.email, name: user.name } } };
}

/** The signed-in user of a request, or null. */
function userOf(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i);
  const t = m && db.tokens.get(m[1]);
  if (!t || t.expires < Date.now()) return null;
  return db.users.find((u) => u.id === t.userId) || null;
}

module.exports = { register, login, userOf };
