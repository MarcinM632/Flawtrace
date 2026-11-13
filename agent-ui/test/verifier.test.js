const { test } = require('node:test');
const assert = require('node:assert/strict');
const { longSentences, parseVerdict, toIssues } = require('../lib/verifier');

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
