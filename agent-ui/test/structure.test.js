// Zakładka Struktura: asembler (agenci+skille+pliki), bezpieczna ścieżka pliku, oraz gwarancja, że budowa bazy wiedzy
// jest ściśle sekwencyjna (nigdy równolegle), nawet przy kilku wyzwalaczach naraz.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const structure = require('../lib/structure');
const kbInit = require('../lib/kb-init');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'struct-'));

test('safePath: trzyma się folderu wiedzy, dopuszcza tylko md/txt/json, blokuje wyjście poza', () => {
  const root = tmp();
  assert.ok(structure.safePath(root, 'a.md'));
  assert.ok(structure.safePath(root, 'team/rules.txt'));
  assert.equal(structure.safePath(root, '../etc/passwd'), null);
  assert.equal(structure.safePath(root, 'team/../../x.md'), null);
  assert.equal(structure.safePath(root, 'a.exe'), null);
  assert.equal(structure.safePath(root, ''), null);
});

test('asembler: agenci z grupą skili i ich skille, biblioteka skili, drzewo plików pogrupowane', () => {
  const agentsRoot = path.join(tmp(), 'agents');
  // minimalna atrapa układu skili
  fs.mkdirSync(path.join(agentsRoot, '_shared', 'qamcp-skills', 'result-triage'), { recursive: true });
  fs.writeFileSync(path.join(agentsRoot, '_shared', 'qamcp-skills', 'result-triage', 'SKILL.md'), '---\ndescription: triage results\n---\n# Result triage\n');
  const kdir = tmp();
  fs.writeFileSync(path.join(kdir, 'how-we-test.md'), '# rules');
  fs.mkdirSync(path.join(kdir, 'services'));
  fs.writeFileSync(path.join(kdir, 'services', 'api.md'), '# api');
  const agentsLib = {
    AGENTS: { qamcp: { label: 'QA MCP', mode: 'qamcp', absDir: '/x' }, core: { label: 'CORE', dir: 'claudeAgent' } },
    agentAvailable: () => true, agentReason: () => '', agentDir: (a) => a.absDir || path.join(agentsRoot, a.dir), servicesFor: () => [],
  };
  const b = structure.build({ agentsLib, agentsRoot, knowledgeDir: kdir, kbStatus: () => ({ services: [], sections: [] }) });
  const qamcp = b.agents.find((a) => a.key === 'qamcp');
  assert.equal(qamcp.skillGroup, 'qamcp-skills');
  assert.deepEqual(qamcp.skills.map((s) => s.name), ['result-triage']);
  assert.equal(b.skills[0].description, 'triage results');
  const groups = new Set(b.knowledge.map((f) => f.group));
  assert.ok(groups.has('Reguły zespołu (edytowalne)') && groups.has('Baza wiedzy per serwis (generowane)'));
  assert.equal(b.knowledge.find((f) => f.path === 'services/api.md').generated, true);
  assert.equal(b.knowledge.find((f) => f.path === 'how-we-test.md').generated, false);
  // Poziomy rozdzielone: generyczne (wspólne) vs logika biznesowa per apka.
  assert.deepEqual(b.levels.map((l) => l.id), ['shared', 'per-app']);
  assert.equal(qamcp.skills[0].scope, 'agent-type', 'skille typu agenta nie są poziomem wspólnym');
  assert.equal(b.knowledge.find((f) => f.path === 'services/api.md').scope, 'per-app', 'baza per serwis to logika biznesowa');
  assert.equal(b.knowledge.find((f) => f.path === 'how-we-test.md').scope, 'shared', 'reguły zespołu są wspólne');
  assert.match(qamcp.businessLogic, /per serwis/, 'logika biznesowa agenta to baza per serwis');
});

test('skille wspólne (ISTQB, bramka domain-rules) mają scope shared i są osobnym poziomem od mechaniki typu agenta', () => {
  const agentsRoot = path.join(tmp(), 'agents');
  fs.mkdirSync(path.join(agentsRoot, '_shared', 'istqb-library'), { recursive: true });
  fs.writeFileSync(path.join(agentsRoot, '_shared', 'istqb-library', 'test-manager.md'), '# Test manager');
  fs.mkdirSync(path.join(agentsRoot, '_shared', 'domain-rules'), { recursive: true });
  fs.writeFileSync(path.join(agentsRoot, '_shared', 'domain-rules', 'brief.md'), '# Domain rules');
  fs.mkdirSync(path.join(agentsRoot, '_shared', 'qamcp-skills', 'result-triage'), { recursive: true });
  fs.writeFileSync(path.join(agentsRoot, '_shared', 'qamcp-skills', 'result-triage', 'SKILL.md'), '# Result triage');
  const lib = require('../lib/structure').skills(agentsRoot);
  assert.equal(lib.find((s) => s.name === 'test-manager').scope, 'shared');
  assert.equal(lib.find((s) => s.name === 'brief' && s.group === 'domain-rules').scope, 'shared');
  assert.equal(lib.find((s) => s.name === 'result-triage').scope, 'agent-type');
  assert.equal(require('../lib/structure').skillScope('qamcp-skills'), 'agent-type');
  assert.equal(require('../lib/structure').skillScope('domain-rules'), 'shared');
});

test('budowa bazy wiedzy jest ściśle sekwencyjna — dwa wyzwalacze naraz nie nakładają się', async () => {
  const dir = tmp();
  let active = 0, maxActive = 0, builds = 0;
  // sztuczny adapter przez wolny konektor Jiry; dwa „serwisy” (jira + repo) i dwa równoległe wyzwalacze
  const slow = () => new Promise((r) => setTimeout(r, 40));
  const sources = {
    read: () => ({ jira: { url: 'https://x', token: 't', projects: 'PRJ' }, confluence: {}, api: { specs: [] }, repos: [] }),
    status: () => ({ jira: true, confluence: false, api: false, endpoints: 0 }),
    repoList: () => [],
    jiraProjectKeys: () => ['PRJ'], projectClause: (k) => k.join(','), jql: (...p) => p.filter(Boolean).join(' '),
    jiraVersions: async () => { active++; maxActive = Math.max(maxActive, active); await slow(); active--; builds++; return []; },
    jiraSearchAll: async () => { await slow(); return []; },
  };
  const engine = kbInit.create({ sources, knowledgeDir: () => dir });
  // dwa wyzwalacze jednocześnie
  await Promise.all([engine.initConnected({ only: ['jira'] }), engine.initConnected({ only: ['jira'] })]);
  assert.equal(maxActive, 1, 'nigdy więcej niż jedna budowa naraz');
  assert.ok(builds >= 1);
  assert.ok(fs.existsSync(path.join(dir, 'services', 'README.md')), 'README struktury zapisany');
});
