// lib/self-heal.js: classify a Playwright failure and recommend re-driving from intent vs patching.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sh = require('../lib/self-heal');

test('classify maps Playwright errors to classes', () => {
  assert.equal(sh.classify('Error: locator.click: Timeout 8000ms exceeded.\nwaiting for locator(\'#buy\')'), 'locator');
  assert.equal(sh.classify('strict mode violation: resolved to 3 elements'), 'locator');
  assert.equal(sh.classify('page.goto: net::ERR_CONNECTION_REFUSED'), 'navigation');
  assert.equal(sh.classify('Expected substring: "Pro"\nReceived string: "Free"\nexpect(received).toContainText'), 'assertion');
  assert.equal(sh.classify('Timeout of 20000ms exceeded.'), 'timeout');
  assert.equal(sh.classify('some unrecognized thing'), 'unknown');
});

test('recommend: UI change with intent -> re-drive', () => {
  const r = sh.recommend({ failures: ["waiting for locator('#checkout')"], hasIntent: true });
  assert.equal(r.action, 'redrive');
  assert.equal(r.dominant, 'locator');
});

test('recommend: UI change without intent -> patch selectors', () => {
  assert.equal(sh.recommend({ failures: ['strict mode violation'], hasIntent: false }).action, 'patch');
});

test('recommend: assertion drift -> patch regardless of intent', () => {
  assert.equal(sh.recommend({ failures: ['expect(received).toHaveText'], hasIntent: true }).action, 'patch');
});

test('recommend: no failures -> investigate', () => {
  assert.equal(sh.recommend({ failures: [], hasIntent: true }).action, 'investigate');
  assert.equal(sh.recommend({}).action, 'investigate');
});

test('recommend: timeout with intent re-drives, without investigates', () => {
  assert.equal(sh.recommend({ failures: ['Timed out'], hasIntent: true }).action, 'redrive');
  assert.equal(sh.recommend({ failures: ['Timed out'], hasIntent: false }).action, 'investigate');
});

test('intentFrom reads accepted.intent / intent / flow', () => {
  assert.equal(sh.intentFrom({ accepted: { intent: 'go buy pro' } }), 'go buy pro');
  assert.equal(sh.intentFrom({ intent: 'x' }), 'x');
  assert.equal(sh.intentFrom({ flow: 'y' }), 'y');
  assert.equal(sh.intentFrom({}), '');
  assert.equal(sh.intentFrom(null), '');
});

test('summary reads naturally', () => {
  assert.match(sh.summary(sh.recommend({ failures: ["waiting for locator('#x')"], hasIntent: true })), /Re-drive from intent/);
});
