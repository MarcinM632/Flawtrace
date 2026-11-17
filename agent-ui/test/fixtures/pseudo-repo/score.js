#!/usr/bin/env node
// Scores an Analyses report against expected.json: which seeded defects were found, which clean areas were wrongly blamed.
//   node score.js <report.txt>     exit code 1 when a defect is missed
const fs = require('fs');
const path = require('path');

const TAIL = /^(Integracje|Poza zmianą|Do sprawdzenia ręcznie|Sprawdzone i czyste):/m;

function score(report, expected = JSON.parse(fs.readFileSync(path.join(__dirname, 'expected.json'), 'utf8'))) {
  const text = String(report);
  // A finding block runs from "N. title" to the next numbered title or to the first closing line.
  const blocks = text.split(/^(?=\d+\.\s)/m).filter((b) => /^\d+\.\s/.test(b)).map((b) => b.split(TAIL)[0]);
  const hit = (d) => blocks.some((b) => d.files.some((f) => b.includes(f)) && (!d.patterns || d.patterns.some((p) => b.toLowerCase().includes(p.toLowerCase()))));
  const found = expected.defects.filter(hit);
  const missed = expected.defects.filter((d) => !hit(d));
  const evidenceOf = (b) => (b.match(/^Dowód:.*$/m) || [''])[0];
  const blamed = (expected.clean || []).filter((c) => blocks.some((b) => c.files.some((f) => evidenceOf(b).includes(f))));
  const tail = (k) => (text.match(new RegExp('^' + k + ':\\s*(.+)$', 'm')) || [])[1] || '';
  return {
    findings: blocks.length,
    recall: found.length + '/' + expected.defects.length,
    found: found.map((d) => d.id),
    missed: missed.map((d) => d.id + ' ' + d.what),
    falsePositives: blamed.map((c) => c.id + ' ' + c.what),
    integrationSawOrders: /orders-svc|BillingClient|LimitCache/.test(tail('Integracje')),
  };
}

module.exports = { score };

if (require.main === module) {
  const f = process.argv[2];
  if (!f) { console.error('usage: node score.js <report.txt>'); process.exit(2); }
  const r = score(fs.readFileSync(f, 'utf8'));
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.missed.length ? 1 : 0);
}
