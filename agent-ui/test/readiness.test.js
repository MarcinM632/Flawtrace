// Readiness of a task before Full tests: plain rules, no model. Checked on the benchmark tickets too, so a good ticket
// passes without noise and the vague words seeded in them are named.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { assess } = require('../lib/readiness');

const ALL = { jira: false, confluence: false, repos: 1, api: true, knowledge: 3 };
const codes = (o) => assess(o).items.map((i) => i.code);

test('a key alone without Jira is a stop; with Jira it is fine', () => {
  const r = assess({ task: 'SHOP-12', stages: { static: true }, sources: ALL });
  assert.equal(r.ready, false);
  assert.deepEqual(r.items.map((i) => i.code), ['key-without-jira']);
  assert.deepEqual(codes({ task: 'SHOP-12', stages: { static: true }, sources: { ...ALL, jira: true } }), []);
  assert.equal(assess({ task: '' }).ready, false);
});

test('a short task without criteria, and the vague words, are warnings that do not block', () => {
  const r = assess({ task: 'Login must be fast and secure.', stages: { static: true }, sources: ALL });
  assert.equal(r.ready, true);
  assert.deepEqual(r.items.map((i) => i.code), ['short', 'no-criteria', 'vague']);
  assert.match(r.items[2].text, /"fast", "secure"/);
});

test('selected tracks that cannot run are named', () => {
  const t = fs.readFileSync(path.join(__dirname, '..', 'eval', 'tickets', 'BENCH-2.md'), 'utf8');
  assert.deepEqual(codes({ task: t, stages: { api: true, ui: true, whitebox: true }, url: '', sources: { ...ALL, api: false, repos: 0 } }), ['vague', 'no-api', 'no-url', 'no-repo']);
  assert.deepEqual(codes({ task: 'Do it', stages: {}, sources: {} }).slice(-1), ['no-sources']);
});

test('the benchmark tickets are ready; only their seeded vague words are reported', () => {
  for (const [f, words] of [['BENCH-1.md', ['secure']], ['BENCH-2.md', ['instant']], ['BENCH-3.md', []]]) {
    const r = assess({ task: fs.readFileSync(path.join(__dirname, '..', 'eval', 'tickets', f), 'utf8'), stages: { static: true, api: true, ui: true }, url: 'http://127.0.0.1:4400/', sources: ALL });
    assert.equal(r.ready, true, f);
    const vague = r.items.find((i) => i.code === 'vague');
    assert.deepEqual(r.items.filter((i) => i.code !== 'vague'), [], f + ': ' + JSON.stringify(r.items));
    for (const w of words) assert.match(vague.text, new RegExp('"' + w), f);
    if (!words.length) assert.equal(vague, undefined, f);
  }
});
