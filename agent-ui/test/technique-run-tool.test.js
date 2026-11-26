// Narzędzie technique_run_items serwera MCP "qa": elementy EP/BVA z projektu wykonane deterministycznie na
// środowisku, z asercjami na stanie, żądaniem kontrolnym (blocked zamiast fałszywego defektu) i logiem wywołań.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const shop = require('../bench/shop-app');

function callTool(env, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(__dirname, '..', 'mcp', 'api-server.js')], { env: { ...process.env, ...env } });
    let out = '';
    p.stdout.on('data', (d) => {
      out += d;
      const line = out.split('\n').find((l) => l.includes('"id":2'));
      if (line) { p.kill(); const j = JSON.parse(line); j.error ? reject(new Error(j.error.message)) : resolve(j.result); }
    });
    p.on('error', reject);
    const send = (o) => p.stdin.write(JSON.stringify(o) + '\n');
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'technique_run_items', arguments: args } });
    setTimeout(() => { p.kill(); reject(new Error('timeout: ' + out.slice(-300))); }, 20000);
  });
}

test('technique_run_items: wykrywa błędy granicy i zapis mimo odrzucenia, każde wywołanie w logu', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-tool-'));
  fs.writeFileSync(path.join(dir, 'shop.json'), JSON.stringify(shop.SPEC));
  const logFile = path.join(dir, 'calls.jsonl');
  const app = await shop.start({ bugs: new Set(['B1', 'B13']) });
  try {
    const env = { QA_SPECS_DIR: dir, API_BASE_URL: app.url, QA_SOURCES_FILE: path.join(dir, 'none.json'), QA_CALL_LOG: logFile };
    const res = await callTool(env, { ids: ['BVA:post-orders:quantity:max', 'BVA:post-orders:quantity:max+1', 'EP:post-orders:quantity:wrong-type', 'BVA:nope:x:y'] });
    const j = JSON.parse(res.content[0].text);
    assert.deepEqual(j.summary, { total: 3, pass: 1, fail: 2, blocked: 0, skip: 0 });
    assert.deepEqual(j.unknownIds, ['BVA:nope:x:y']);
    const fail = j.results.filter((x) => x.verdict === 'fail');
    assert.match(fail.find((x) => x.id.endsWith('max+1')).why, /forbids/);
    assert.match(fail.find((x) => x.id.endsWith('wrong-type')).why, /stored a record anyway/);
    const log = fs.readFileSync(logFile, 'utf8').trim().split('\n').map(JSON.parse);
    const refs = new Set(log.map((x) => x.ref));
    for (const r of j.results) for (const c of r.calls) assert.ok(refs.has(c), c);
    // Wzorzec odrzucony przez środowisko → blocked, nie defekt.
    const blocked = JSON.parse((await callTool(env, { endpoints: ['POST /orders'], base_body: { 'POST /orders': { currency: 'XXX' } } })).content[0].text);
    assert.equal(blocked.summary.blocked, blocked.summary.total);
    assert.equal(blocked.summary.fail, 0);
  } finally { await app.close(); }
});
