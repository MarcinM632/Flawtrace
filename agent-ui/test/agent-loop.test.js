// The agent loop for API-key providers, against local fake providers (Anthropic, OpenAI and Gemini wire formats)
// and a fake MCP server. No real model is called.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runLoop, allowedBy, providerName, fileTools, trimContext } = require('../lib/agent-loop');
const { geminiSchema } = require('../lib/llm/chat');

const FAKE = { command: process.execPath, args: [path.join(__dirname, 'fixtures', 'fake-mcp.js')] };
let server, base, script, seen, tmp;

// A scripted provider: `script` is a list of replies per wire format; every request is recorded in `seen`.
before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-loop-'));
  fs.writeFileSync(path.join(tmp, 'a.txt'), 'line one\nline two needle\nline three\n');
  fs.mkdirSync(path.join(tmp, 'sub')); fs.writeFileSync(path.join(tmp, 'sub', 'b.java'), 'class B { /* needle */ }\n');
  server = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const j = JSON.parse(body || '{}'); seen.push({ url: req.url, headers: req.headers, body: j });
      const reply = script.shift();
      if (!reply) { res.writeHead(500); return res.end('{"error":{"message":"script exhausted"}}'); }
      if (reply.status) { res.writeHead(reply.status, { 'content-type': 'application/json', ...(reply.headers || {}) }); return res.end(JSON.stringify(reply.json || { error: { message: 'fail' } })); }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(reply));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => { server.close(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* temp */ } });

const anth = (blocks, stop) => ({ content: blocks, stop_reason: stop, usage: { input_tokens: 10, output_tokens: 5 } });
const run = (extra) => { seen = []; return runLoop({ provider: { id: 'anthropic', key: 'sk-secret', model: 'm', baseUrl: base }, system: 'SYS', prompt: 'do it', mcpServers: { fake: FAKE }, cwd: tmp, allow: ['mcp__fake__echo', 'mcp__fake__boom', 'mcp__fake__big'], timeoutMs: 20000, ...extra }); };

test('Anthropic: tool call, result goes back, final report is returned', async () => {
  script = [
    anth([{ type: 'text', text: 'Calling' }, { type: 'tool_use', id: 't1', name: 'mcp__fake__echo', input: { text: 'hi' } }], 'tool_use'),
    anth([{ type: 'text', text: '## Report\nall good' }], 'end_turn'),
  ];
  const uses = [], results = [];
  const r = await run({ onToolUse: (t) => uses.push(t), onToolResult: (t) => results.push(t) });
  assert.equal(r.error, null);
  assert.equal(r.stopReason, 'end_turn');
  assert.equal(r.lastText, '## Report\nall good');
  assert.equal(uses[0].name, 'mcp__fake__echo');
  assert.equal(results[0].text, 'echo:hi');
  assert.equal(r.usage.input, 20); assert.equal(r.usage.output, 10);
  // The second request carries the tool result, and the key travels only in the header.
  const second = seen[1].body.messages;
  assert.equal(second[2].content[0].type, 'tool_result');
  assert.equal(second[2].content[0].tool_use_id, 't1');
  assert.equal(seen[0].headers['x-api-key'], 'sk-secret');
});

test('only allowlisted tools are offered, and a call to another one is refused', async () => {
  script = [
    anth([{ type: 'tool_use', id: 't1', name: 'mcp__fake__secret_tool', input: {} }], 'tool_use'),
    anth([{ type: 'text', text: 'done' }], 'end_turn'),
  ];
  const results = [];
  await run({ onToolResult: (t) => results.push(t) });
  const offered = seen[0].body.tools.map((t) => t.name);
  assert.deepEqual(offered.sort(), ['mcp__fake__big', 'mcp__fake__boom', 'mcp__fake__echo']);
  assert.match(results[0].text, /Unknown tool/);
  assert.equal(results[0].error, true);
});

