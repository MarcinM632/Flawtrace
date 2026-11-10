// Jira read through the REST API: the data check in Sources, Workspace, releases, the bug registry and
// the defect history, all against a local fake of Jira Cloud.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-jira-'));
process.env.QA_DATA_DIR = dir;
process.env.QA_SOURCES_FILE = path.join(dir, 'sources.json');

const ISSUES = [
  { key: 'APP-1', fields: { summary: 'Login fails', status: { name: 'In Progress', statusCategory: { name: 'In Progress' } }, priority: { name: 'High' }, issuetype: { name: 'Story' }, components: [], comment: { total: 2 }, created: '2026-11-01T10:00:00.000+0000', fixVersions: [{ id: '10', name: '2.0', released: false, releaseDate: '2026-12-01' }] } },
  { key: 'APP-2', fields: { summary: 'Crash on save', status: { name: 'Done', statusCategory: { name: 'Done' } }, priority: { name: 'Low' }, issuetype: { name: 'Bug' }, created: '2026-10-01T10:00:00.000+0000', resolutiondate: '2026-10-05T10:00:00.000+0000', fixVersions: [{ id: '10', name: '2.0', released: false }] } },
  { key: 'APP-3', fields: { summary: 'Typo', status: { name: 'To Do', statusCategory: { name: 'To Do' } }, priority: { name: 'Medium' }, issuetype: { name: 'Bug' }, created: '2026-10-02T10:00:00.000+0000', fixVersions: [] } },
];

// A tiny JQL evaluator for the searches the app sends.
function match(jql, i) {
  const f = i.fields;
  if (/assignee = currentUser\(\)/.test(jql) && i.key !== 'APP-1') return false;
  if (/assignee = "acc-2"/.test(jql)) return i.key === 'APP-3';
  if (/statusCategory != Done/.test(jql) && f.status.statusCategory.name === 'Done') return false;
  if (/issuetype = Bug/.test(jql) && f.issuetype.name !== 'Bug') return false;
  if (/fixVersion = 10|unreleasedVersions/.test(jql) && !(f.fixVersions || []).some((v) => v.id === '10')) return false;
  return true;
}

let srv, base;
const seen = [];
before(async () => {
  srv = http.createServer((q, r) => {
    let b = '';
    q.on('data', (c) => { b += c; });
    q.on('end', () => {
      const u = new URL(q.url, 'http://x');
      seen.push(u.pathname);
      const send = (code, o) => { r.writeHead(code, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
      if (q.headers.authorization !== 'Basic ' + Buffer.from('qa@example.com:tok').toString('base64')) return send(401, { errorMessages: ['no'] });
      if (u.pathname === '/rest/api/2/myself') return send(200, { displayName: 'QA Tester', emailAddress: 'qa@example.com' });
      if (u.pathname === '/rest/api/3/search/jql') {
        const jql = u.searchParams.get('jql');
        const all = ISSUES.filter((i) => match(jql, i));
        // One issue per page, to prove that pages are followed.
        const at = Number(u.searchParams.get('nextPageToken') || 0);
        const max = Number(u.searchParams.get('maxResults'));
        const page = all.slice(at, at + Math.min(1, max));
        return send(200, { issues: page, ...(at + 1 < all.length ? { nextPageToken: String(at + 1), isLast: false } : { isLast: true }) });
      }
      if (u.pathname === '/rest/api/3/search/approximate-count') return send(200, { count: ISSUES.filter((i) => match(JSON.parse(b).jql, i)).length });
      if (u.pathname === '/rest/api/2/project/APP') return send(200, { key: 'APP', name: 'The App' });
      if (u.pathname === '/rest/api/2/project/APP/versions') return send(200, [{ id: '10', name: '2.0', released: false, releaseDate: '2026-12-01' }, { id: '9', name: '1.0', released: true }]);
      if (u.pathname === '/rest/api/2/project/NOPE') return send(404, { errorMessages: ['No project could be found with key NOPE.'] });
      if (u.pathname === '/rest/api/2/user/search') return send(200, /jane/i.test(u.searchParams.get('query') || '') ? [{ accountId: 'acc-2', displayName: 'Jane Doe', active: true }] : []);
      if (u.pathname === '/rest/api/2/issue/APP-1') return send(200, { key: 'APP-1', fields: { ...ISSUES[0].fields, description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'User cannot sign in.' }] }] }, comment: { comments: [] }, subtasks: [] } });
      send(404, {});
    });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  base = 'http://127.0.0.1:' + srv.address().port;
  fs.writeFileSync(process.env.QA_SOURCES_FILE, JSON.stringify({ jira: { url: base, email: 'qa@example.com', token: 'tok', projects: 'APP, NOPE' } }));
});
after(() => { srv.close(); });

