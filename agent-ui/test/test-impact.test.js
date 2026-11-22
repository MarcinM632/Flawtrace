// lib/test-impact.js: deterministic test selection for a change set (run only the affected tests, safely).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ti = require('../lib/test-impact');

const TESTS = [
  { id: 'login', file: 'tests/login.spec.ts', touches: ['src/auth/'] },
  { id: 'checkout', file: 'tests/checkout.spec.ts', touches: ['src/billing/Invoice.ts'], areas: ['billing'] },
  { id: 'search', file: 'tests/search.spec.ts', touches: ['src/search/'] },
  { id: 'legacy', file: 'tests/legacy.spec.ts' }, // no mapping -> always run (safe)
];

test('selects only tests affected by the changed files', () => {
  const sel = ti.select(['src/billing/Invoice.ts'], TESTS);
  const ids = sel.run.map((r) => r.id).sort();
  assert.ok(ids.includes('checkout'), 'checkout touches billing');
  assert.ok(ids.includes('legacy'), 'unmapped test runs to be safe');
  assert.ok(!ids.includes('login') && !ids.includes('search'), 'unrelated tests skipped: ' + ids);
  assert.equal(sel.selected, 2);
  assert.equal(sel.total, 4);
});

test('a changed test file selects that test', () => {
  const sel = ti.select(['tests/search.spec.ts'], TESTS);
  assert.ok(sel.run.some((r) => r.id === 'search'));
});

test('shared area / same unit matching', () => {
  assert.ok(ti._affects('src/auth/token.ts', TESTS[0]), 'auth dir shared');
  assert.ok(ti._affects('app/search/Index.tsx', { id: 'x', file: 'tests/search.spec.ts' }), 'search area shared');
  assert.equal(ti._affects('src/unrelated/Thing.ts', TESTS[0]), null);
});

test('a broad change runs the whole suite', () => {
  for (const f of ['package-lock.json', '.github/workflows/ci.yml', 'Dockerfile', 'src/app/.env.local']) {
    const sel = ti.select([f], TESTS);
    assert.equal(sel.broad, true, f);
    assert.equal(sel.selected, 4, f);
  }
});

test('no change info -> run all by default, none when asked', () => {
  assert.equal(ti.select([], TESTS).selected, 4);
  assert.equal(ti.select([], TESTS, { onEmptyChange: 'none' }).selected, 0);
});

test('always-run flag is honored', () => {
  const sel = ti.select(['src/unrelated/x.ts'], [{ id: 'smoke', file: 'tests/smoke.spec.ts', touches: ['src/home/'], always: true }]);
  assert.ok(sel.run.some((r) => r.id === 'smoke'));
});

test('changedFromDiff parses name-only, name-status and full diff', () => {
  assert.deepEqual(ti.changedFromDiff('src/a.ts\nsrc/b.ts\n'), ['src/a.ts', 'src/b.ts']);
  assert.deepEqual(ti.changedFromDiff('M\tsrc/a.ts\nA\tsrc/c.ts'), ['src/a.ts', 'src/c.ts']);
  const fromRename = ti.changedFromDiff('R100\told/a.ts\tnew/a.ts');
  assert.ok(fromRename.includes('new/a.ts'));
  const full = ti.changedFromDiff('diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1 +1 @@\nsrc/x.ts');
  assert.ok(full.includes('src/x.ts'));
});

test('summary reads naturally', () => {
  assert.match(ti.summary(ti.select(['src/billing/Invoice.ts'], TESTS)), /2\/4 tests selected/);
  assert.match(ti.summary(ti.select(['package-lock.json'], TESTS)), /running all 4/);
});
