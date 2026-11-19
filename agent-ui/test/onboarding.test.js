// Onboarding: sources -> facts with sources -> knowledge files. Driven with a fake source set and a fake model.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ob = require('../lib/onboarding');
const lessons = require('../lib/lessons');

const ids = (...a) => new Set(a);

test('parseFacts: keeps valid facts, drops those without a real source, survives fences and chatter', () => {
  const answer = 'Here you go:\n```json\n' + JSON.stringify({ facts: [
    { type: 'rule', text: 'A limit order above 5 is rejected', src: ['S1'] },
    { type: 'rule', text: 'No source at all here', src: [] },
    { type: 'rule', text: 'Wrong source id used', src: ['S9'] },
    { type: 'banana', text: 'Unknown type of fact', src: ['S1'] },
    { type: 'term', text: 'LP means liquidity provider', src: 'S2' },
  ] }) + '\n```';
  const out = ob.parseFacts(answer, ids('S1', 'S2'));
  assert.equal(out.facts.length, 2); assert.equal(out.dropped, 3); assert.deepEqual(out.facts[1].src, ['S2']);
  assert.equal(ob.parseFacts('sorry, no', ids('S1')).bad, true);
});

test('dedupe merges the same statement and unions the sources', () => {
  const d = ob.dedupe([{ type: 'rule', text: 'Limit is 5.', src: ['S1'] }, { type: 'rule', text: 'limit is 5', src: ['S2'] }, { type: 'term', text: 'limit is 5', src: ['S3'] }]);
  assert.equal(d.length, 2); assert.deepEqual(d[0].src, ['S1', 'S2']);
});

test('checkCitations removes unknown ids and drops a bullet that cites nothing real', () => {
  const c = ob.checkCitations('## Rules\n- Real rule [S1]\n- Made up rule [S7]\n- Uncited rule\nPlain paragraph without a bullet.\n- Mixed [S1][S8]', ids('S1'));
  assert.match(c.text, /Real rule \[S1\]/); assert.doesNotMatch(c.text, /Made up/); assert.doesNotMatch(c.text, /Uncited/);
  assert.match(c.text, /Mixed \[S1\]$/m); assert.equal(c.unsourced, 2); assert.ok(c.removed >= 2); assert.deepEqual([...c.cited], ['S1']);
});

test('batches never split a document and respect the limit', () => {
  const d = (n, len) => ({ id: 'S' + n, title: 't', text: 'x'.repeat(len) });
  const b = ob.batches([d(1, 500), d(2, 500), d(3, 500), d(4, 2000)], 1200);
  assert.deepEqual(b.map((x) => x.length), [2, 1, 1]);
});

function rig(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-ob-'));
  const kn = path.join(dir, 'knowledge'); fs.mkdirSync(kn, { recursive: true });
  fs.writeFileSync(path.join(kn, 'how-we-test.md'), '# How we test\nWe test on staging. Test accounts have the prefix AUTOTEST. Orders above the limit of 5 are rejected by billing.');
  const calls = [];
  const sources = {
    status: () => ({ jira: false, confluence: true, repos: 0, api: false, knowledge: 1 }),
    knowledgeFiles: () => ({ dir: kn, files: [{ path: 'how-we-test.md', size: 150 }, { path: 'README.md', size: 10 }] }),
    confluenceList: async () => [{ id: '1' }, { id: '2' }],
    confluencePage: async (id) => ({ title: 'Page ' + id, url: 'https://c/' + id, text: 'The limit service rejects an order when open orders exceed maxOpenOrders. '.repeat(3) + id }),
    repoList: () => [], jiraProjectKeys: () => [],
  };
  const llm = {
    current: () => ({ id: 'anthropic' }),
    complete: async (system, input) => {
      calls.push({ system, input });
      if (over.llm) return over.llm(system, input, calls);
      if (/Extract ONLY/.test(system)) return { text: JSON.stringify({ facts: [{ type: 'rule', text: 'An order is rejected when open orders exceed maxOpenOrders', src: ['S2'] }, { type: 'term', text: 'maxOpenOrders is the open order limit', src: ['S3'] }, { type: 'rule', text: 'Invented rule', src: ['S99'] }] }), costUsd: 0.01 };
      if (/You write one document/.test(system)) return { text: '## Limits\n- Orders above maxOpenOrders are rejected [S2][S50]\n- A line the model made up\n- The glossary term [S3]' };
      return { text: 'A trading back office. The limit service rejects orders above maxOpenOrders. [S2]' };
    },
  };
  const P = ob.create({ sources, llm, knowledgeDir: () => kn, dataDir: path.join(dir, 'data'), runs: () => (over.runs || []), now: () => 1700000000000 });
  return { P, kn, calls, dir };
}