test('Jira check: account, projects, releases, my tasks, a person and a ticket, each with its JQL and a Jira link', async () => {
  const src = require('../lib/sources');
  assert.equal(src.jiraRest(), true);
  assert.deepEqual(src.jiraProjectMap(), { APP: 'core', NOPE: 'svc' });
  const r = await src.jiraCheck({ person: 'jane', key: 'app-1' });
  assert.deepEqual(r.account, { name: 'QA Tester', email: 'qa@example.com' });
  const app = r.projects.find((p) => p.key === 'APP');
  assert.equal(app.name, 'The App');
  assert.equal(app.open.count, 2);
  assert.equal(app.bugs.count, 2);
  assert.deepEqual(app.releases.map((v) => [v.name, v.count]), [['2.0', 2]]);
  assert.match(app.releases[0].link, new RegExp('^' + base + '/issues/\\?jql='));
  assert.match(r.projects.find((p) => p.key === 'NOPE').error, /Jira has no project NOPE/);
  assert.equal(r.mine.count, 1);
  assert.deepEqual(r.mine.sample.map((i) => i.key), ['APP-1']);
  assert.match(r.mine.jql, /assignee = currentUser\(\)/);
  assert.equal(r.person.user.name, 'Jane Doe');
  assert.deepEqual(r.person.tasks.sample.map((i) => i.key), ['APP-3']);
  assert.match(r.ticket.text, /APP-1 — Login fails[\s\S]*User cannot sign in\./);
});

test('Workspace, releases, the bug registry and the defect history load from the Jira in Sources', async () => {
  const workspace = require('../lib/workspace');
  await workspace.refresh(true);
  assert.equal(workspace.state.ok, true, workspace.state.error);
  assert.deepEqual(workspace.state.tasks.map((t) => [t.key, t.agent, t.comments]), [['APP-1', 'core', 2]]);

  const monitor = require('../lib/test-monitor');
  assert.deepEqual(Object.keys(monitor.PROJECTS), ['core', 'svc']);
  await monitor.refreshRelease('core');
  const snap = monitor.snapshot('core');
  assert.equal(snap.releaseOk, true, snap.releaseError);
  assert.deepEqual(snap.releases.map((v) => [v.name, v.metrics.total, v.metrics.done]), [['2.0', 2, 1]]);
  assert.equal(snap.currentReleaseName, '2.0');

  const defects = require('../lib/defect-lifecycle');
  await defects.refresh(true);
  assert.equal(defects.state.ok, true, defects.state.error);
  assert.deepEqual(defects.state.issues.map((i) => [i.key, !!i.resolved]), [['APP-2', true], ['APP-3', false]]);

  const bugs = require('../lib/bugs');
  bugs.jiraSync(true, true);
  for (let i = 0; i < 100 && bugs.jira.state === 'running'; i++) await new Promise((ok) => setTimeout(ok, 20));
  assert.equal(bugs.jira.error, '');
  assert.deepEqual(bugs.bugs.filter((b) => b.source.startsWith('jira:')).map((b) => b.ticket).sort(), ['APP-2', 'APP-3']);
  assert.ok(!seen.some((p) => /claude/.test(p)));
});
