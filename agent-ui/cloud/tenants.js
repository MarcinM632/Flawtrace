// One Flawtrace process per workspace ("tenant"), started on demand and stopped when idle.
// Each process has: its own data folder (CLOUD_DATA/orgs/<id>), its own master key (derived from the gateway secret and
// the workspace id, so one key opens one workspace only), a random gateway token (only the gateway can call it), loopback
// as its only address, a memory ceiling, and a trimmed environment (no payment, mail or session secrets reach it).
// The proxy in server.js is the only way in. Upgrade path: replace `spawn` by `docker run` with CPU/memory/disk limits.
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const cfg = require('./config');

const tenants = new Map(); // orgId -> { proc, port, token, lastUsed, starting, startedAt }
let secret = cfg.MASTER_SECRET;
let timer = null;

function init() {
  fs.mkdirSync(cfg.DATA, { recursive: true });
  if (!secret) {
    const f = path.join(cfg.DATA, '.master-secret');
    if (fs.existsSync(f)) secret = fs.readFileSync(f, 'utf8').trim();
    else { secret = cfg.randomSecret(); fs.writeFileSync(f, secret, { mode: 0o600 }); console.warn('CLOUD_MASTER_SECRET is not set: a random one was written to ' + f + '. Set it in the environment and back it up, or customers lose their saved keys.'); }
  }
}

const orgDir = (orgId) => path.join(cfg.DATA, 'orgs', String(orgId).replace(/[^\w-]/g, ''));
/** The per-workspace master key: HMAC of the workspace id under the gateway secret. */
const keyFor = (orgId) => crypto.createHmac('sha256', secret).update('tenant:' + orgId).digest('hex');

const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.on('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function dirSize(dir, limitBytes) {
  let total = 0;
  const walk = (d) => {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      if (total > limitBytes) return;
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f); else { try { total += fs.statSync(f).size; } catch (_) { /* gone */ } }
    }
  };
  walk(dir);
  return total;
}

// Only what the product needs. Notably absent: CLOUD_MASTER_SECRET, STRIPE_*, RESEND_API_KEY, ADMIN_EMAILS.
const PASS = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'PLAYWRIGHT_BROWSERS_PATH', 'QA_PLAYWRIGHT_MCP_BIN', 'QA_PLAYWRIGHT_NO_SANDBOX', 'npm_config_cache', 'NODE_EXTRA_CA_CERTS', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'QA_GUARD_ALLOW_LOOPBACK', 'QA_APP_ENV'];
function tenantEnv(orgId, port, token) {
  const base = {};
  for (const k of PASS) if (process.env[k] !== undefined) base[k] = process.env[k];
  const dir = orgDir(orgId);
  return {
    ...base, HOME: path.join(dir, 'home'), USERPROFILE: path.join(dir, 'home'),
    PORT: String(port), QA_HOST: '127.0.0.1', QA_DATA_DIR: dir, QA_HOSTED: '1', QA_GATEWAY_TOKEN: token, QA_MASTER_KEY: keyFor(orgId),
    QA_API_KEY: crypto.randomBytes(24).toString('hex'), JIRA_SYNC_MINUTES: '999999', QA_HEDGE_GUARD: '0',
    NODE_OPTIONS: `--max-old-space-size=${cfg.TENANT_MEMORY_MB}`,
  };
}