test('full run: scan -> facts -> files with checked citations -> briefing', async () => {
  const t = rig();
  t.P.start({ depth: 'quick' }); await t.P.whenDone();
  const v = t.P.view();
  assert.equal(v.status, 'done', v.error);
  assert.equal(v.scan.counts.knowledge, 1); assert.equal(v.scan.counts.confluence, 2);
  assert.equal(v.facts.count, 2);
  const rules = fs.readFileSync(path.join(t.kn, 'product', 'business-rules.md'), 'utf8');
  assert.ok(rules.startsWith(ob.MARK)); assert.match(rules, /maxOpenOrders are rejected \[S2\]/);
  assert.doesNotMatch(rules, /\[S50\]/); assert.doesNotMatch(rules, /made up/); assert.match(rules, /## Sources[\s\S]*\[S2\] confluence: Page 1/);
  assert.ok(fs.existsSync(path.join(t.kn, 'product', 'glossary.md')));
  assert.ok(!fs.existsSync(path.join(t.kn, 'product', 'known-defects.md')), 'no facts of that kind, no file');
  const digest = fs.readFileSync(path.join(t.kn, 'product', 'digest.md'), 'utf8');
  assert.doesNotMatch(digest, /\[S\d+\]/);
  assert.ok(v.outputs.some((o) => o.path === 'product/digest.md')); assert.ok(v.costUsd > 0);
});

test('a file the user took over is kept; the new draft goes beside it', async () => {
  const t = rig();
  t.P.start({}); await t.P.whenDone();
  const f = path.join(t.kn, 'product', 'business-rules.md');
  fs.writeFileSync(f, '# My own rules\n- Mine.\n');
  t.P.start({}); await t.P.whenDone();
  assert.equal(fs.readFileSync(f, 'utf8'), '# My own rules\n- Mine.\n');
  assert.ok(fs.existsSync(path.join(t.kn, 'product', 'business-rules.new.md')));
  assert.equal(t.P.view().outputs.find((o) => o.path === 'product/business-rules.new.md').kept, true);
});

test('scan only costs no model call and says how many calls a full run needs', async () => {
  const t = rig();
  t.P.start({ scanOnly: true }); await t.P.whenDone();
  const v = t.P.view();
  assert.equal(v.status, 'done'); assert.equal(t.calls.length, 0); assert.ok(v.scan.estimatedCalls >= 3);
});

test('unreadable model answers do not crash the run; nothing readable fails with words', async () => {
  const t = rig({ llm: async () => ({ text: 'I cannot help with that.' }) });
  t.P.start({}); await t.P.whenDone();
  const v = t.P.view();
  assert.equal(v.status, 'failed'); assert.match(v.error, /did not answer|No facts/);
});

test('an ACP provider is refused for a full run with a clear reason, a second start while running too', async () => {
  const t = rig();
  const acp = ob.create({ sources: { status: () => ({}), knowledgeFiles: () => ({ files: [] }) }, llm: { current: () => ({ id: 'acp' }) }, knowledgeDir: () => t.kn, dataDir: path.join(t.dir, 'd2'), runs: () => [] });
  assert.throws(() => acp.start({}), /single questions/);
  t.P.start({}); assert.throws(() => t.P.start({}), /already running/); await t.P.whenDone();
});

test('readFile only serves product/ and lessons/ markdown', () => {
  const t = rig();
  assert.throws(() => t.P.readFile('../secrets.md'), /Not an onboarding file/);
  assert.throws(() => t.P.readFile('how-we-test.md'), /Not an onboarding file/);
});

test('lessons: confirmed defects and false alarms are kept once, and reach the digest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-ls-'));
  const items = [{ layer: 'api', title: 'Limit off by one', detail: 'allowed at 5', decision: 'defect' }, { layer: 'ui', title: 'Tooltip typo', decision: 'not-defect' }];
  assert.equal(lessons.record(dir, { ticket: 'DEMO-1', items, note: 'known' }), 2);
  assert.equal(lessons.record(dir, { ticket: 'DEMO-2', items }), 0, 'the same lesson is not added twice');
  const d = lessons.digest(dir); assert.match(d, /Confirmed defects[\s\S]*Limit off by one/); assert.match(d, /False alarms[\s\S]*Tooltip typo/);
  fs.writeFileSync(path.join(dir, 'lessons', 'false-alarms.md'), '# mine\n');
  assert.equal(lessons.record(dir, { ticket: 'DEMO-3', items: [{ layer: 'ui', title: 'Another', decision: 'not-defect' }] }), 0, 'a file the user took over is left alone');
});
