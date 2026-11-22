// lib/ci-export.js: generate a ready-to-commit CI config so the client runs the generated tests in their own CI.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ci = require('../lib/ci-export');

test('GitHub Actions: checkout, node, install, browsers, test with BASE_URL, artifact', () => {
  const y = ci.githubActions('ts-playwright');
  assert.match(y, /name: e2e/);
  assert.match(y, /actions\/checkout@v4/);
  assert.match(y, /setup-node@v4/);
  assert.match(y, /npx playwright install --with-deps/);
  assert.match(y, /npx playwright test/);
  assert.match(y, /BASE_URL: \$\{\{ secrets\.BASE_URL \}\}/);
  assert.match(y, /upload-artifact@v4/);
  assert.match(y, /path: playwright-report/);
});

test('GitLab CI: image, script with BASE_URL, artifacts', () => {
  const y = ci.gitlabCi('ts-playwright');
  assert.match(y, /^e2e:/m);
  assert.match(y, /image: node:20/);
  assert.match(y, /BASE_URL="\$BASE_URL" npx playwright test/);
  assert.match(y, /paths:\n\s+- playwright-report/);
});

test('python stack uses pytest and setup-python', () => {
  const gh = ci.githubActions('python');
  assert.match(gh, /setup-python@v5/);
  assert.match(gh, /pytest -q/);
  assert.match(ci.gitlabCi('python'), /image: python:3\.12/);
});

test('unknown stack falls back to ts-playwright', () => {
  assert.match(ci.githubActions('nope'), /npx playwright test/);
});

test('forProvider returns the right path and content', () => {
  assert.equal(ci.forProvider('github').path, '.github/workflows/e2e.yml');
  assert.equal(ci.forProvider('gitlab').path, '.gitlab-ci.yml');
  assert.match(ci.forProvider('gitlab', 'ts-playwright').content, /image: node:20/);
});
