const test = require('node:test');
const assert = require('node:assert');
const { buildHealth } = require('../lib/suite-health');

const run = (id, results, t0 = 0) => ({ id, startedAt: t0, finishedAt: t0 + 5000, results, messages: { 'tests/a.py::t_bad': 'boom\nmore' } });

test('flaky, always failing and trend are derived from run history', () => {
  const suite = {
    runs: [
      run('3', { 'tests/a.py::t_ok': 'passed', 'tests/a.py::t_flaky': 'passed', 'tests/a.py::t_bad': 'failed' }, 3000),
      run('2', { 'tests/a.py::t_ok': 'passed', 'tests/a.py::t_flaky': 'failed', 'tests/a.py::t_bad': 'failed' }, 2000),
      run('1', { 'tests/a.py::t_ok': 'passed', 'tests/a.py::t_flaky': 'passed', 'tests/a.py::t_bad': 'failed' }, 1000),
    ],
    last: { 'tests/a.py::t_ok': { outcome: 'passed', at: 3 }, 'tests/a.py::t_flaky': { outcome: 'passed', at: 3 }, 'tests/a.py::t_bad': { outcome: 'failed', at: 3 } },
  };
  const h = buildHealth(suite, []);
  assert.strictEqual(h.runs, 3);
  assert.deepStrictEqual(h.flaky.map((f) => f.id), ['tests/a.py::t_flaky']);
  assert.strictEqual(h.flaky[0].flips, 2);
  assert.deepStrictEqual(h.alwaysFailing.map((f) => f.id), ['tests/a.py::t_bad']);
  assert.strictEqual(h.trend.length, 3);
  assert.strictEqual(h.trend[2].passRate, 67);
  assert.strictEqual(h.failingNow[0].message, 'boom');
  assert.ok(h.score > 0 && h.score <= 100);
});

test('empty history gives no score and no crash', () => {
  const h = buildHealth({ runs: [], last: {} }, []);
  assert.strictEqual(h.score, null);
  assert.deepStrictEqual(h.trend, []);
});
