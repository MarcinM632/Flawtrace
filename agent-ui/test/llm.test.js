// AI provider structure: request shapes of each provider against a local stub, key handling, default stays Claude Code.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-llm-'));
process.env.QA_DATA_DIR = dataDir;
delete process.env.QA_LLM;
const llm = require('../lib/llm');

let stub, base; const seen = [];
before(async () => {
  stub = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      seen.push({ url: req.url, headers: req.headers, body: JSON.parse(b || '{}') });
      res.setHeader('content-type', 'application/json');
      if (req.headers['x-api-key'] === 'bad' || req.headers.authorization === 'Bearer bad') { res.statusCode = 401; return res.end(JSON.stringify({ error: { message: 'invalid key bad' } })); }
      if (req.url.startsWith('/v1/messages')) return res.end(JSON.stringify({ content: [{ text: 'A-OK' }], usage: { input_tokens: 3, output_tokens: 1 } }));
      if (req.url.includes(':generateContent')) return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'G-OK' }] } }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 } }));
      res.end(JSON.stringify({ choices: [{ message: { content: 'O-OK' } }], usage: { prompt_tokens: 5, completion_tokens: 1 } }));
    });
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + stub.address().port;
});
after(() => { stub.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('the default is Claude Code and needs no key', () => {
  const v = llm.view();
  assert.equal(v.selected, 'claude-cli');
  assert.ok(v.providers.find((p) => p.id === 'claude-cli').agents);
  assert.ok(!v.providers.filter((p) => !['claude-cli', 'acp'].includes(p.id)).some((p) => p.agents), 'API providers do not drive agents yet');
});

test('each provider sends its own request shape with the user key and reads text and usage', async () => {
  llm.update({ provider: 'anthropic', model: 'm1', baseUrl: base, key: 'k-anthropic' });
  let r = await llm.complete('SYS', 'IN');
  assert.deepEqual([r.text, r.usage.input, r.usage.output], ['A-OK', 3, 1]);
  let s = seen.at(-1); assert.equal(s.headers['x-api-key'], 'k-anthropic'); assert.equal(s.body.system, 'SYS'); assert.equal(s.body.messages[0].content, 'IN');

  llm.update({ provider: 'openai', model: 'm2', baseUrl: base, key: 'k-openai' });
  r = await llm.complete('SYS', 'IN'); assert.equal(r.text, 'O-OK');
  s = seen.at(-1); assert.equal(s.url, '/chat/completions'); assert.equal(s.headers.authorization, 'Bearer k-openai'); assert.equal(s.body.messages[0].role, 'system');

  llm.update({ provider: 'gemini', model: 'm3', baseUrl: base, key: 'k-gemini' });
  r = await llm.complete('SYS', 'IN'); assert.equal(r.text, 'G-OK');
  s = seen.at(-1); assert.equal(s.headers['x-goog-api-key'], 'k-gemini'); assert.ok(!s.url.includes('k-gemini'), 'key never in the URL');

  llm.update({ provider: 'openai-compatible', model: 'local', baseUrl: base });
  r = await llm.complete('SYS', 'IN'); assert.equal(r.text, 'O-OK');
});

test('the key is never returned and never appears in an error', async () => {
  llm.update({ provider: 'anthropic', model: 'm1', baseUrl: base, key: 'bad' });
  const v = llm.view();
  assert.equal(v.keySet, true);
  assert.ok(!JSON.stringify(v).includes('bad'), 'no raw key in the view');
  await assert.rejects(() => llm.complete('S', 'I'), (e) => !e.message.includes('bad') || e.message.includes('***') ? true : false);
  const err = await llm.complete('S', 'I').catch((e) => e.message);
  assert.ok(!/\bbad\b/.test(err.replace('invalid key ***', '')), err);
  assert.ok(fs.existsSync(path.join(dataDir, 'llm.json')));
});

test('missing key or model gives a clear message, and bad input is rejected', async () => {
  llm.update({ provider: 'openai', model: '', baseUrl: base, clearKey: true });
  await assert.rejects(() => llm.complete('S', 'I'), /No API key/);
  llm.update({ provider: 'openai', model: '', baseUrl: base, key: 'k' });
  await assert.rejects(() => llm.complete('S', 'I'), /model name/);
  assert.throws(() => llm.update({ provider: 'nope' }), /Unknown provider/);
  assert.throws(() => llm.update({ provider: 'openai', baseUrl: 'ftp://x' }), /http/);
});

test('your own agent (ACP): presets, a custom command with a quoted path, and the runner per agent', () => {
  llm.update({ provider: 'acp', acpPreset: 'claude' });
  assert.deepEqual(llm.runnerFor('uitest'), { kind: 'acp', command: 'npx', args: ['-y', '@agentclientprotocol/claude-agent-acp'], label: 'Claude Code' });
  const other = llm.runnerFor('qamcp');
  assert.equal(other.kind, 'claude-cli');
  assert.match(other.note, /not available on your own agent/);
  llm.update({ provider: 'acp', acpPreset: 'custom', acpCommand: '"C:/Program Files/x/agent.exe" --acp' });
  const r = llm.runnerFor('uitest');
  assert.equal(r.command, 'C:/Program Files/x/agent.exe');
  assert.deepEqual(r.args, ['--acp']);
  llm.update({ provider: 'acp', acpPreset: 'custom', acpCommand: '' });
  assert.match(llm.runnerFor('uitest').note, /No agent command/);
  llm.update({ provider: 'claude-cli' });
  assert.deepEqual(llm.runnerFor('uitest'), { kind: 'claude-cli' });
});
