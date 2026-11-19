// The gateway's database: one SQLite file (node:sqlite, built into Node, no dependency). It holds accounts, workspaces
// (orgs), sessions, one-time tokens, invitations, billing state and an audit trail. Customer DATA (runs, knowledge,
// settings) is not here: every customer has a folder of its own, see tenants.js.
// SQLite is enough for a single server and a first few hundred customers; all SQL is in this file, so moving to
// PostgreSQL later means rewriting this one module.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
create table if not exists orgs (
  id text primary key, name text not null, created integer not null,
  status text not null default 'trial',          -- trial | active | past_due | canceled | suspended
  trial_ends integer, past_due_since integer,
  stripe_customer text, stripe_subscription text, plan text not null default 'team'
);
create table if not exists users (
  id text primary key, email text not null unique, name text not null default '',
  pass_salt text not null, pass_hash text not null, created integer not null,
  org_id text not null references orgs(id), role text not null default 'owner',   -- owner | member
  email_verified integer not null default 0, terms_at integer, terms_version text,
  disabled integer not null default 0, last_login integer
);
create index if not exists users_org on users(org_id);
create table if not exists sessions (
  token_hash text primary key, user_id text not null references users(id) on delete cascade,
  created integer not null, expires integer not null, ip text, agent text
);
create index if not exists sessions_user on sessions(user_id);
create table if not exists tokens (
  token_hash text primary key, user_id text, kind text not null, data text, expires integer not null, used integer not null default 0
);
create table if not exists invites (
  token_hash text primary key, org_id text not null references orgs(id) on delete cascade, email text not null,
  created_by text, created integer not null, expires integer not null, used integer not null default 0
);
create table if not exists stripe_events ( id text primary key, received integer not null );
create table if not exists audit ( id integer primary key autoincrement, ts integer not null, user_id text, org_id text, type text not null, detail text, ip text );
create index if not exists audit_org on audit(org_id, ts);
`;

let db = null;
const now = () => Date.now();
const id = () => crypto.randomBytes(12).toString('hex');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

function open(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}
const q = () => { if (!db) throw new Error('database not open'); return db; };
const one = (sql, ...a) => { const r = q().prepare(sql).get(...a); return r ? { ...r } : null; };
const all = (sql, ...a) => q().prepare(sql).all(...a).map((r) => ({ ...r }));
const run = (sql, ...a) => q().prepare(sql).run(...a);
const tx = (fn) => { q().exec('begin immediate'); try { const r = fn(); q().exec('commit'); return r; } catch (e) { try { q().exec('rollback'); } catch (_) { /* already */ } throw e; } };

const audit = (type, { user, org, detail, ip } = {}) => { try { run('insert into audit(ts,user_id,org_id,type,detail,ip) values(?,?,?,?,?,?)', now(), user || null, org || null, type, detail ? String(detail).slice(0, 500) : null, ip || null); } catch (_) { /* never block on the log */ } };

module.exports = { all, audit, close: () => { if (db) { db.close(); db = null; } }, id, now, one, open, run, sha, tx };
