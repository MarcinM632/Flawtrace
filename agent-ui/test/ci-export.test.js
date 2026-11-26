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

test('CI: osobny job mutation testing — ręcznie i co tydzień, nie na push; Node także dla stosu Python', () => {
  const ci = require('../lib/ci-export');
  const gh = ci.githubActions('python');
  assert.match(gh, /workflow_dispatch:/);
  assert.match(gh, /mutation:\n    if: github.event_name == 'workflow_dispatch' \|\| github.event_name == 'schedule'/);
  assert.match(gh, /test:\n    if: github.event_name == 'push' \|\| github.event_name == 'pull_request'/);
  assert.match(gh, /setup-node[\s\S]*node flawtrace-mutation.js --target "\$BASE_URL" --cmd "pytest -q"/);
  const gl = ci.gitlabCi('ts-playwright');
  assert.match(gl, /mutation:[\s\S]*when: manual[\s\S]*node flawtrace-mutation.js --target "\$BASE_URL" --cmd "npx playwright test"/);
  assert.doesNotMatch(gl, /apt-get install -y -qq nodejs/);
});
