// lib/browsers.js: browser selection for the generated Playwright run, and its effect on the config/install.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const b = require('../lib/browsers');
const uiRun = require('../lib/ui-run');

test('parse: defaults to chromium, drops unknowns, dedupes', () => {
  assert.deepEqual(b.parse(''), ['chromium']);
  assert.deepEqual(b.parse(undefined), ['chromium']);
  assert.deepEqual(b.parse('firefox'), ['firefox']);
  assert.deepEqual(b.parse('chromium, firefox webkit'), ['chromium', 'firefox', 'webkit']);
  assert.deepEqual(b.parse('safari,ie,opera'), ['chromium'], 'all unknown -> chromium');
  assert.deepEqual(b.parse('firefox,firefox'), ['firefox'], 'deduped');
});

test('installArgs and projectsSnippet reflect the chosen browsers', () => {
  assert.deepEqual(b.installArgs(['chromium', 'webkit']), ['playwright', 'install', 'chromium', 'webkit']);
  const snip = b.projectsSnippet(['chromium', 'firefox']);
  assert.match(snip, /name: 'chromium'/);
  assert.match(snip, /name: 'firefox'/);
  assert.match(snip, /devices\['Desktop Firefox'\]/);
});

test('default generated config stays chromium-only and valid', () => {
  assert.match(uiRun.CONFIG_SOURCE, /projects: \[\{ name: 'chromium'/);
  assert.match(uiRun.CONFIG_SOURCE, /import \{ defineConfig, devices \}/);
  for (const s of ["screenshot: 'on'", 'retries: 0', 'timeout: 20000']) assert.ok(uiRun.CONFIG_SOURCE.includes(s), s);
  // A multi-browser config lists all three.
  const multi = uiRun.configSource(['chromium', 'firefox', 'webkit']);
  assert.match(multi, /name: 'webkit'/);
  assert.match(multi, /name: 'firefox'/);
});
