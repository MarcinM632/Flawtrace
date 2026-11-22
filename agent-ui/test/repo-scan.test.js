// lib/repo-scan.js: the app's deterministic repo security scan (secrets + SAST + SCA). Builds a small
// throwaway repo with planted issues and clean decoys, and checks what the scanner finds and ignores.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const scan = require('../lib/repo-scan');

function repo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-reposcan-'));
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return { name: 'demo', path: dir.split(path.sep).join('/'), ready: true };
}
const run = (files) => scan.scan([repo(files)]);
const has = (res, rule, file) => res.findings.some((f) => f.rule === rule && (!file || f.file === file));

test('secret scan: real secrets found, placeholders and env refs ignored', () => {
  const res = run({
    'config.js': [
      "const awsKey = 'AKIAIOSFODNN7EXAMPLE';",            // aws-access-key
      "const password = 'Sup3rSecretP@ss';",                // generic-secret
      "const db = 'postgres://user:realpass123@db:5432/x';", // db-url-password
      "const gh = 'ghp_0123456789abcdefghijklmnopqrstuvwxyz';", // github-token
    ].join('\n'),
    '.env.example': [
      "PASSWORD=changeme",                                   // placeholder -> ignored
      "API_KEY=${API_KEY}",                                  // env ref -> ignored
      "SECRET=process.env.SECRET",                           // env ref -> ignored
      "TOKEN=your-token-here",                               // placeholder -> ignored
    ].join('\n'),
    'id_rsa': '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----\n',
  });
  assert.ok(has(res, 'aws-access-key'), 'aws key');
  assert.ok(has(res, 'generic-secret', 'config.js'), 'hardcoded password');
  assert.ok(has(res, 'db-url-password'), 'db creds in url');
  assert.ok(has(res, 'github-token'), 'github token');
  assert.ok(has(res, 'private-key', 'id_rsa'), 'private key');
  // Nothing from the placeholder/env file.
  assert.ok(!res.findings.some((f) => f.file === '.env.example'), 'placeholders ignored: ' + JSON.stringify(res.findings.filter((f) => f.file === '.env.example')));
});

test('SAST: dangerous patterns per language, clean code ignored', () => {
  const res = run({
    'a.js': [
      "const { exec } = require('child_process');",
      "exec(`ls ${userInput}`);",                           // js-cmd-injection
      "eval(data);",                                        // js-eval
      "db.query('SELECT * FROM users WHERE id = ' + id);",  // sql-concat
      "https.get({ rejectUnauthorized: false });",          // tls-node
      "el.innerHTML = userInput;",                          // xss-sink
    ].join('\n'),
    'b.py': [
      "import subprocess, yaml, pickle",
      "subprocess.run(cmd, shell=True)",                    // py-shell-true
      "yaml.load(data)",                                    // py-yaml-load
      "pickle.loads(blob)",                                 // py-pickle
      "requests.get(url, verify=False)",                    // tls-python
    ].join('\n'),
    'clean.js': [
      "const { execFile } = require('child_process');",
      "execFile('ls', [dir]);",                             // no string-building -> not flagged
      "db.query('SELECT * FROM users WHERE id = $1', [id]);", // parameterized -> not flagged
      "el.textContent = userInput;",                        // safe sink
    ].join('\n'),
  });
  for (const rule of ['js-cmd-injection', 'js-eval', 'sql-concat', 'tls-node', 'xss-sink', 'py-shell-true', 'py-yaml-load', 'py-pickle', 'tls-python'])
    assert.ok(has(res, rule), 'expected ' + rule);
  assert.ok(!res.findings.some((f) => f.file === 'clean.js'), 'clean.js should be clean: ' + JSON.stringify(res.findings.filter((f) => f.file === 'clean.js')));
});

test('SCA: known-vuln dependency, floating version, missing lockfile', () => {
  const res = run({
    'package.json': JSON.stringify({ name: 'x', dependencies: { lodash: '4.17.19', express: '^4.18.2', left: '*' } }),
    'pom.xml': '<project><dependencies><dependency><artifactId>log4j-core</artifactId><version>2.14.1</version></dependency></dependencies></project>',
    'requirements.txt': 'urllib3==1.25.0\nflask>=1.0\n',
  });
  assert.ok(res.findings.some((f) => f.rule === 'known-vuln' && f.pkg === 'lodash'), 'lodash known-vuln');
  assert.ok(res.findings.some((f) => f.rule === 'known-vuln' && f.pkg === 'log4j-core' && f.severity === 'critical'), 'log4shell');
  assert.ok(res.findings.some((f) => f.rule === 'known-vuln' && f.pkg === 'urllib3'), 'urllib3 known-vuln');
  assert.ok(res.findings.some((f) => f.rule === 'floating-version' && f.pkg === 'left'), 'floating lodash star');
  assert.ok(has(res, 'no-lockfile'), 'missing lockfile flagged');
  // A patched lodash is not flagged.
  const ok = run({ 'package.json': JSON.stringify({ dependencies: { lodash: '4.17.21' } }), 'package-lock.json': '{}' });
  assert.ok(!ok.findings.some((f) => f.rule === 'known-vuln'), 'patched lodash not flagged');
  assert.ok(!has(ok, 'no-lockfile'), 'lockfile present');
});

test('scan: counts, severity order, and correction issues', () => {
  const res = run({ 'x.js': "const password = 'Sup3rSecretP@ss';\neval(x);" });
  assert.equal(res.available, true);
  assert.ok(res.counts.total >= 2);
  assert.equal(res.findings[0].severity, res.findings[0].severity === 'critical' ? 'critical' : 'high'); // most severe first
  // Report that ignores the findings -> a correction issue; a report that names them -> none.
  assert.equal(scan.repoScanIssues(res, 'nothing relevant here').length, 1);
  assert.equal(scan.repoScanIssues(res, 'I reviewed x.js and the generic-secret and js-eval findings').length, 0);
  // No repos -> unavailable, no crash.
  const none = scan.scan([]);
  assert.equal(none.available, false);
  assert.equal(scan.repoScanIssues(none, '').length, 0);
});

test('version compare handles ranges and prefixes', () => {
  assert.equal(scan._lt('4.17.19', '4.17.21'), true);
  assert.equal(scan._lt('4.17.21', '4.17.21'), false);
  assert.equal(scan._lt('2.0.0', '1.33'), false);
  assert.equal(scan._lt('1.2', '1.2.1'), true);
});
