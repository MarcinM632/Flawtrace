// lib/mcp-local-tools.js + mcp/flawtrace-server.js: the external MCP server's local, model-free tools, and the
// server wiring over stdio (initialize / tools/list / tools/call).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { TOOLS } = require('../lib/mcp-local-tools');

const byName = (n) => TOOLS.find((t) => t.name === n);

test('every tool has a name, description, schema and handler', () => {
  for (const t of TOOLS) {
    assert.ok(t.name && t.description && t.inputSchema && typeof t.handler === 'function', t.name);
    assert.equal(t.inputSchema.type, 'object');
  }
  for (const n of ['scan_repo', 'scan_transport', 'select_tests', 'ci_config']) assert.ok(byName(n), n);
});

test('scan_repo finds a planted secret in a folder', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-mcp-'));
  fs.writeFileSync(path.join(dir, 'config.js'), "const awsKey = 'AKIAIOSFODNN7EXAMPLE';\neval(userInput);");
  const out = await byName('scan_repo').handler({ path: dir });
  assert.match(out, /aws-access-key/);
  assert.match(out, /js-eval/);
});

test('select_tests returns the affected subset', async () => {
  const out = await byName('select_tests').handler({
    changed: ['src/billing/Invoice.ts'],
    tests: [{ id: 'checkout', touches: ['src/billing/'] }, { id: 'login', touches: ['src/auth/'] }],
  });
  assert.match(out, /checkout/);
  assert.ok(!/\blogin\b/.test(out.split('Skip:')[0]), 'login not in the run list');
  assert.match(out, /Skip: login/);
});

test('ci_config generates a pipeline', async () => {
  assert.match(await byName('ci_config').handler({ provider: 'github' }), /actions\/checkout@v4/);
  assert.match(await byName('ci_config').handler({ provider: 'gitlab' }), /image: node:20/);
});

test('scan_transport inspects a live URL', async () => {
  const srv = http.createServer((q, s) => { s.setHeader('Set-Cookie', 'sid=1'); s.end('{}'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const out = await byName('scan_transport').handler({ url: 'http://127.0.0.1:' + srv.address().port });
    assert.match(out, /cleartext-http/);
  } finally { srv.close(); }
});

// End-to-end: spawn the real MCP server and speak JSON-RPC over stdio.
let proc, rl, pending = new Map(), nextId = 1;
before(() => {
  proc = spawn('node', [path.join(__dirname, '..', 'mcp', 'flawtrace-server.js')], { stdio: ['pipe', 'pipe', 'inherit'] });
  const readline = require('readline').createInterface({ input: proc.stdout });
  rl = readline;
  readline.on('line', (line) => { let m; try { m = JSON.parse(line); } catch (_) { return; } if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
});
after(() => { if (rl) rl.close(); if (proc) proc.kill(); });
const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = nextId++; pending.set(id, resolve);
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout ' + method)); } }, 8000);
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});

test('server: initialize, lists local tools, and calls ci_config over stdio', async () => {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18' });
  assert.equal(init.result.serverInfo.name, 'flawtrace');
  const list = await rpc('tools/list', {});
  const names = list.result.tools.map((t) => t.name);
  for (const n of ['scan_repo', 'scan_transport', 'select_tests', 'ci_config']) assert.ok(names.includes(n), n + ' listed');
  assert.ok(names.includes('get_run'), 'app-proxy tools still present');
  const call = await rpc('tools/call', { name: 'ci_config', arguments: { provider: 'gitlab' } });
  assert.match(call.result.content[0].text, /image: node:20/);
  assert.ok(!call.result.isError);
});
