// SCA przez OSV: parsowanie plików blokad do dokładnych wersji, wsadowe zapytanie do OSV (fałszywy fetch), mapowanie
// wagi z CVSS i wersji naprawionej, deduplikacja, scalenie z wynikiem repo-scan.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const osv = require('../lib/osv-scan');
const repoScan = require('../lib/repo-scan');

test('parsery: dokładne wersje z package-lock (v3 i v1), yarn, pnpm, requirements, go.mod, Cargo, Gemfile, composer', () => {
  const d = (rel, text) => osv.depsFromFile(rel, text);
  assert.deepEqual(d('package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: { '': { name: 'app' }, 'node_modules/lodash': { version: '4.17.19' }, 'node_modules/@scope/x': { version: '1.0.0' } } })),
    [{ ecosystem: 'npm', name: 'lodash', version: '4.17.19', file: 'package-lock.json' }, { ecosystem: 'npm', name: '@scope/x', version: '1.0.0', file: 'package-lock.json' }]);
  assert.deepEqual(d('a/package-lock.json', JSON.stringify({ dependencies: { minimist: { version: '1.2.0', dependencies: { nested: { version: '0.1.0' } } } } })).map((x) => x.name + '@' + x.version), ['minimist@1.2.0', 'nested@0.1.0']);
  assert.deepEqual(d('yarn.lock', 'lodash@^4.0.0:\n  version "4.17.19"\n  resolved "x"\n\n"@scope/y@1":\n  version "2.3.4"\n').map((x) => x.name + '@' + x.version), ['lodash@4.17.19', '@scope/y@2.3.4']);
  assert.deepEqual(d('pnpm-lock.yaml', 'packages:\n  /lodash/4.17.19:\n    dev: false\n  /@scope/z/1.2.3(react@18.0.0):\n    dev: false\n').map((x) => x.name + '@' + x.version), ['lodash@4.17.19', '@scope/z@1.2.3']);
  assert.deepEqual(d('requirements.txt', 'Django==2.2.0\nflask>=1.0  # floating, skipped\nrequests==2.20.0\n').map((x) => x.name + '@' + x.version), ['Django@2.2.0', 'requests@2.20.0']);
  assert.deepEqual(d('go.mod', 'module x\n\nrequire (\n\tgithub.com/foo/bar v1.2.3\n\tgolang.org/x/net v0.0.1 // indirect\n)\n').map((x) => x.name + '@' + x.version), ['github.com/foo/bar@v1.2.3', 'golang.org/x/net@v0.0.1']);
  assert.deepEqual(d('Cargo.lock', '[[package]]\nname = "regex"\nversion = "1.3.0"\n').map((x) => x.name + '@' + x.version), ['regex@1.3.0']);
  assert.deepEqual(d('Gemfile.lock', 'GEM\n  specs:\n    rails (5.2.0)\n    rack (2.0.1)\n\nPLATFORMS\n').map((x) => x.name + '@' + x.version), ['rails@5.2.0', 'rack@2.0.1']);
  assert.deepEqual(d('composer.lock', JSON.stringify({ packages: [{ name: 'monolog/monolog', version: '1.0.0' }] })).map((x) => x.name + '@' + x.version), ['monolog/monolog@1.0.0']);
  assert.deepEqual(d('src/app.js', 'const x=1'), []);
});

function fakeOsv({ batch, vulns }) {
  return async (url, init) => {
    if (String(url).endsWith('/querybatch')) {
      const q = JSON.parse(init.body).queries;
      return { ok: true, json: async () => ({ results: q.map((x) => ({ vulns: (batch[`${x.package.ecosystem}|${x.package.name}|${x.version}`] || []).map((id) => ({ id })) })) }) };
    }
    const id = decodeURIComponent(String(url).split('/').pop());
    return vulns[id] ? { ok: true, json: async () => vulns[id] } : { ok: false, status: 404 };
  };
}

test('OSV: zapytanie wsadowe, waga z CVSS, wersja naprawiona, numer CVE z aliasu', async () => {
  const files = [{ rel: 'package-lock.json', text: JSON.stringify({ packages: { 'node_modules/lodash': { version: '4.17.11' }, 'node_modules/safe': { version: '1.0.0' } } }) }];
  const fetchImpl = fakeOsv({
    batch: { 'npm|lodash|4.17.11': ['GHSA-xxxx'] },
    vulns: { 'GHSA-xxxx': { id: 'GHSA-xxxx', aliases: ['CVE-2019-10744'], summary: 'Prototype pollution in lodash', severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }], affected: [{ package: { name: 'lodash' }, ranges: [{ events: [{ introduced: '0' }, { fixed: '4.17.12' }] }] }] } },
  });
  const r = await osv.scan({ files, fetchImpl });
  assert.equal(r.available, true); assert.equal(r.queried, 2);
  assert.equal(r.findings.length, 1);
  const f = r.findings[0];
  assert.equal(f.id, 'CVE-2019-10744'); assert.equal(f.severity, 'critical'); assert.equal(f.fixed, '4.17.12'); assert.equal(f.pkg, 'lodash');
  assert.match(f.title, /lodash@4\.17\.11 \(npm\) — CVE-2019-10744: Prototype pollution/);
  assert.equal(f.url, 'https://osv.dev/vulnerability/CVE-2019-10744');
});

test('OSV: sieć niedostępna → available:false z powodem, bez findingów', async () => {
  const r = await osv.scan({ files: [{ rel: 'requirements.txt', text: 'django==2.2.0' }], fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND api.osv.dev'); } });
  assert.equal(r.available, false); assert.match(r.reason, /OSV nieosiągalne/); assert.deepEqual(r.findings, []);
});

test('mergeOsv: findingi OSV dołączone do wyniku repo-scan, dedup względem wbudowanej listy po paczce+wersji', () => {
  const result = { available: true, findings: [{ repo: 'r', scanner: 'sca', rule: 'known-vuln', severity: 'high', pkg: 'lodash', version: '4.17.11', title: 'builtin' }], counts: {}, scannedFiles: 1 };
  const osvRes = { available: true, queried: 2, ecosystems: ['npm'], findings: [
    { scanner: 'sca-osv', severity: 'critical', id: 'CVE-1', pkg: 'lodash', version: '4.17.11', cwe: 'CWE-1395', title: 'lodash CVE-1', file: 'package-lock.json', fixed: '4.17.12', url: 'u' },
    { scanner: 'sca-osv', severity: 'medium', id: 'CVE-2', pkg: 'other', version: '1.0.0', cwe: 'CWE-1395', title: 'other CVE-2', file: 'package-lock.json', fixed: null, url: 'u2' },
  ] };
  repoScan.mergeOsv(result, osvRes);
  const ids = result.findings.filter((f) => f.rule === 'osv').map((f) => f.id);
  assert.deepEqual(ids.sort(), ['CVE-1', 'CVE-2'], 'OSV finding z id dołączony nawet gdy builtin zna tę paczkę (inny numer)');
  assert.equal(result.findings[0].severity, 'critical', 'posortowane po wadze');
  assert.equal(result.osv.found, 2);
});
