// Jeden spójny obraz całej konfiguracji testowania — dla zakładki „Struktura” w UI: agenci (i ich skille jako
// zdolności/subagenci), biblioteka skili, jednolita baza wiedzy per serwis oraz edytowalne pliki wiedzy. Wszystko
// czytane z realnych definicji (lib/agents.js, folder agents/_shared/*-skills, folder wiedzy), żeby to, co widzi i czym
// zarządza użytkownik, było dokładnie tym, czego używają agenci.
const fs = require('fs');
const path = require('path');

const KNOWN_EXT = /\.(md|txt|json)$/i;
// Które grupy skili należą do którego trybu agenta (agenci jednego rodzaju dzielą bibliotekę skili).
const SKILL_GROUP = { qamcp: 'qamcp-skills', execution: 'qamcp-skills', pentest: 'pentest-skills', uitest: 'uitest-skills' };
// Dwa poziomy. GENERYCZNE: jak agent działa, dowodzi i raportuje — to samo niezależnie od aplikacji (biblioteka ISTQB,
// bramka sensu biznesowego domain-rules wspólna dla wszystkich, oraz mechaniki danego typu agenta). LOGIKA BIZNESOWA:
// co robi dana aplikacja i jej reguły — osobno dla każdego serwisu (baza wiedzy per serwis). Te poziomy NIE są na równi.
const SHARED_GROUPS = new Set(['istqb-library', 'domain-rules']); // czytane/doklejane przez każdego właściwego agenta
const skillScope = (group) => (SHARED_GROUPS.has(group) ? 'shared' : 'agent-type');
const LEVELS = [
  { id: 'shared', title: 'Wspólne dla każdego agenta', desc: 'Jak agent pracuje, dowodzi i raportuje — to samo niezależnie od aplikacji (mechaniki agenta, metodyka ISTQB, bramka sensu biznesowego).' },
  { id: 'per-app', title: 'Logika biznesowa per aplikacja', desc: 'Co robi dana aplikacja i jej reguły — osobno dla każdego podłączonego serwisu, z bazy wiedzy per serwis. Osobny poziom, nie na równi z mechaniką agenta.' },
];
// Krótki, ludzki opis roli każdego agenta (do intuicyjnego drzewa).
const AGENT_KIND = {
  core: 'analiza', svc: 'analiza', mcp: 'analiza', static: 'analiza statyczna', design: 'projektowanie testów',
  qamcp: 'wykonanie na żywo', execution: 'wykonanie na żywo', pentest: 'test penetracyjny',
  planning: 'Test Flow', analysis: 'Test Flow', implementation: 'Test Flow', completion: 'Test Flow',
  uitest: 'testy UI', autotest: 'automatyzacja',
};

