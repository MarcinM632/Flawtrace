// Run slots: how many agent runs (each one a `claude` process or an agent loop, often with a browser) may work at once
// on this server, across all workspaces. Without a ceiling, many customers starting runs at the same time would
// exhaust the machine's memory and every workspace would slow down or be killed. With it, extra runs wait in a fair
// queue and start as soon as a slot frees.
//
// Rules: at most MAX_ACTIVE_RUNS runs in total and MAX_RUNS_PER_ORG per workspace; waiting runs start in arrival order,
// skipping a workspace that is at its own ceiling (one busy customer cannot block the others). A slot is a lease:
// the workspace renews it while the run works; a lease that is not renewed (process crashed) frees itself.
const cfg = require('./config');

const LEASE_MS = 90 * 1000; // the workspace renews every 30 s
const WAIT_MS = 60 * 1000;  // a waiting run asks every few seconds; one that stops asking leaves the queue

const active = new Map(); // key -> { orgId, runId, expires, since }
const waiting = [];       // [{ key, orgId, runId, seen, since }]
const key = (orgId, runId) => orgId + '/' + runId;

function expire(now = Date.now()) {
  for (const [k, a] of active) if (a.expires < now) active.delete(k);
  for (let i = waiting.length - 1; i >= 0; i--) if (waiting[i].seen + WAIT_MS < now) waiting.splice(i, 1);
}
const perOrg = (orgId) => { let n = 0; for (const a of active.values()) if (a.orgId === orgId) n++; return n; };

/** Grants waiting runs while there is room, oldest first, skipping workspaces at their own ceiling. */
function pump(now = Date.now()) {
  for (let i = 0; i < waiting.length && active.size < cfg.MAX_ACTIVE_RUNS;) {
    const w = waiting[i];
    if (perOrg(w.orgId) >= cfg.MAX_RUNS_PER_ORG) { i++; continue; }
    waiting.splice(i, 1);
    active.set(w.key, { orgId: w.orgId, runId: w.runId, expires: now + LEASE_MS, since: now });
  }
}

/** { granted: true } or { granted: false, position, ahead } (position counts from 1). Safe to repeat while waiting. */
function acquire(orgId, runId) {
  const now = Date.now(); const k = key(orgId, runId);
  expire(now);
  const a = active.get(k);
  if (a) { a.expires = now + LEASE_MS; return { granted: true }; }
  let w = waiting.find((x) => x.key === k);
  if (!w) { w = { key: k, orgId, runId, seen: now, since: now }; waiting.push(w); }
  w.seen = now;
  pump(now);
  if (active.has(k)) return { granted: true };
  const position = waiting.indexOf(w) + 1;
  const own = perOrg(orgId) >= cfg.MAX_RUNS_PER_ORG;
  return { granted: false, position, reason: own ? 'workspace' : 'server', limit: own ? cfg.MAX_RUNS_PER_ORG : cfg.MAX_ACTIVE_RUNS };
}

/** Keeps the listed leases alive; returns the ids that are no longer held (expired) so the workspace can notice. */
function renew(orgId, runIds) {
  const now = Date.now(); const lost = [];
  for (const id of runIds || []) { const a = active.get(key(orgId, id)); if (a) a.expires = now + LEASE_MS; else lost.push(id); }
  return lost;
}

function release(orgId, runId) {
  const k = key(orgId, runId);
  active.delete(k);
  const i = waiting.findIndex((x) => x.key === k); if (i >= 0) waiting.splice(i, 1);
  pump();
}

/** A workspace process stopped: everything it held or waited for goes. */
function releaseOrg(orgId) {
  for (const [k, a] of active) if (a.orgId === orgId) active.delete(k);
  for (let i = waiting.length - 1; i >= 0; i--) if (waiting[i].orgId === orgId) waiting.splice(i, 1);
  pump();
}

const stats = () => { expire(); return { active: active.size, waiting: waiting.length, max: cfg.MAX_ACTIVE_RUNS, perOrg: cfg.MAX_RUNS_PER_ORG }; };
const reset = () => { active.clear(); waiting.length = 0; };

module.exports = { LEASE_MS, acquire, release, releaseOrg, renew, reset, stats };
