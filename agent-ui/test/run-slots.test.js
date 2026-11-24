// Limit równoległych runów: kolejka w gatewayu (wszyscy klienci) i klient w procesie workspace.
const { test } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

process.env.MAX_ACTIVE_RUNS = '3'; process.env.MAX_RUNS_PER_ORG = '2';
const slots = require('../cloud/slots');

test('slots: server ceiling, per-workspace ceiling, fair order, release, crash cleanup', () => {
  slots.reset();
  assert.deepEqual(slots.acquire('A', 'a1'), { granted: true });
  assert.deepEqual(slots.acquire('A', 'a2'), { granted: true });
  const a3 = slots.acquire('A', 'a3');
  assert.equal(a3.granted, false); assert.equal(a3.reason, 'workspace', 'A is at its own limit of 2');
  assert.deepEqual(slots.acquire('B', 'b1'), { granted: true }, 'B is not blocked by A waiting');
  const b2 = slots.acquire('B', 'b2');
  assert.equal(b2.granted, false); assert.equal(b2.reason, 'server'); assert.equal(b2.position, 2);
  assert.deepEqual(slots.acquire('A', 'a1'), { granted: true }, 'asking again keeps the slot');
  slots.release('A', 'a1');
  // a3 waited first and A has room again: it gets the slot, b2 still waits for the server
  assert.deepEqual(slots.acquire('A', 'a3'), { granted: true });
  assert.equal(slots.acquire('B', 'b2').position, 1);
  assert.deepEqual(slots.renew('A', ['a2', 'gone']), ['gone']);
  slots.releaseOrg('A'); // A's process stopped
  assert.deepEqual(slots.acquire('B', 'b2'), { granted: true });
  assert.deepEqual(slots.stats(), { active: 2, waiting: 0, max: 3, perOrg: 2 });
});

test('slots: a waiting run that stops asking leaves the queue; an unrenewed lease frees itself', () => {
  slots.reset();
  const real = Date.now;
  try {
    for (const id of ['x1', 'x2', 'x3']) slots.acquire('X' + id, id);
    assert.equal(slots.acquire('Y', 'y1').granted, false);
    Date.now = () => real() + slots.LEASE_MS + 1000;
    assert.deepEqual(slots.stats().active, 0, 'leases expired');
    assert.equal(slots.stats().waiting, 0, 'the silent waiter is gone');
  } finally { Date.now = real; }
});

test('workspace client: waits in the queue, reports the place, starts when a slot frees, and gives up on cancel', async () => {
  slots.reset();
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => b += c); req.on('end', () => {
      if (req.headers['x-flawtrace-gateway'] !== 'tok') { res.writeHead(403); return res.end('{}'); }
      const j = JSON.parse(b || '{}'); let out;
      if (j.op === 'release') { slots.release('W', j.run); out = { ok: true }; } else if (j.op === 'renew') out = { lost: slots.renew('W', j.runs) }; else out = slots.acquire('W', j.run);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const code = `
    const s = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'run-slots'))});
    (async () => {
      const log = [];
      const r1 = await s.acquire('r1'); const r2 = await s.acquire('r2');
      let cancel = false;
      const p3 = s.acquire('r3', { onWait: (w) => log.push('wait ' + w.position + ' ' + w.reason) });
      const p4 = s.acquire('r4', { isCancelled: () => cancel });
      setTimeout(() => { log.push('release r1'); r1(); }, 150);
      const r3 = await p3; log.push('r3 started');
      cancel = true; log.push('r4 ' + (await p4));
      r2(); r3();
      console.log(JSON.stringify({ unlimited: s.unlimited(), log }));
    })();`;
  const out = await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['-e', code], { env: { ...process.env, QA_SLOT_URL: `http://127.0.0.1:${srv.address().port}`, QA_GATEWAY_TOKEN: 'tok', QA_SLOT_POLL_MS: '40' } });
    let o = '', e = ''; p.stdout.on('data', (c) => o += c); p.stderr.on('data', (c) => e += c);
    p.on('exit', () => (o ? resolve(JSON.parse(o)) : reject(new Error(e))));
  });
  srv.close();
  assert.equal(out.unlimited, false);
  assert.deepEqual(out.log, ['wait 1 workspace', 'release r1', 'r3 started', 'r4 null']);
  assert.equal(slots.stats().active, 0, 'everything released');
});

test('local mode: no limit by default; QA_MAX_PARALLEL_RUNS queues extra runs', async () => {
  const code = `
    const s = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'run-slots'))});
    (async () => {
      const a = await s.acquire('a'); let started = false; const w = [];
      const p = s.acquire('b', { onWait: (x) => w.push(x.reason) }).then((rel) => { started = true; return rel; });
      await new Promise((r) => setTimeout(r, 60)); const before = started; a(); const b = await p; b();
      console.log(JSON.stringify({ unlimited: s.unlimited(), before, after: started, w }));
    })();`;
  const run = (env) => new Promise((resolve) => { const p = spawn(process.execPath, ['-e', code], { env: { ...process.env, QA_SLOT_URL: '', ...env } }); let o = ''; p.stdout.on('data', (c) => o += c); p.on('exit', () => resolve(JSON.parse(o))); });
  assert.deepEqual(await run({ QA_MAX_PARALLEL_RUNS: '' }), { unlimited: true, before: true, after: true, w: [] });
  assert.deepEqual(await run({ QA_MAX_PARALLEL_RUNS: '1', QA_SLOT_POLL_MS: '20' }), { unlimited: false, before: false, after: true, w: ['workspace'] });
});
