// Pamięć i koszt: zdarzenia zakończonych runów wracają z dysku na żądanie, bufory mają limit.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.QA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-mem-'));
process.env.QA_KEEP_LOADED_RUNS = '2';
const store = require('../lib/store');
const { capAppend } = require('../lib/buffers');

const mk = (id, status = 'done') => ({ meta: { id, status, agent: 'x', ticket: 'T' }, events: [{ type: 'text', text: 'a' + id }, { type: 'endpoint', text: 'GET /x', input: 'y'.repeat(5000) }], listeners: new Set(), proc: null });

test('a finished run drops its events from memory and reads them back from disk', () => {
  const r = mk('r1'); store.persist(r); store.release(r);
  assert.equal(r._ev, null, 'events are not held in memory');
  assert.equal(r.events.length, 2);
  assert.equal(r.events[0].text, 'ar1');
  assert.ok(r.events.some((e) => e.type === 'endpoint' && e.input.length === 5000), 'nothing is truncated');
});

test('only a few runs stay expanded; the rest are released again', () => {
  const rs = ['a', 'b', 'c', 'd'].map((id) => { const r = mk(id); store.persist(r); store.release(r); return r; });
  for (const r of rs) assert.equal(r.events.length, 2);
  assert.ok(rs.filter((r) => r._ev).length <= 2);
  assert.equal(rs[0].events[0].text, 'aa', 'a released run loads again');
});

test('a run that gets a new event after finishing is not lost on eviction', () => {
  const r = mk('late'); store.persist(r); store.release(r);
  store.emit(r, { type: 'status', text: 'after the end' });
  for (const id of ['p', 'q', 'r']) { const o = mk(id); store.persist(o); store.release(o); void o.events; }
  assert.ok(r.events.some((e) => e.text === 'after the end'));
  store.persist(r); store.release(r);
  assert.ok(r.events.some((e) => e.text === 'after the end'), 'also after persist and release');
});

test('a running run is never released', () => {
  const r = mk('live', 'running'); store.release(r);
  assert.equal(r.events.length, 2);
  store.emit(r, { type: 'text', text: 'more' });
  assert.equal(r.events.length, 3);
});

test('loadAll restores runs lazily and marks interrupted ones as failed', () => {
  const r = mk('stuck', 'running'); store.persist(r);
  store.runs.delete('stuck');
  store.loadAll();
  const l = store.runs.get('stuck');
  assert.equal(l.meta.status, 'failed');
  assert.equal(l._ev, null);
  assert.equal(l.events.length, 2);
});

test('capAppend keeps the tail and leaves normal output alone', () => {
  assert.equal(capAppend('ab', 'cd', 10), 'abcd');
  assert.equal(capAppend('abcdef', 'gh', 5), 'defgh');
});

test('cost summary groups by agent and shows the cache share', () => {
  const { summarize } = require('../lib/costs');
  const s = summarize([
    { agent: 'design', ticket: 'A-1', costUsd: 1, usage: { input: 100, output: 10, cacheRead: 300, cacheCreate: 100, turns: 5 }, startedAt: 0, finishedAt: 120000 },
    { agent: 'design', ticket: 'A-2', costUsd: 3, usage: { input: 100, output: 10, cacheRead: 0, cacheCreate: 0, turns: 5 }, startedAt: 0, finishedAt: 60000 },
    { agent: 'static', ticket: 'A-1', costUsd: 0.5 },
  ]);
  assert.equal(s.totalUsd, 4.5);
  assert.equal(s.byAgent[0].key, 'design');
  assert.equal(s.byAgent[0].runs, 2);
  assert.equal(s.byAgent[0].avgCostUsd, 2);
  assert.equal(s.byAgent[0].minutes, 3);
  assert.equal(s.byTicket.find((t) => t.key === 'A-1').costUsd, 1.5);
});

test('the verifier model defaults to the run model and can be set separately', () => {
  const { MODEL, VERIFIER_MODEL, MAX_TURNS } = require('../lib/config');
  assert.equal(VERIFIER_MODEL, process.env.QA_VERIFIER_MODEL || MODEL);
  assert.equal(MAX_TURNS, 0, 'no turn limit unless QA_MAX_TURNS is set');
});
