// The pseudo repositories (test/fixtures/pseudo-repo): qa-git.sh must see the change as a diff, find the consumer in the
// other service, and score.js must tell a thorough report from a shallow one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { build } = require('./fixtures/pseudo-repo/build');
const { score } = require('./fixtures/pseudo-repo/score');

const QA_GIT = path.join(__dirname, '..', 'qa-git.sh');
let hasBash = true;
try { execFileSync('bash', ['-c', 'true'], { stdio: 'ignore' }); } catch (_) { hasBash = false; }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-pseudo-'));
const built = build(path.join(tmp, 'out'));
const posix = (p) => p.split(path.sep).join('/');
const qa = (...a) => execFileSync('bash', [posix(QA_GIT), ...a], { env: { ...process.env, QA_REPOS_DIR: posix(built.reposDir) } }).toString();

test('pseudo repos: the ticket branch becomes a whitebox diff with before and after code', { skip: !hasBash }, () => {
  const work = path.join(tmp, 'work');
  const out = qa('prepare', 'billing-svc', 'DEMO-101', posix(work));
  assert.match(out, /^MODE=whitebox$/m);
  assert.match(out, /LimitService\.kt/);
  assert.match(out, /V2__max_open_orders\.sql/);
  assert.ok(fs.existsSync(path.join(work, 'kod-po', 'src/main/kotlin/billing/limits/LimitService.kt')));
  assert.ok(!/maxOpenOrders/.test(fs.readFileSync(path.join(work, 'kod-przed', 'src/main/kotlin/billing/limits/LimitRule.kt'), 'utf8')));
  assert.match(fs.readFileSync(path.join(work, 'DEMO-101.diff'), 'utf8'), /diff --git a\/src\/main\/kotlin\/billing\/limits\/LimitRuleMapper\.kt/);
});

test('pseudo repos: refs finds the consumer in the other service, with file and line', { skip: !hasBash }, () => {
  const out = qa('refs', 'customerLimit');
  assert.match(out, /orders-svc:src\/main\/kotlin\/orders\/LimitCache\.kt:\d+:/);
  assert.match(qa('find', 'customerLimit'), /== orders-svc/);
  assert.match(qa('refs', 'limits/check'), /orders-svc:.*BillingClient\.kt:\d+:/);
});

test('pseudo repos: the orders-svc consumer has no change of its own (mode static)', { skip: !hasBash }, () => {
  assert.match(qa('prepare', 'orders-svc', 'DEMO-101', posix(path.join(tmp, 'work2'))), /^MODE=static$/m);
});

test('score: a shallow report misses the integration and outside-the-change defects, a thorough one finds all', () => {
  const shallow = 'DEMO-101\nwhitebox: 6 | diff: 90 | mode: whitebox\n'
    + '1. Order limit off by one\nCo się dzieje: rejects only above the limit.\nDowód: src/main/kotlin/billing/limits/LimitService.kt:41 if (openOrders > rule.maxOpenOrders)\n'
    + 'Sprawdzone i czyste: LimitRuleValidator.kt ok\n';
  const s = score(shallow);
  assert.equal(s.recall, '1/7'); assert.deepEqual(s.found, ['D1']);
  assert.ok(s.missed.some((m) => m.startsWith('D3')) && s.missed.some((m) => m.startsWith('D5')));

  const f = (n, t, ev) => `${n}. ${t}\nCo się dzieje: x\nDowód: ${ev}\n`;
  const thorough = 'DEMO-101\n'
    + f(1, 'Off by one at the limit', 'LimitService.kt:41 openOrders > max, ticket says >=')
    + f(2, 'toEntity drops maxOpenOrders', 'LimitRuleMapper.kt:17')
    + f(3, 'Event still read as customerLimit', 'LimitCache.kt:8 payload["customerLimit"]')
    + f(4, 'check needs openOrders, caller does not send it', 'BillingClient.kt:11')
    + f(5, 'PERIOD_DAYS 30 to 7 shortens invoice due date', 'LimitDefaults.kt:5, InvoiceService.kt:12')
    + f(6, 'canRead check removed', 'LimitController.kt:12 Forbidden no longer thrown')
    + f(7, 'NOT NULL column without default breaks existing rows', 'V2__max_open_orders.sql:1')
    + 'Integracje: LimitService event → orders-svc LimitCache.kt:8 reads old name\nSprawdzone i czyste: LimitRuleValidator.kt bounds ok\n';
  const t = score(thorough);
  assert.equal(t.recall, '7/7'); assert.deepEqual(t.missed, []); assert.deepEqual(t.falsePositives, []); assert.equal(t.integrationSawOrders, true);
  const blamed = score(thorough + '8. Validator wrong\nDowód: LimitRuleValidator.kt:7\n');
  assert.equal(blamed.falsePositives.length, 1, 'blaming the correct validator is a false positive');
});
