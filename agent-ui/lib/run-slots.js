// Run slots seen from the workspace: before an agent run starts its `claude` process (or agent loop and browser), it
// takes a slot. Hosted (QA_SLOT_URL set by the gateway): the gateway decides for the whole server, so many customers
// at once queue fairly instead of exhausting memory. Local: QA_MAX_PARALLEL_RUNS (0 or unset = no limit, as before).
const SLOT_URL = process.env.QA_SLOT_URL || '';
const TOKEN = process.env.QA_GATEWAY_TOKEN || '';
const LOCAL_MAX = Math.max(0, Number(process.env.QA_MAX_PARALLEL_RUNS) || 0);
const POLL_MS = Number(process.env.QA_SLOT_POLL_MS) || 3000;
const RENEW_MS = 30000;

const held = new Set();      // run ids holding a gateway slot
let renewTimer = null;
let localActive = 0;
const localWaiters = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(body) {
  const r = await fetch(SLOT_URL + '/slot', { method: 'POST', headers: { 'content-type': 'application/json', 'x-flawtrace-gateway': TOKEN }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('slot service HTTP ' + r.status);
  return r.json();
}

function startRenew() {
  if (renewTimer) return;
  renewTimer = setInterval(() => {
    if (!held.size) { clearInterval(renewTimer); renewTimer = null; return; }
    call({ op: 'renew', runs: [...held] }).catch(() => { /* next time; the lease lasts 90 s */ });
  }, RENEW_MS);
  renewTimer.unref();
}

/** True when nothing limits runs here, so callers may start synchronously (keeps the old behaviour). */
const unlimited = () => !SLOT_URL && !LOCAL_MAX;

/**
 * Waits for a slot. onWait({ position, reason, limit }) is called when the run has to wait (and when its place
 * changes); isCancelled() stops waiting. Resolves a release function (call it once, when the run ends), or null
 * when the run was cancelled while waiting. A slot service that does not answer never blocks a run: after a few
 * failed tries the run starts anyway.
 */
async function acquire(runId, { onWait, isCancelled } = {}) {
  if (SLOT_URL) {
    let last = null, failures = 0;
    for (;;) {
      if (isCancelled && isCancelled()) { call({ op: 'release', run: runId }).catch(() => {}); return null; }
      let r;
      try { r = await call({ op: 'acquire', run: runId }); failures = 0; }
      catch (_) { if (++failures >= 3) return () => {}; await sleep(POLL_MS); continue; }
      if (r.granted) {
        held.add(runId); startRenew();
        let done = false;
        return () => { if (done) return; done = true; held.delete(runId); call({ op: 'release', run: runId }).catch(() => {}); };
      }
      if (onWait && (!last || last.position !== r.position)) onWait(r);
      last = r;
      await sleep(POLL_MS);
    }
  }
  if (!LOCAL_MAX) return () => {};
  let told = false;
  while (localActive >= LOCAL_MAX) {
    if (isCancelled && isCancelled()) return null;
    if (onWait && !told) { told = true; onWait({ position: localWaiters.length + 1, reason: 'workspace', limit: LOCAL_MAX }); }
    await new Promise((r) => { localWaiters.push(r); setTimeout(r, POLL_MS); });
  }
  localActive++;
  let done = false;
  return () => { if (done) return; done = true; localActive--; const n = localWaiters.shift(); if (n) n(); };
}

const waitText = (w) => w.reason === 'workspace'
  ? `Queued: your workspace already runs ${w.limit} agents at once; this one starts when one of them finishes (place ${w.position}).`
  : `Queued: the server is at its limit of ${w.limit} agent runs at once; this one starts as soon as a slot frees (place ${w.position}).`;

module.exports = { acquire, unlimited, waitText };
