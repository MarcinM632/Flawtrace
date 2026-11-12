const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { STACKS, isProject, projectFiles, stackOf, stackPrompt } = require('../lib/stacks');

test('python is the built-in stack, unknown keys fall back to it', () => {
  assert.strictEqual(isProject('python'), false);
  assert.strictEqual(isProject('nope'), false);
  assert.strictEqual(stackOf('nope').key, 'python');
  for (const k of ['ts-playwright', 'java-restassured', 'java-selenium', 'js-cypress']) assert.strictEqual(isProject(k), true);
});

test('every project stack prompt names its folder, run command and the gTAA layers', () => {
  for (const [k, s] of Object.entries(STACKS)) {
    if (k === 'python') continue;
    const p = stackPrompt(k);
    assert.ok(p.includes(s.folder + '/'), k);
    assert.ok(p.includes(s.run), k);
    assert.ok(/ADAPTACJA DO SUT/.test(p) && /DEFINICJA TESTÓW/.test(p), k);
    assert.ok(!/pytest/i.test(p) || k === 'python', k + ' prompt must not mention pytest');
  }
});

test('projectFiles lists the project folder and skips dependencies', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stk-'));
  const base = path.join(root, 'ts-playwright');
  fs.mkdirSync(path.join(base, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(base, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(base, 'package.json'), '{}');
  fs.writeFileSync(path.join(base, 'tests', 'a.spec.ts'), '');
  fs.writeFileSync(path.join(base, 'node_modules', 'x', 'i.js'), '');
  const files = projectFiles(root, 'ts-playwright').map((f) => f.path).sort();
  assert.deepStrictEqual(files, ['ts-playwright/package.json', 'ts-playwright/tests/a.spec.ts']);
  fs.rmSync(root, { recursive: true, force: true });
});
