// lib/run-report.js: the shareable Markdown report for a run, and the MR-comment poster.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const rr = require('../lib/run-report');

const META = {
  agent: 'pentest', label: 'Pentest', status: 'done', reportStatus: 'STATUS: SUKCES', ticket: 'DEMO-42 order limits',
  report: 'WYNIK: 6 categories checked, 1 confirmed vulnerability, highest HIGH.\nZLECENIE: ...',
  coverage: { available: true, covered: 12, total: 15, pct: 80, uncovered: ['a', 'b', 'c'] },
  repoScan: { available: true, counts: { total: 3, critical: 1, high: 1, medium: 1, low: 0, secret: 1, sast: 2, sca: 0 },
    findings: [{ severity: 'critical', rule: 'private-key', file: 'id_rsa', line: 1 }, { severity: 'high', rule: 'js-eval', file: 'a.js', line: 4 }, { severity: 'medium', rule: 'weak-hash', file: 'b.js', line: 2 }] },
  transport: { available: true, counts: { total: 2, critical: 0, high: 1, medium: 0, low: 1 },
    findings: [{ severity: 'high', rule: 'cleartext-http', cwe: 'CWE-319' }, { severity: 'low', rule: 'no-csp', cwe: 'CWE-693' }] },
  audit: { issues: [{ text: 'an endpoint was not covered' }] },
  costUsd: 0.1234,
};

test('markdown carries status, task, result, facts and top findings', () => {
  const md = rr.toMarkdown(META, { link: 'http://x/run/1' });
  assert.match(md, /Flawtrace — Pentest: ✅/);
  assert.match(md, /DEMO-42 order limits/);
  assert.match(md, /6 categories checked/);
  assert.match(md, /Endpoint coverage:\*\* 12\/15 \(80%\) — 3 never exercised/);
  assert.match(md, /Static repo scan:\*\* 1 critical, 1 high/);
  assert.match(md, /Transport\/HTTP:\*\* 0 critical, 1 high/);
  assert.match(md, /Report check:\*\* 1 unresolved/);
  // Only critical/high go to the findings section; medium/low excluded.
  assert.match(md, /private-key/);
  assert.match(md, /cleartext-http/);
  assert.ok(!md.includes('weak-hash'), 'medium finding excluded from top findings');
  assert.match(md, /\$0\.12/);
  assert.match(md, /open the run/);
});

test('clean scans and a terse run read cleanly', () => {
  const md = rr.toMarkdown({ agent: 'pentest', label: 'Pentest', status: 'done', reportStatus: 'STATUS: SUKCES',
    repoScan: { available: true, counts: { total: 0 } }, transport: { available: true, counts: { total: 0 } }, audit: { issues: [] } });
  assert.match(md, /Static repo scan:\*\* clean/);
  assert.match(md, /Transport\/HTTP:\*\* clean/);
  assert.match(md, /Report check:\*\* passed/);
});

test('summaryLine is a single compact line', () => {
  const s = rr.summaryLine(META);
  assert.ok(!s.includes('\n'));
  assert.match(s, /Pentest: ✅/);
});

test('failed status shows a cross', () => {
  assert.match(rr.toMarkdown({ agent: 'qamcp', label: 'QA MCP', status: 'failed' }), /QA MCP: ❌/);
});

test('postMrComment uses the injected poster and skips without a target', async () => {
  let got = null;
  const r = await rr.postMrComment(META, { projectId: 7, mrIid: 3, poster: async (x) => { got = x; } });
  assert.equal(r.ok, true);
  assert.equal(got.projectId, 7); assert.equal(got.mrIid, 3);
  assert.match(got.body, /Flawtrace — Pentest/);
  const skip = await rr.postMrComment(META, { poster: async () => {} });
  assert.equal(skip.skipped, true);
  const fail = await rr.postMrComment(META, { projectId: 1, mrIid: 1, poster: async () => { throw new Error('boom'); } });
  assert.equal(fail.ok, false); assert.match(fail.error, /boom/);
});
