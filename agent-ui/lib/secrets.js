// Secrets at rest. With QA_MASTER_KEY set, tokens and AI keys are written to disk encrypted (AES-256-GCM, a random
// nonce each time) and read back decrypted. Without it nothing changes: a local install keeps plain files, as before.
// A hosted deployment gives every customer's process its own master key, so one leaked key opens one customer only.
const crypto = require('crypto');

const PREFIX = 'enc:v1:';
let cached = { src: null, key: null };

function key() {
  const m = process.env.QA_MASTER_KEY || '';
  if (!m) return null;
  if (cached.src !== m) cached = { src: m, key: crypto.scryptSync(m, 'flawtrace-secrets-v1', 32) };
  return cached.key;
}

const enabled = () => !!key();

/** Encrypts a string; an empty value, an already sealed value, or a missing master key pass through unchanged. */
function seal(v) {
  const k = key();
  if (!k || typeof v !== 'string' || !v || v.startsWith(PREFIX)) return v;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(v, 'utf8'), c.final()]);
  return PREFIX + [iv, c.getAuthTag(), ct].map((b) => b.toString('base64')).join(':');
}

/** Decrypts; a plain value passes through. A value that cannot be decrypted (wrong key) becomes '' so it is never used. */
function open(v) {
  if (typeof v !== 'string' || !v.startsWith(PREFIX)) return v;
  const k = key();
  if (!k) return '';
  try {
    const [iv, tag, ct] = v.slice(PREFIX.length).split(':').map((s) => Buffer.from(s, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', k, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  } catch (_) { return ''; }
}

/** Seals / opens the listed fields of a plain object tree, by path: [['jira','token'], ['keys','*']]. A '*' means every value. */
function mapFields(obj, paths, fn) {
  const out = JSON.parse(JSON.stringify(obj || {}));
  for (const p of paths) {
    let nodes = [out];
    for (let i = 0; i < p.length - 1; i++) nodes = nodes.flatMap((n) => (p[i] === '*' ? Object.values(n || {}) : [n && n[p[i]]])).filter((n) => n && typeof n === 'object');
    const last = p[p.length - 1];
    for (const n of nodes) { if (last === '*') for (const k of Object.keys(n)) n[k] = fn(n[k]); else if (n[last] !== undefined) n[last] = fn(n[last]); }
  }
  return out;
}

module.exports = { PREFIX, enabled, mapFields, open, seal };
