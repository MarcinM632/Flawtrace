// Smoke test interfejsu: otwiera każdą zakładkę w headless Edge, zbiera komunikaty konsoli (błędy JS) i robi zrzut ekranu.
// Użycie:  node scripts/ui-smoke.js [katalog-na-zrzuty]     (serwer musi działać na PORT, domyślnie 4317)
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
if (!EDGE) { console.error('Edge not found'); process.exit(2); }
const out = path.resolve(process.argv[2] || path.join(__dirname, '..', 'ui-shots'));
fs.mkdirSync(out, { recursive: true });
const base = 'http://localhost:' + (process.env.PORT || 4317) + '/';
const TABS = ['', 'flow', 'runsummary', 'tfmonitor', 'qamcp', 'autotest', 'bugs', 'risk', 'tools', 'fix', 'doc', 'ai', 'autodoc'];
let bad = 0;
for (const t of TABS) {
  const name = t || 'analyses';
  const r = spawnSync(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1500,1000', '--virtual-time-budget=7000',
    '--enable-logging=stderr', '--v=0', '--screenshot=' + path.join(out, name + '.png'), base + (t ? '#' + t : '')], { encoding: 'utf8', timeout: 60000 });
  const errs = (r.stderr || '').split('\n').filter((l) => /CONSOLE/.test(l) && /(error|uncaught|referenceerror|typeerror|failed to load)/i.test(l));
  const ok = fs.existsSync(path.join(out, name + '.png')) && errs.length === 0;
  if (!ok) bad++;
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + name.padEnd(10) + (errs.length ? '\n     ' + errs.slice(0, 3).map((l) => l.slice(0, 220)).join('\n     ') : ''));
}
process.exit(bad ? 1 : 0);