test('a failing tool is reported to the model as an error, not a crash', async () => {
  script = [anth([{ type: 'tool_use', id: 't1', name: 'mcp__fake__boom', input: {} }], 'tool_use'), anth([{ type: 'text', text: 'ok' }], 'end_turn')];
  const results = [];
  const r = await run({ onToolResult: (t) => results.push(t) });
  assert.equal(r.error, null);
  assert.equal(results[0].error, true);
  assert.match(results[0].text, /boom happened/);
  assert.equal(seen[1].body.messages[2].content[0].is_error, true);
});

test('a huge tool answer is cut before it reaches the model', async () => {
  script = [anth([{ type: 'tool_use', id: 't1', name: 'mcp__fake__big', input: {} }], 'tool_use'), anth([{ type: 'text', text: 'ok' }], 'end_turn')];
  const results = [];
  await run({ onToolResult: (t) => results.push(t) });
  assert.ok(results[0].text.length < 45000);
  assert.match(results[0].text, /cut/);
});

test('step limit stops a loop that never ends', async () => {
  script = Array.from({ length: 10 }, (_, i) => anth([{ type: 'tool_use', id: 't' + i, name: 'mcp__fake__echo', input: { text: 'again' } }], 'tool_use'));
  const r = await run({ maxSteps: 3 });
  assert.equal(r.stopReason, 'max_steps');
  assert.match(r.error, /3 steps/);
  assert.equal(r.steps, 3);
});

test('token limit stops the run', async () => {
  script = Array.from({ length: 10 }, (_, i) => anth([{ type: 'tool_use', id: 't' + i, name: 'mcp__fake__echo', input: { text: 'x' } }], 'tool_use'));
  const r = await run({ maxTokens: 20 });
  assert.equal(r.stopReason, 'max_tokens');
});

test('429 is retried, and the key never appears in an error', async () => {
  script = [{ status: 429, headers: { 'retry-after': '0' }, json: { error: { message: 'slow down' } } }, anth([{ type: 'text', text: 'after retry' }], 'end_turn')];
  const r = await run({});
  assert.equal(r.lastText, 'after retry');
  script = [{ status: 401, json: { error: { message: 'bad key sk-secret' } } }];
  const bad = await run({});
  assert.match(bad.error, /HTTP 401/);
  assert.ok(!bad.error.includes('sk-secret'), bad.error);
});

test('cancel stops the loop', async () => {
  script = Array.from({ length: 50 }, (_, i) => anth([{ type: 'tool_use', id: 't' + i, name: 'mcp__fake__echo', input: { text: 'x' } }], 'tool_use'));
  let n = 0;
  const r = await run({ isCancelled: () => n > 2, onToolUse: () => { n++; } });
  assert.equal(r.cancelled, true);
  assert.ok(r.steps < 50);
});

test('OpenAI format: tool_calls round trip', async () => {
  seen = [];
  script = [
    { choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'mcp__fake__echo', arguments: '{"text":"yo"}' } }] } }], usage: { prompt_tokens: 7, completion_tokens: 3 } },
    { choices: [{ finish_reason: 'stop', message: { content: 'final' } }], usage: { prompt_tokens: 9, completion_tokens: 1 } },
  ];
  const r = await runLoop({ provider: { id: 'openai-compatible', key: '', model: 'm', baseUrl: base }, system: 'SYS', prompt: 'go', mcpServers: { fake: FAKE }, cwd: tmp, allow: ['mcp__fake'], timeoutMs: 20000 });
  assert.equal(r.lastText, 'final');
  assert.equal(seen[1].body.messages.at(-1).role, 'tool');
  assert.equal(seen[1].body.messages.at(-1).content, 'echo:yo');
  assert.equal(seen[1].body.messages.at(-2).tool_calls[0].function.arguments, '{"text":"yo"}');
  assert.equal(seen[0].headers.authorization, undefined);
});

