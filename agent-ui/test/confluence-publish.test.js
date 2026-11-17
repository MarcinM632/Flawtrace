// Publishing a Full tests page to Confluence: create, update by title, parent by title, and every failure comes back as words.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-conf-'));
process.env.QA_DATA_DIR = dir;
process.env.QA_SOURCES_FILE = path.join(dir, 'sources.json');
delete process.env.CONFLUENCE_URL; delete process.env.JIRA_URL;
const src = require('../lib/sources');

let srv, base; const calls = []; let mode = 'ok';
const pages = new Map(); // title -> { id, version }
before(async () => {
  srv = http.createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      const body = raw ? JSON.parse(raw) : null;
      calls.push({ method: req.method, path: u.pathname, q: Object.fromEntries(u.searchParams), body });
      if (mode === 'forbidden' && req.method !== 'GET') return send(403, { message: 'no' });
      if (req.method === 'GET' && u.pathname === '/wiki/rest/api/content') {
        const t = u.searchParams.get('title'); const p = pages.get(t);
        return send(200, { results: p ? [{ id: p.id, version: { number: p.version } }] : t === 'Reports' ? [{ id: '77', version: { number: 1 } }] : [] });
      }
      if (req.method === 'POST' && u.pathname === '/wiki/rest/api/content') { pages.set(body.title, { id: '100', version: 1 }); return send(200, { id: '100', _links: { webui: '/spaces/QA/pages/100' } }); }
      if (req.method === 'PUT' && u.pathname === '/wiki/rest/api/content/100') { pages.get(body.title).version = body.version.number; return send(200, { id: '100', _links: { webui: '/spaces/QA/pages/100' } }); }
      send(404, {});
    });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  base = 'http://127.0.0.1:' + srv.address().port;
  const conf = (extra) => fs.writeFileSync(process.env.QA_SOURCES_FILE, JSON.stringify({ confluence: { url: base + '/wiki', email: 'qa@example.com', token: 'tok', ...extra } }));
  global.__conf = conf;
});
after(() => srv.close());

test('not ready until Confluence is connected and a space is set, and nothing is sent', async () => {
  fs.writeFileSync(process.env.QA_SOURCES_FILE, '{}');
  assert.equal(src.confluencePublishTarget().ready, false); assert.match(src.confluencePublishTarget().reason, /not connected/);
  await assert.rejects(() => src.confluencePublish({ title: 'x', html: '<p>x</p>' }), /not connected/);
  global.__conf({});
  assert.match(src.confluencePublishTarget().reason, /space key/);
  assert.equal(calls.length, 0);
});

test('creates the page under a parent found by title, then updates the same page instead of duplicating it', async () => {
  global.__conf({ publishSpace: 'QA', publishParent: 'Reports' });
  const t = src.confluencePublishTarget(); assert.deepEqual([t.ready, t.space, t.parent], [true, 'QA', 'Reports']);
  const first = await src.confluencePublish({ title: 'Full test: DEMO-1', html: '<h2>Summary</h2>' });
  assert.deepEqual([first.id, first.created, first.url], ['100', true, base + '/wiki/spaces/QA/pages/100']);
  const post = calls.find((c) => c.method === 'POST');
  assert.deepEqual(post.body.ancestors, [{ id: '77' }]); assert.equal(post.body.space.key, 'QA'); assert.equal(post.body.body.storage.representation, 'storage');
  const second = await src.confluencePublish({ title: 'Full test: DEMO-1', html: '<h2>Summary v2</h2>' });
  assert.equal(second.created, false);
  const put = calls.find((c) => c.method === 'PUT'); assert.equal(put.body.version.number, 2);
  assert.equal(calls.filter((c) => c.method === 'POST').length, 1, 'no second page');
});

test('a token without write permission is an Error with words for the user, not a crash', async () => {
  global.__conf({ publishSpace: 'QA' }); mode = 'forbidden';
  await assert.rejects(() => src.confluencePublish({ title: 'Another page', html: '<p>x</p>' }), /no permission to write/);
  mode = 'ok';
});

test('the Sources form keeps the publish fields', () => {
  const v = src.save({ confluence: { publishSpace: ' QA ', publishParent: ' 123 ' } });
  assert.equal(v.confluence.publishSpace, 'QA'); assert.equal(v.confluence.publishParent, '123');
});
