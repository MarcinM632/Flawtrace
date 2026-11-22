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

test('parseDevices: known presets only, no default', () => {
  assert.deepEqual(b.parseDevices(''), []);
  assert.deepEqual(b.parseDevices('iphone,pixel'), ['iphone', 'pixel']);
  assert.deepEqual(b.parseDevices('iphone, nokia3310'), ['iphone'], 'unknown dropped');
  assert.deepEqual(b.parseDevices('pixel pixel'), ['pixel'], 'deduped');
});

test('devicePlan: desktop default, mobile-only, and combined', () => {
  // Nothing set -> chromium desktop.
  const d0 = b.devicePlan({});
  assert.deepEqual(d0.install, ['chromium']);
  assert.match(d0.projectsSnippet, /name: 'chromium'/);
  // Mobile only (device set, browsers not explicit) -> no desktop, installs the devices' engines.
  const d1 = b.devicePlan({ devices: 'iphone,pixel' });
  assert.deepEqual(d1.mobile, ['iphone', 'pixel']);
  assert.deepEqual(d1.desktop, []);
  assert.deepEqual([...d1.install].sort(), ['chromium', 'webkit'], 'iphone->webkit, pixel->chromium');
  assert.match(d1.projectsSnippet, /name: 'iphone', use: \{ \.\.\.devices\['iPhone 13'\] \}/);
  assert.match(d1.projectsSnippet, /name: 'pixel', use: \{ \.\.\.devices\['Pixel 7'\] \}/);
  assert.ok(!/Desktop Chrome/.test(d1.projectsSnippet), 'no desktop project when only a device is requested');
  // Combined: explicit desktop browser + a device.
  const d2 = b.devicePlan({ browsers: 'firefox', devices: 'ipad', browsersSet: true });
  assert.deepEqual([...d2.install].sort(), ['firefox', 'webkit']);
  assert.match(d2.projectsSnippet, /name: 'firefox'/);
  assert.match(d2.projectsSnippet, /name: 'ipad'/);
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