const firstHeading = (md) => { const m = /^#\s+(.+)$/m.exec(md || ''); return m ? m[1].trim() : ''; };
const frontDesc = (md) => { const m = /^---[\s\S]*?\bdescription:\s*(.+)$/m.exec(md || ''); return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''; };

/** Wszystkie skille z agents/_shared/<grupa>-skills/<skill>/SKILL.md. */
function skills(agentsRoot) {
  const base = path.join(agentsRoot, '_shared');
  const out = [];
  let groups = [];
  try { groups = fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.endsWith('-skills')).map((e) => e.name); } catch (_) { return out; }
  for (const g of groups) {
    let names = []; try { names = fs.readdirSync(path.join(base, g), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch (_) { /* brak */ }
    for (const n of names) {
      const file = path.join(base, g, n, 'SKILL.md');
      let md = ''; try { md = fs.readFileSync(file, 'utf8'); } catch (_) { continue; }
      out.push({ group: g, name: n, title: firstHeading(md) || n, description: frontDesc(md), path: relFromRoot(agentsRoot, file), scope: skillScope(g) });
    }
  }
  // Poziom WSPÓLNY (nie kończy się na -skills): metodyka ISTQB i bramka sensu biznesowego — czytane/doklejane przez
  // każdego właściwego agenta, niezależnie od aplikacji. Pokazujemy je obok skili, z oznaczeniem scope 'shared'.
  for (const [dir, files] of [['istqb-library', null], ['domain-rules', ['brief.md']]]) {
    let list = files;
    if (!list) { try { list = fs.readdirSync(path.join(base, dir)).filter((f) => /\.md$/i.test(f)); } catch (_) { list = []; } }
    for (const f of list) {
      const file = path.join(base, dir, f);
      let md = ''; try { md = fs.readFileSync(file, 'utf8'); } catch (_) { continue; }
      out.push({ group: dir, name: f.replace(/\.md$/i, ''), title: firstHeading(md) || f, description: frontDesc(md) || (dir === 'domain-rules' ? 'Bramka sensu biznesowego doklejana do każdego trybu agenta.' : ''), path: relFromRoot(agentsRoot, file), scope: 'shared' });
    }
  }
  return out;
}
const relFromRoot = (agentsRoot, abs) => path.relative(path.dirname(agentsRoot), abs).split(path.sep).join('/');

/** Agenci z lib/agents.js, z dostępnością, grupą skili i nazwami skili (ich zdolności/subagenci). */
function agents(agentsLib, agentsRoot) {
  const { AGENTS, agentAvailable, agentReason, agentDir, servicesFor } = agentsLib;
  const lib = skills(agentsRoot);
  return Object.entries(AGENTS).map(([key, a]) => {
    const group = SKILL_GROUP[a.mode] || null;
    const mine = group ? lib.filter((s) => s.group === group) : [];
    let dir = ''; try { dir = agentDir(a); } catch (_) { /* brak */ }
    const hasInstr = (() => { try { return fs.existsSync(path.join(dir, 'CLAUDE.md')); } catch (_) { return false; } })();
    return {
      key, label: a.label, mode: a.mode || 'qa', kind: AGENT_KIND[key] || 'agent',
      available: agentAvailable(a), reason: agentReason(a),
      dir: dir ? dir.split(path.sep).join('/') : '', hasInstructions: hasInstr,
      skillGroup: group, skills: mine.map((s) => ({ name: s.name, title: s.title, description: s.description, scope: s.scope })),
      // Jawny podział poziomów dla tego agenta: generyczne mechaniki/metodyka (wspólne) vs logika biznesowa per apka.
      generic: [...(group ? [`skille ${group}`] : ['role z CLAUDE.md']), 'bramka sensu biznesowego (domain-rules)', 'wspólne pliki wiedzy (reguły zespołu)'],
      businessLogic: 'baza wiedzy per serwis (osobno dla każdej aplikacji)',
      services: (() => { try { return servicesFor(key); } catch (_) { return []; } })(),
    };
  });
}

/** Drzewo plików wiedzy, pogrupowane logicznie; generated=true dla folderów budowanych automatycznie. */
function knowledgeTree(knowledgeDir) {
  const out = [];
  const walk = (dir, rel) => {
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.')) continue;
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (KNOWN_EXT.test(e.name)) { let size = 0; try { size = fs.statSync(path.join(dir, e.name)).size; } catch (_) { /* brak */ } out.push({ path: r, size, group: groupOf(r), scope: r.startsWith('services/') ? 'per-app' : 'shared', generated: isGenerated(r), editable: KNOWN_EXT.test(e.name) }); }
    }
  };
  walk(knowledgeDir, '');
  return out;
}
const isGenerated = (rel) => /^(services|product|lessons)\//.test(rel);
function groupOf(rel) {
  if (rel.startsWith('services/')) return 'Baza wiedzy per serwis (generowane)';
  if (rel.startsWith('product/')) return 'Wiedza o produkcie (onboarding)';
  if (rel.startsWith('lessons/')) return 'Wnioski z przebiegów';
  return 'Reguły zespołu (edytowalne)';
}

/** Bezpieczna ścieżka wewnątrz folderu wiedzy; null gdy próba wyjścia poza albo zły typ pliku. */
function safePath(knowledgeDir, rel) {
  if (!rel || typeof rel !== 'string' || !KNOWN_EXT.test(rel)) return null;
  const abs = path.resolve(knowledgeDir, rel);
  const root = path.resolve(knowledgeDir);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  if (rel.split('/').some((seg) => seg === '..' || seg === '')) return null;
  return abs;
}

function build({ agentsLib, agentsRoot, knowledgeDir, kbStatus }) {
  return {
    levels: LEVELS,
    agents: agents(agentsLib, agentsRoot),
    skills: skills(agentsRoot),
    knowledge: knowledgeTree(knowledgeDir),
    knowledgeBase: kbStatus ? kbStatus() : { services: [], sections: [] },
  };
}

module.exports = { build, agents, skills, knowledgeTree, safePath, skillScope, SKILL_GROUP, SHARED_GROUPS, LEVELS, AGENT_KIND };
