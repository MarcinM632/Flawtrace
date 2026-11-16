// A UI Tests run on the customer's own agent (ACP), through the real server, with a fake agent instead of an AI.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP = path.resolve(__dirname, '..');
let proc, base, dataDir;
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-ui-acp-'));
  fs.mkdirSync(path.join(dataDir, 'runs'));
  fs.writeFileSync(path.join(dataDir, 'bugs.json'), '[]');
  fs.writeFileSync(path.join(dataDir, 'jira-sync.json'), JSON.stringify({ lastTry: Date.now(), lastOk: Date.now(), lastComments: Date.now(), added: 0, found: 0, error: '' }));
  const fake = path.join(__dirname, 'fixtures', 'fake-acp-agent.js');
  fs.writeFileSync(path.join(dataDir, 'llm.json'), JSON.stringify({ provider: 'acp', acpPreset: 'custom', acpCommand: `"${process.execPath}" "${fake}"` }));
  const port = await freePort();
  base = 'http://127.0.0.1:' + port;
  proc = spawn('node', ['server.js'], { cwd: APP, env: { ...process.env, PORT: String(port), QA_DATA_DIR: dataDir, QA_API_KEY: 'k', JIRA_SYNC_MINUTES: '999999', QA_HEDGE_GUARD: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 20000);
    proc.stdout.on('data', (c) => { if (String(c).includes('Agent UI:')) { clearTimeout(t); resolve(); } });
    proc.on('exit', (code) => reject(new Error('server exited early: ' + code)));
  });
});
after(() => { if (proc) proc.kill(); try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) { /* temp */ } });

test('UI Tests runs on the configured ACP agent: events, denied write, no Claude Code', async () => {
  const start = await fetch(base + '/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent: 'uitest', ticket: 'Check that the start page shows a heading', url: 'http://localhost:9/' }) });
  assert.equal(start.status, 201, await start.clone().text());
  const { id } = await start.json();
  let run;
  for (let i = 0; i < 80; i++) {
    run = await (await fetch(base + '/api/runs/' + id)).json();
    if (run.meta.status !== 'running') break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.notEqual(run.meta.status, 'running', 'the run finished');
  const texts = run.events.map((e) => `${e.type}:${e.text}`).join('\n');
  assert.match(texts, /Running on your own agent/);
  assert.ok(run.events.some((e) => e.type === 'browser' && /navigate/i.test(e.text)), texts);
  assert.match(texts, /Denied/);
  assert.match(run.meta.report || run.meta.finalText || '', /REPORT: done/);
});
