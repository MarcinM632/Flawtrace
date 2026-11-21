const { test } = require('node:test');
const assert = require('node:assert/strict');
const { longSentences, parseVerdict, profileFor, systemText, toIssues } = require('../lib/verifier');

const REPORT = 'Status zamówienia zmienia się na Zapłacone (PRJ-12). Kwota nie może być ujemna.';

test('verifier: very long sentences are flagged without any model', () => {
  const long = Array.from({ length: 45 }, (_, i) => 'słowo' + i).join(' ') + '.';
  const out = longSentences('Krótkie zdanie. ' + long);
  assert.equal(out.length, 1);
  assert.equal(out[0].code, 'verify-long-sentence');
  assert.deepEqual(longSentences('Jedno. Drugie zdanie jest krótkie.'), []);
});

test('verifier: the verdict is read from a fenced block or from surrounding text', () => {
  assert.equal(parseVerdict('```json\n{"checked":3,"findings":[]}\n```').checked, 3);
  assert.equal(parseVerdict('Here you go: {"checked":1,"findings":[]} done').checked, 1);
  assert.equal(parseVerdict('no json here'), null);
});

test('verifier: a finding whose quote is not in the report is dropped', () => {
  const v = { checked: 2, findings: [
    { type: 'term-not-in-sources', quote: 'Zapłacone', problem: 'Source says "Opłacone"', evidence: 'PRJ-12 comment 3', fix: 'Opłacone' },
    { type: 'bad-source', quote: 'text the report never contained', problem: 'x' },
    { type: 'cannot-verify', quote: '', problem: 'Confluence is not connected' },
  ] };
  const { issues, dropped } = toIssues(v, REPORT);
  assert.equal(dropped, 1);
  assert.deepEqual(issues.map((i) => i.code), ['verify-term-not-in-sources', 'verify-cannot-verify']);
  assert.match(issues[0].text, /Opłacone/);
});

test('verifier: refuted and overstated findings are accepted and labelled', () => {
  const v = { checked: 2, findings: [
    { type: 'refuted', quote: 'Kwota nie może być ujemna', problem: 'A validator stops it', evidence: 'OrderDto.kt:14 @Min(0)', fix: 'remove' },
    { type: 'overstated', quote: 'Status zamówienia zmienia się', problem: 'No second step shown', evidence: 'x', fix: 'narrow' },
  ] };
  const { issues } = toIssues(v, REPORT);
  assert.deepEqual(issues.map((i) => i.code), ['verify-refuted', 'verify-overstated']);
  assert.match(issues[0].text, /Refuted by the code/);
});

test('verifier: the system prompt carries the skills and only the profile of the report type', () => {
  const qa = systemText('qa');
  assert.match(qa, /Finding adversary/);
  assert.match(qa, /Quote against line/);
  assert.match(qa, /Profile of this report \(qa\)/);
  assert.doesNotMatch(qa, /Profile of this report \(design\)/);
  assert.match(systemText('completion'), /Profile of this report \(completion\)/);
  assert.doesNotMatch(systemText('no-such-kind'), /Profile of this report/);
  assert.equal(profileFor('intro\n\n## kind: a\nA text\n\n## kind: b\nB text', 'b').includes('A text'), false);
});

test('qamcp skills: QA MCP gets four, Execution gets five, other modes none', () => {
  const { qamcpSkills } = require('../lib/prompts');
  const count = (t) => (t.match(/^SKILL /gm) || []).length;
  assert.equal(count(qamcpSkills('qamcp')), 4);
  assert.equal(count(qamcpSkills('execution')), 5);
  assert.match(qamcpSkills('execution'), /procedure-execution/);
  assert.doesNotMatch(qamcpSkills('qamcp'), /procedure-execution/);
  for (const m of ['pentest', 'design', 'static', 'completion']) assert.equal(qamcpSkills(m), '');
});

test('autotest skills: only the Autotests mode gets the three skills', () => {
  const { autotestSkills } = require('../lib/prompts');
  const t = autotestSkills('autotest');
  for (const n of ['test-from-design', 'independent-fast-tests', 'failure-triage-fix']) assert.match(t, new RegExp('SKILL ' + n));
  for (const m of ['qamcp', 'execution', 'design', 'uitest']) assert.equal(autotestSkills(m), '');
});
