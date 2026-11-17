// The Static agent (task review, ISTQB static testing): wired into the app, and its report validator is strict.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { AGENTS, agentAvailable } = require('../lib/agents');
const prompts = require('../lib/prompts');
const { BUILTIN_TOOLS } = require('../lib/scope');

const VALIDATOR = path.join(__dirname, '..', '..', 'agents', 'claudeAgentStatic', '.claude', 'skills', 'static-review', 'scripts', 'validate-static.sh');
const GOOD = fs.readFileSync(path.join(__dirname, 'fixtures', 'static-sample-good.txt'), 'utf8');
let hasBash = true;
try { execFileSync('bash', ['-c', 'true'], { stdio: 'ignore' }); } catch (_) { hasBash = false; }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-static-'));
const posix = (p) => p.split(path.sep).join('/');
const check = (text) => {
  const f = path.join(tmp, 'r' + Math.random().toString(36).slice(2) + '.txt');
  fs.writeFileSync(f, text);
  try { return { ok: true, out: execFileSync('bash', [posix(VALIDATOR), '--report', posix(f)]).toString() }; }
  catch (e) { return { ok: false, out: e.stdout.toString() }; }
};

test('static agent: registered with its own folder, mode and tools', () => {
  assert.equal(AGENTS.static.mode, 'static');
  assert.ok(agentAvailable(AGENTS.static), 'agents/claudeAgentStatic/CLAUDE.md exists');
  assert.deepEqual(BUILTIN_TOOLS.static, BUILTIN_TOOLS.qa);
  assert.match(prompts.OVERRIDE_STATIC, /validate-static\.sh/);
  assert.match(prompts.OVERRIDE_STATIC, /qa-git\.sh/);
});

test('static validator: a complete review passes', { skip: !hasBash }, () => {
  const r = check(GOOD);
  assert.equal(r.ok, true, r.out); assert.match(r.out, /STATIC OK/);
});

test('static validator: it rejects what makes a review shallow or inconsistent', { skip: !hasBash }, () => {
  const bad = (text, re) => { const r = check(text); assert.equal(r.ok, false); assert.match(r.out, re); };
  bad(GOOD.replace(/^S3 .*\n/m, ''), /only 2 scenarios/);
  bad(GOOD.replace(/^R4 .*\n/m, '').replace('requirements: 4', 'requirements: 3'), /points at R4/);
  bad(GOOD.replace(/^- R2: .*\n/m, ''), /not accounted for.*R2/);
  bad(GOOD.replace(/^Why it matters: the task does not.*\n/m, ''), /"Why it matters:"/);
  bad(GOOD.replace('openOrders from orders-svc', 'x').replace(/(Question for the author: should[^?]*)\?/, '$1.'), /not a question/);
  bad(GOOD.replace('NEEDS REWORK', 'TASK OK'), /verdict TASK OK/);
  bad(GOOD.replace('NEEDS REWORK', 'BLOCKED'), /BLOCKED needs an \[Impossible\]/);
  bad(GOOD.replace(/\| MISMATCH → finding 1/, '| MISMATCH'), /does not point at a finding/);
  bad(GOOD.replace(/^## Existing logic\n(- .*\n)+/m, '## Existing logic\n- the code has the rules\n'), /no file:line/);
  bad(GOOD.replace('findings: 2', 'findings: 5'), /Review line says 5 findings/);
});
