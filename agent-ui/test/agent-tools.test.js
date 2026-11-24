// The restricted tools of the agent loop: Bash that is not a shell, Write/Edit jail, Skill, sub-agents.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { shellTool, skillTool, tokenize, writeTools } = require('../lib/agent-tools');
const { runLoop } = require('../lib/agent-loop');

let tmp, work, agentDir, qaGit, validator, outside;
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-tools-'));
  work = path.join(tmp, 'work'); agentDir = path.join(tmp, 'agent'); outside = path.join(tmp, 'other-customer');
  fs.mkdirSync(work); fs.mkdirSync(path.join(agentDir, '.claude', 'skills', 'demo', 'scripts'), { recursive: true }); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'other customers data');
  qaGit = path.join(tmp, 'qa-git.sh');
  fs.writeFileSync(qaGit, '#!/usr/bin/env bash\necho "qa-git args: $*"\n');
  validator = path.join(agentDir, '.claude', 'skills', 'demo', 'scripts', 'validate-demo.sh');
  fs.writeFileSync(validator, '#!/usr/bin/env bash\necho "DEMO OK $*"\n');
  fs.writeFileSync(path.join(agentDir, '.claude', 'skills', 'demo', 'SKILL.md'), '# Demo skill\nDo the thing.');
  fs.writeFileSync(path.join(agentDir, '.claude', 'skills', 'demo', 'evil.sh'), '#!/usr/bin/env bash\necho evil\n');
});
after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* temp */ } });

const sh = () => shellTool({ cwd: agentDir, workDir: work, qaGit, validateRoots: [path.join(agentDir, '.claude', 'skills')], env: process.env });
const bad = (re, cmd) => assert.rejects(sh().run({ command: cmd }), re, cmd);

test('tokenize: quotes kept, regex with a pipe inside quotes is one word, operators outside quotes are refused', () => {
  assert.deepEqual(tokenize('bash "/a b/x.sh" find "foo|bar"').words, ['bash', '/a b/x.sh', 'find', 'foo|bar']);
  assert.deepEqual(tokenize("bash x.sh 'a;b'").words, ['bash', 'x.sh', 'a;b']);
  for (const c of ['bash x.sh && ls', 'bash x.sh | cat', 'bash x.sh > f', 'bash x.sh; ls', 'bash $(x)', 'bash `x`', 'bash x.sh *', 'bash x.sh\nls']) assert.ok(tokenize(c).error, c);
  assert.ok(tokenize('bash "unclosed').error);
});

test('Bash runs qa-git.sh and the validate script, nothing else', async () => {
  const a = await sh().run({ command: `bash "${qaGit.split(path.sep).join('/')}" find "foo|bar"` });
  assert.match(a, /qa-git args: find foo\|bar/);
  const b = await sh().run({ command: `bash .claude/skills/demo/scripts/validate-demo.sh --report "${work.split(path.sep).join('/')}/r.txt"` });
  assert.match(b, /DEMO OK --report/);
  await bad(/not allowed/i, 'bash .claude/skills/demo/evil.sh');
  await bad(/Only commands of the form/, 'ls -la');
  await bad(/Only commands of the form/, 'cat /etc/passwd');
  await bad(/Not allowed/, 'bash x.sh && cat /etc/passwd');
  await bad(/not allowed|not found/i, 'bash /bin/sh');
  await bad(/Script not found|not allowed/i, 'bash ../../../etc/passwd'); // exists on Linux (not allowed), not on Windows (not found)
});

test('Bash: a validator may only look at files of the run, qa-git prepare only writes into the run folder', async () => {
  await bad(/inside the working folder/, `bash .claude/skills/demo/scripts/validate-demo.sh --report "${outside.split(path.sep).join('/')}/secret.txt"`);
  await bad(/inside the working folder/, `bash .claude/skills/demo/scripts/validate-demo.sh --report ../../other-customer/secret.txt`);
  const ok = await sh().run({ command: `bash "${qaGit.split(path.sep).join('/')}" prepare my-repo ABC-1 "${work.split(path.sep).join('/')}"` });
  assert.match(ok, /prepare my-repo ABC-1/);
  await bad(/inside the working folder/, `bash "${qaGit.split(path.sep).join('/')}" prepare my-repo ABC-1 "${outside.split(path.sep).join('/')}"`);
});