test('Gemini format: functionCall parts are replayed exactly and the schema is simplified', async () => {
  seen = [];
  const callParts = [{ functionCall: { name: 'mcp__fake__echo', args: { text: 'g' } }, thoughtSignature: 'SIG' }];
  script = [
    { candidates: [{ content: { role: 'model', parts: callParts } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 } },
    { candidates: [{ content: { role: 'model', parts: [{ text: 'gemini done' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 2 } },
  ];
  const r = await runLoop({ provider: { id: 'gemini', key: 'gk', model: 'gm', baseUrl: base }, system: 'SYS', prompt: 'go', mcpServers: { fake: FAKE }, cwd: tmp, allow: ['mcp__fake__echo'], timeoutMs: 20000 });
  assert.equal(r.lastText, 'gemini done');
  assert.equal(seen[0].headers['x-goog-api-key'], 'gk');
  const modelTurn = seen[1].body.contents.find((c) => c.role === 'model');
  assert.equal(modelTurn.parts[0].thoughtSignature, 'SIG');
  assert.equal(seen[1].body.contents.at(-1).parts[0].functionResponse.response.result, 'echo:g');
});

test('geminiSchema flattens unions and drops unsupported keywords', () => {
  const s = geminiSchema({ type: 'object', $schema: 'x', additionalProperties: false, properties: { a: { type: ['string', 'null'] }, b: { anyOf: [{ type: 'integer' }, { type: 'null' }] }, c: { type: 'array' } }, required: ['a', 'zzz'] });
  assert.equal(s.additionalProperties, undefined);
  assert.equal(s.properties.a.nullable, true); assert.equal(s.properties.a.type, 'string');
  assert.equal(s.properties.b.type, 'integer'); assert.equal(s.properties.b.nullable, true);
  assert.deepEqual(s.properties.c.items, { type: 'string' });
  assert.deepEqual(s.required, ['a']);
});

test('names: long and odd names get a valid alias, allowlist prefixes work', () => {
  const used = new Set();
  const long = 'mcp__qa__' + 'x'.repeat(80);
  const n = providerName(long, used);
  assert.ok(/^[A-Za-z0-9_-]{1,64}$/.test(n));
  assert.notEqual(providerName(long, used), n);
  const ok = allowedBy(['mcp__qa', 'mcp__sources__knowledge_*', 'mcp__web__exact']);
  assert.ok(ok('mcp__qa__anything'));
  assert.ok(!ok('mcp__qax__anything'));
  assert.ok(ok('mcp__sources__knowledge_search'));
  assert.ok(!ok('mcp__sources__jira_get'));
  assert.ok(ok('mcp__web__exact'));
});

test('file tools read inside the allowed folder only', () => {
  const t = fileTools([tmp], tmp);
  assert.match(t.Read.run({ path: 'a.txt' }), /2\tline two needle/);
  assert.throws(() => t.Read.run({ path: path.join(tmp, '..') }), /Outside/);
  assert.throws(() => t.Read.run({ path: '../../etc/passwd' }), /Outside|Not found/);
  assert.match(t.Grep.run({ pattern: 'needle' }), /a\.txt:2:/);
  assert.match(t.Grep.run({ pattern: 'needle', glob: '*.java' }), /b\.java:1/);
  assert.ok(!/a\.txt/.test(t.Grep.run({ pattern: 'needle', glob: '*.java' })));
  assert.match(t.Glob.run({ pattern: '**/*.java' }), /sub\/b\.java/);
});

test('old tool answers are dropped when the conversation is long, the newest stay', () => {
  const msgs = [{ role: 'user', text: 'x' }];
  for (let i = 0; i < 20; i++) msgs.push({ role: 'tool', results: [{ id: 'i' + i, name: 'n', text: 'y'.repeat(60000) }] });
  const dropped = trimContext(msgs);
  assert.ok(dropped > 0);
  assert.equal(msgs.at(-1).results[0].text.length, 60000);
  assert.match(msgs[1].results[0].text, /removed/);
});
