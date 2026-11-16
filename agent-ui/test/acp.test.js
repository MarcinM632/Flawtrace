// ACP client against a fake agent that speaks the real wire format.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { allowPolicy, runAcp, toAcpServers } = require('../lib/acp');

const AGENT = { command: process.execPath, args: [path.join(__dirname, 'fixtures', 'fake-acp-agent.js')], cwd: __dirname };

test('a task runs end to end: system prompt first, MCP servers passed, events streamed, permissions enforced', async () => {
  const uses = [], results = [], status = [];
  const mcp = toAcpServers({ playwright: { command: 'npx', args: ['-y', 'x'], env: { A: '1' } } });
  const r = await runAcp({ ...AGENT, mcpServers: mcp, systemPrompt: 'SYSTEM', prompt: 'TASK', allow: allowPolicy(['mcp__playwright__browser_navigate']),
    onToolUse: (t) => uses.push(t.name), onToolResult: (t) => results.push([t.id, t.error]), onStatus: (s) => status.push(s) });
  assert.equal(r.error, null);
  assert.equal(r.stopReason, 'end_turn');
  assert.ok(r.lastText.startsWith('REPORT: done.'), r.lastText);
  assert.ok(r.text.includes('Looking at the page.'));
  assert.ok(r.lastText.includes('"name":"playwright"') && r.lastText.includes('{"name":"A","value":"1"}'), 'servers reach the agent in the ACP shape');
  assert.deepEqual(uses, ['mcp__playwright__browser_navigate', 'mcp__playwright__write_file']);
  assert.deepEqual(results, [['browser_navigate', false], ['write_file', true]], 'the allowlisted tool ran, the write was denied');
  assert.ok(status.some((s) => /Denied/.test(s)));
});

test('a timeout and a cancel both end a task that never answers', async () => {
  const t = await runAcp({ ...AGENT, prompt: 'HANG', allow: () => false, timeoutMs: 800 });
  assert.equal(t.timedOut, true);
  let cancel = false; setTimeout(() => { cancel = true; }, 300);
  const c = await runAcp({ ...AGENT, prompt: 'HANG', allow: () => false, isCancelled: () => cancel });
  assert.equal(c.cancelled, true);
});

test('a missing agent command is reported, not thrown', async () => {
  const r = await runAcp({ command: 'definitely-not-installed-xyz', args: [], cwd: __dirname, prompt: 'x', allow: () => false });
  assert.ok(r.error && /agent/i.test(r.error), r.error);
});

test('the policy allows read-only kinds and allowlisted names, denies writing and running', () => {
  const allow = allowPolicy(['mcp__playwright__browser_click']);
  assert.equal(allow({ name: 'x', title: 'browser_click', kind: 'other' }), true);
  assert.equal(allow({ name: 'Read', title: 'Read file', kind: 'read' }), true);
  assert.equal(allow({ name: 'Write', title: 'Write file', kind: 'edit' }), false);
  assert.equal(allow({ name: 'Bash', title: 'rm -rf', kind: 'execute' }), false);
});