test('Write and Edit stay inside the working folder', () => {
  const w = writeTools([work]);
  assert.match(w.Write.run({ path: 'notes/a.txt', content: 'hello world' }), /Wrote 11/);
  assert.equal(fs.readFileSync(path.join(work, 'notes', 'a.txt'), 'utf8'), 'hello world');
  assert.throws(() => w.Write.run({ path: path.join(outside, 'x.txt'), content: 'x' }), /only inside/);
  assert.throws(() => w.Write.run({ path: '../other-customer/x.txt', content: 'x' }), /only inside/);
  assert.throws(() => w.Write.run({ path: '../../etc/cron.d/x', content: 'x' }), /only inside/);
  assert.match(w.Edit.run({ path: 'notes/a.txt', old_string: 'world', new_string: 'there' }), /Edited/);
  assert.equal(fs.readFileSync(path.join(work, 'notes', 'a.txt'), 'utf8'), 'hello there');
  assert.throws(() => w.Edit.run({ path: 'notes/a.txt', old_string: 'nope', new_string: 'x' }), /not found/);
  assert.throws(() => w.Edit.run({ path: path.join(outside, 'secret.txt'), old_string: 'other', new_string: 'x' }), /only inside/);
  assert.equal(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8'), 'other customers data');
});

test('Skill returns the instructions of a named skill and lists the choices otherwise', () => {
  const s = skillTool([path.join(agentDir, '.claude', 'skills')]);
  assert.match(s.run({ skill: 'demo' }), /Do the thing/);
  assert.throws(() => s.run({ skill: '../../etc' }), /No skill named/);
  assert.throws(() => s.run({ skill: 'nope' }), /Available: demo/);
});

// ----- sub-agent through the loop, with a scripted provider -----
let server, base, script, seen;
before(async () => {
  server = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => { seen.push(JSON.parse(b)); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(script.shift())); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server.close());
const A = (blocks, stop) => ({ content: blocks, stop_reason: stop, usage: { input_tokens: 10, output_tokens: 5 } });

test('Agent tool: a sub-agent runs on its own context, its answer comes back, it cannot start another', async () => {
  seen = [];
  script = [
    A([{ type: 'tool_use', id: 'a1', name: 'Agent', input: { prompt: 'check the thing' } }], 'tool_use'),
    A([{ type: 'text', text: 'sub result: thing is fine' }], 'end_turn'),   // the sub-agent
    A([{ type: 'text', text: 'main report using: sub result' }], 'end_turn'),
  ];
  const events = [];
  const r = await runLoop({ provider: { id: 'anthropic', key: 'k', model: 'm', baseUrl: base }, system: 'SYS', prompt: 'go', mcpServers: {}, cwd: agentDir, builtin: ['Read', 'Write', 'Agent'], readRoots: [work], writeRoots: [work], allow: [], timeoutMs: 20000, onToolUse: (t) => events.push(t.name) });
  assert.equal(r.error, null);
  assert.equal(r.lastText, 'main report using: sub result');
  assert.deepEqual(events, ['Agent']);
  const mainTools = seen[0].tools.map((t) => t.name).sort();
  const subTools = seen[1].tools.map((t) => t.name).sort();
  assert.deepEqual(mainTools, ['Agent', 'Read', 'Write']);
  assert.deepEqual(subTools, ['Read', 'Write'], 'the sub-agent has no Agent tool');
  assert.match(seen[1].system[0].text, /sub-agent/);
  const first = seen[1].messages[0].content; assert.equal(Array.isArray(first) ? first[0].text : first, 'check the thing');
  assert.deepEqual(seen[1].messages.at(-1).content.at(-1).cache_control, { type: 'ephemeral' }, 'the newest message is a cache point');
  assert.equal(seen[2].messages[2].content[0].content, 'sub result: thing is fine');
  assert.ok(r.usage.input >= 30, 'the sub-agent usage is counted');
});
