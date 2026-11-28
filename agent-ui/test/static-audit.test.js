// The app's check of the Static review report: what lib/pipeline.js reads from it must be there and consistent.
const test = require('node:test');
const assert = require('node:assert/strict');
const { auditStatic, correctionPrompt } = require('../lib/report-format');
const pipeline = require('../lib/pipeline');

const GOOD = `BENCH-1 — Registration
Repo/mode: shop, static (no ticket branch)
Sources: task.md
Review: static, checklist-based | requirements: 3 | findings: 2 | scenarios: 1 | code files read: 2

## Requirements
R1 [rule] "at least 8 characters" (src: BENCH-1)

## Findings
1. [Consistency] [Major] Lock duration differs
Requirement: R2
2. [Testability] [Minor] "Secure" is not measurable
Requirement: R3

## Open questions
- Name length?

## Verdict
STATUS: NEEDS REWORK — finding 1.`;

const codes = (r) => auditStatic(r).map((i) => i.code);

test('a well-formed report has no issues, and the pipeline reads the same verdict and count', () => {
  assert.deepEqual(auditStatic(GOOD), []);
  assert.equal(pipeline.staticVerdict(GOOD), 'NEEDS REWORK');
  assert.equal(pipeline.staticFindingCount(GOOD), 2);
});

test('missing verdict or Repo/mode line, and findings the app cannot count', () => {
  assert.deepEqual(codes(GOOD.replace(/STATUS: NEEDS REWORK/, 'Verdict: needs rework')), ['static-no-verdict']);
  assert.deepEqual(codes(GOOD.replace(/^Repo\/mode:.*\n/m, '')), ['static-no-mode']);
  const loose = GOOD.replace('1. [Consistency] [Major] Lock', '1. **Major** — Lock');
  assert.deepEqual(codes(loose), ['static-finding-format', 'static-verdict-mismatch', 'static-count-mismatch']);
  assert.equal(pipeline.staticFindingCount(loose), 1, 'this is what the pipeline would have counted');
});

test('the verdict must follow the severities, and the declared count must match', () => {
  assert.deepEqual(codes(GOOD.replace('STATUS: NEEDS REWORK', 'STATUS: TASK OK')), ['static-verdict-mismatch']);
  assert.deepEqual(codes(GOOD.replace('STATUS: NEEDS REWORK', 'STATUS: BLOCKED')), ['static-verdict-mismatch']);
  assert.deepEqual(codes(GOOD.replace('[Major] Lock', '[Minor] Lock')), ['static-verdict-mismatch']);
  assert.deepEqual(codes(GOOD.replace('findings: 2', 'findings: 3')), ['static-count-mismatch']);
  const none = GOOD.replace(/## Findings[\s\S]*?## Open/, '## Findings\nnone: the task is sound.\n\n## Open').replace('findings: 2', 'findings: 0').replace('STATUS: NEEDS REWORK', 'STATUS: TASK OK');
  assert.deepEqual(auditStatic(none), []);
});

test('the issues go into the generic correction prompt with the validator instruction', () => {
  const p = correctionPrompt('static', auditStatic(GOOD.replace('findings: 2', 'findings: 3')));
  assert.match(p, /findings: 3, but ## Findings has 2/);
  assert.match(p, /walidator/);
});
