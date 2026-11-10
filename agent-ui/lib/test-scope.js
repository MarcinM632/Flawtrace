// Zakres testowy per serwis (skill test-scope, Agents/_shared/test-scope/references/<apka>/<serwis>.md).
// QA MCP i Autotests nie mają narzędzia Skill, więc zamiast wstrzykiwać CAŁY skill do systemowego prompta
// (jak DOMAIN_BRIEF — tu by napuchł z każdym nowym serwisem), dopasowujemy pliki po nazwie serwisu/apki
// znalezionej w treści zadania i zapisujemy tylko trafienia do WORK_DIR — agent czyta je przez Grep,
// tak samo jak bug-registry.md i autotest-setup.md.
const fs = require('fs');
const path = require('path');
const { AGENTS_ROOT } = require('./config');

const ROOT = path.join(AGENTS_ROOT, '_shared', 'test-scope', 'references');

function listFiles() {
  const out = [];
  let apps;
  try { apps = fs.readdirSync(ROOT, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch (_) { return out; }
  for (const app of apps) {
    let files;
    try { files = fs.readdirSync(path.join(ROOT, app.name)); } catch (_) { continue; }
    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      out.push({ app: app.name, service: f.replace(/\.md$/, ''), file: path.join(ROOT, app.name, f) });
    }
  }
  return out;
}

const norm = (s) => String(s || '').toLowerCase();

/** Zapisuje do workDir/test-scope.md zawartość plików test-scope, których nazwa serwisu/apki pada w `input`. */
function writeTestScope(workDir, input = '') {
  const text = norm(input);
  const all = listFiles();
  const matched = all.filter((f) => text.includes(norm(f.service)) || text.includes(norm(f.app)));
  const out = ['# Zakres testowy (test-scope) — dopasowane po nazwie serwisu/apki w zadaniu',
    'Sekcja 1 w każdym pliku = potwierdzone (ticket/plik:linia). Sekcja 3 = NIEPOTWIERDZONE hipotezy,',
    'leady do zbadania w tej sesji, nie dowód — nie cytuj ich jako finding ani jako fakt biznesowy.', ''];
  if (!matched.length) {
    const known = all.map((f) => `${f.app}/${f.service}`).join(', ') || '(na razie brak plików)';
    out.push(`Brak dopasowania do znanego serwisu. Pliki dostępne: ${known}.`);
    out.push('Jeśli zadanie jednak dotyczy jednego z nich pod inną nazwą, przeczytaj go ręcznie z');
    out.push(`${ROOT.replace(/\\/g, '/')}.`);
  } else {
    for (const f of matched) {
      out.push(`## ${f.app}/${f.service}`);
      try { out.push(fs.readFileSync(f.file, 'utf8').trim()); } catch (_) { out.push('(nie udało się odczytać pliku)'); }
      out.push('');
    }
  }
  try { fs.writeFileSync(path.join(workDir, 'test-scope.md'), out.join('\n')); } catch (_) { /* agent poradzi sobie bez tego pliku */ }
}

module.exports = { writeTestScope };