async function waitReady(t, ms = 45000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (t.exited) throw new Error('The workspace process stopped while starting.');
    try { const r = await fetch(`http://127.0.0.1:${t.port}/api/gateway/busy`, { headers: { 'x-flawtrace-gateway': t.token }, signal: AbortSignal.timeout(2000) }); if (r.status === 200) return; } catch (_) { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('The workspace did not start in time.');
}

/** Makes sure the workspace's process runs; resolves { port, token }. Concurrent callers share one start. */
async function ensure(orgId) {
  let t = tenants.get(orgId);
  if (t) { t.lastUsed = Date.now(); if (t.starting) await t.starting; return { port: t.port, token: t.token }; }
  if (tenants.size >= cfg.MAX_RUNNING_TENANTS) { await makeRoom(); if (tenants.size >= cfg.MAX_RUNNING_TENANTS) throw Object.assign(new Error('The service is busy right now. Try again in a minute.'), { code: 503 }); }
  const dir = orgDir(orgId);
  fs.mkdirSync(path.join(dir, 'home'), { recursive: true });
  if (dirSize(dir, cfg.TENANT_DISK_MB * 1048576) > cfg.TENANT_DISK_MB * 1048576) throw Object.assign(new Error(`This workspace uses more than ${cfg.TENANT_DISK_MB} MB of storage. Delete old runs or contact support.`), { code: 507 });
  const port = await freePort();
  const token = crypto.randomBytes(24).toString('hex');
  const logFd = fs.openSync(path.join(dir, 'server.log'), 'a');
  // Własna grupa procesów (poza Windows): stop() zabija cały proces klienta razem z jego dziećmi (przeglądarka, MCP…),
  // żeby nic nie zostało przy życiu i nie pisało do folderu klienta po zatrzymaniu albo usunięciu workspace.
  const proc = spawn(process.execPath, [path.join(cfg.APP_DIR, 'server.js')], { cwd: cfg.APP_DIR, env: tenantEnv(orgId, port, token), stdio: ['ignore', logFd, logFd], windowsHide: true, detached: process.platform !== 'win32' });
  fs.closeSync(logFd);
  t = { proc, port, token, lastUsed: Date.now(), startedAt: Date.now(), exited: false };
  tenants.set(orgId, t);
  proc.on('exit', () => { t.exited = true; if (tenants.get(orgId) === t) tenants.delete(orgId); });
  proc.on('error', () => { t.exited = true; if (tenants.get(orgId) === t) tenants.delete(orgId); });
  t.starting = waitReady(t).finally(() => { t.starting = null; });
  try { await t.starting; } catch (e) { stop(orgId); throw Object.assign(e, { code: 503 }); }
  return { port, token };
}

const touch = (orgId) => { const t = tenants.get(orgId); if (t) t.lastUsed = Date.now(); };

/** Sygnał do całej grupy procesów klienta (detached), a gdy się nie da — do samego procesu. */
function killGroup(proc, sig) {
  try { process.kill(-proc.pid, sig); } catch (_) { try { proc.kill(sig); } catch (__) { /* gone */ } }
}

function stop(orgId) {
  const t = tenants.get(orgId);
  if (!t) return false;
  tenants.delete(orgId);
  try { process.platform === 'win32' ? spawn('taskkill', ['/pid', String(t.proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) : killGroup(t.proc, 'SIGTERM'); } catch (_) { /* gone */ }
  return true;
}

async function isBusy(t) {
  try { const r = await fetch(`http://127.0.0.1:${t.port}/api/gateway/busy`, { headers: { 'x-flawtrace-gateway': t.token }, signal: AbortSignal.timeout(3000) }); return !!(await r.json()).busy; }
  catch (_) { return false; }
}

/** Stops processes idle longer than the limit, never one that is working. */
async function sweep(maxIdleMs = cfg.IDLE_MINUTES * 60000) {
  for (const [orgId, t] of [...tenants]) {
    if (t.starting || Date.now() - t.lastUsed < maxIdleMs) continue;
    if (await isBusy(t)) { t.lastUsed = Date.now() - maxIdleMs + 5 * 60000; continue; } // look again in 5 minutes
    stop(orgId);
  }
}
/** Frees one slot by stopping the least recently used process that is not working. */
async function makeRoom() {
  const idle = [...tenants].filter(([, t]) => !t.starting).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
  for (const [orgId, t] of idle) if (!(await isBusy(t))) { stop(orgId); await sleep(300); return; }
}

function startSweeper() { if (!timer) { timer = setInterval(() => sweep().catch(() => {}), 60000); timer.unref(); } }
function stopAll() { clearInterval(timer); timer = null; for (const id of [...tenants.keys()]) stop(id); }

/** Resolves when the process has really exited; after graceMs it is killed (SIGKILL) and given one more second. */
function waitExit(proc, graceMs = 4000) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearTimeout(t1); clearTimeout(t2); resolve(); };
    proc.once('exit', done);
    const t1 = setTimeout(() => { if (process.platform === 'win32') { try { proc.kill('SIGKILL'); } catch (_) { /* gone */ } } else killGroup(proc, 'SIGKILL'); }, graceMs);
    const t2 = setTimeout(done, graceMs + 1000);
  });
}

async function remove(orgId) {
  const t = tenants.get(orgId);
  stop(orgId);
  // Wait for the real exit, not a fixed pause: a process still shutting down under load could write a file after the
  // folder was removed and bring the customer's data folder back.
  await waitExit(t && t.proc);
  fs.rmSync(orgDir(orgId), { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

module.exports = { dirSize, ensure, init, keyFor, orgDir, remove, running: () => tenants.size, startSweeper, stop, stopAll, sweep, tenants, touch };
