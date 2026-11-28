// Evidence on the results the tester confirms: an API error carries the calls it cites (request and answer from the
// run's call log); an error that cites no logged call is marked, so it is not confirmed as a defect on trust.
const test = require('node:test');
const assert = require('node:assert/strict');
const { apiItems } = require('../lib/pipeline');
const { parseReport } = require('../lib/report-format');

const REPORT = `WYNIK: 2 errors.
KROKI:
1. Registered with an 8-character password [c1].
BŁĘDY:
### An 8-character password is rejected
KROK: 1
ENDPOINT: \`register\`
OCZEKIWANO: 201
OTRZYMANO: 400 "Password must have at least 8 characters" [c1]
RODZAJ: PRODUKT
### Login of an unknown email says 404
KROK: 2
ENDPOINT: \`login\`
OCZEKIWANO: 401
OTRZYMANO: 404 [c9]
RODZAJ: PRODUKT`;

const CALLS = { c1: { ref: 'c1', endpoint: 'register', args: { body: { email: 'a@x.test', password: 'Secret12', name: 'A' } }, response: { _call: 'c1', status: 400, url: '/api/auth/register', body: { error: 'Password must have at least 8 characters' } } } };

test('a cited call becomes evidence with request and answer; a cited call missing from the log is no evidence', () => {
  const items = apiItems(REPORT, 'BŁĄD', parseReport, CALLS);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].evidence.map((e) => [e.ref, e.endpoint, e.status, e.url]), [['c1', 'register', 400, '/api/auth/register']]);
  assert.match(items[0].evidence[0].request, /Secret12/);
  assert.match(items[0].evidence[0].response, /at least 8 characters/);
  assert.equal(items[1].noEvidence, true);
  assert.equal(items[1].evidence, undefined);
});

test('without a call log (older runs) the items are as before', () => {
  const items = apiItems(REPORT, 'BŁĄD', parseReport);
  assert.ok(items.every((i) => !('evidence' in i) && !('noEvidence' in i)));
});
