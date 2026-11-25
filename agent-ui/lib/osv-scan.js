// SCA przez bazę OSV (osv.dev): dla dokładnych wersji zależności z plików blokad i przypiętych manifestów pyta
// publiczne API OSV o znane podatności (CVE/GHSA), z numerem, wagą (CVSS) i wersją naprawioną. Uzupełnia wbudowaną
// krótką listę w repo-scan.js: tam jest szybkie, offline'owe dopasowanie kilku głośnych podatności, tu — pełne,
// aktualne dane z bazy, gdy aplikacja ma dostęp do sieci (w chmurze przez strażnika — osv.dev jest publiczne).
// Ekstrakcja wersji to czyste parsowanie plików (bez uruchamiania menedżera pakietów), więc działa też na hostingu.
// Wersje bierzemy TYLKO stamtąd, gdzie są dokładne (plik blokady albo `==`/przypięcie), bo OSV potrzebuje konkretnej
// wersji; zakresy z package.json (^1.2) pomijamy — od tego jest plik blokady.
const OSV_BATCH = 'https://api.osv.dev/v1/querybatch';
const OSV_VULN = 'https://api.osv.dev/v1/vulns/';
const MAX_DEPS = 4000;      // tyle zależności maksymalnie pytamy (duże monorepo)
const BATCH = 500;          // OSV przyjmuje wsad; dzielimy na porcje
const MAX_DETAILS = 150;    // tyle unikalnych podatności dociągamy po szczegóły (reszta: sam identyfikator)

const clean = (v) => String(v || '').trim().replace(/^[v=\s]+/, '').replace(/^["']|["']$/g, '');

/* --------------------------------- parsery plików → [{ecosystem,name,version,file}] --------------------------------- */
function fromPackageLock(text, file) {
  let j; try { j = JSON.parse(text); } catch (_) { return []; }
  const out = [];
  if (j.packages && typeof j.packages === 'object') { // lockfile v2/v3
    for (const [k, v] of Object.entries(j.packages)) {
      if (!k || !v || !v.version || v.link) continue;
      const name = k.startsWith('node_modules/') ? k.slice(k.lastIndexOf('node_modules/') + 13) : (v.name || '');
      if (name) out.push({ ecosystem: 'npm', name, version: clean(v.version), file });
    }
  }
  const walk = (deps) => { for (const [name, v] of Object.entries(deps || {})) { if (v && v.version) out.push({ ecosystem: 'npm', name, version: clean(v.version), file }); if (v && v.dependencies) walk(v.dependencies); } };
  if (j.dependencies && (!j.packages || !Object.keys(j.packages).length)) walk(j.dependencies); // v1
  return out;
}
function fromYarnLock(text, file) {
  const out = [];
  let name = null;
  for (const line of text.split('\n')) {
    const h = /^"?((?:@[\w.-]+\/)?[^"\s@][^:@]*?)@/.exec(line);
    if (/^\S.*:\s*$/.test(line) && h) { name = h[1]; continue; }
    const m = /^\s+version:?\s+"?([\w.+-]+)"?/.exec(line);
    if (m && name) { out.push({ ecosystem: 'npm', name, version: clean(m[1]), file }); name = null; }
  }
  return out;
}
function fromPnpmLock(text, file) {
  const out = [];
  for (const m of text.matchAll(/^\s+\/?((?:@[\w.-]+\/)?[\w.-]+)[@/]([\d][\w.+-]*?)(?:\([^)]*\))?:\s*$/gm)) out.push({ ecosystem: 'npm', name: m[1], version: clean(m[2]), file });
  return out;
}
function fromRequirements(text, file) {
  const out = [];
  for (const raw of text.split('\n')) { const line = raw.replace(/[#;].*$/, '').trim(); const m = /^([A-Za-z0-9_.-]+)\s*==\s*([\w.+!-]+)/.exec(line); if (m) out.push({ ecosystem: 'PyPI', name: m[1], version: clean(m[2]), file }); }
  return out;
}
function fromPipfileLock(text, file) {
  let j; try { j = JSON.parse(text); } catch (_) { return []; }
  const out = [];
  for (const sect of ['default', 'develop']) for (const [name, v] of Object.entries(j[sect] || {})) { const ver = clean(v && v.version); if (/^\d/.test(ver)) out.push({ ecosystem: 'PyPI', name, version: ver, file }); }
  return out;
}
function fromGoMod(text, file) {
  const out = [];
  for (const m of text.matchAll(/^\s*(?:require\s+)?([\w.~/-]+\.[\w.~/-]+\/[\w.~/-]+)\s+(v[\w.+-]+)/gm)) if (!/\/\/\s*indirect/.test(m[0]) || true) out.push({ ecosystem: 'Go', name: m[1], version: clean(m[2]).replace(/^v/, ''), file });
  return out.map((d) => ({ ...d, version: 'v' + d.version }));
}
function fromCargoLock(text, file) {
  const out = [];
  for (const m of text.matchAll(/\[\[package\]\]\s*\nname\s*=\s*"([^"]+)"\s*\nversion\s*=\s*"([^"]+)"/g)) out.push({ ecosystem: 'crates.io', name: m[1], version: clean(m[2]), file });
  return out;
}
function fromGemfileLock(text, file) {
  const out = [];
  let inSpecs = false;
  for (const line of text.split('\n')) {
    if (/^\s{2,4}specs:\s*$/.test(line)) { inSpecs = true; continue; }
    if (inSpecs && /^\S/.test(line)) inSpecs = false;
    const m = inSpecs && /^ {4}([\w.-]+) \(([\d][\w.+-]*)\)\s*$/.exec(line);
    if (m) out.push({ ecosystem: 'RubyGems', name: m[1], version: clean(m[2]), file });
  }
  return out;
}
function fromComposerLock(text, file) {
  let j; try { j = JSON.parse(text); } catch (_) { return []; }
  const out = [];
  for (const sect of ['packages', 'packages-dev']) for (const p of j[sect] || []) if (p && p.name && p.version) out.push({ ecosystem: 'Packagist', name: p.name, version: clean(p.version), file });
  return out;
}

const PARSERS = [
  [/(^|\/)(package-lock\.json|npm-shrinkwrap\.json)$/i, fromPackageLock],
  [/(^|\/)yarn\.lock$/i, fromYarnLock],
  [/(^|\/)pnpm-lock\.yaml$/i, fromPnpmLock],
  [/(^|\/)requirements[\w.-]*\.txt$/i, fromRequirements],
  [/(^|\/)Pipfile\.lock$/i, fromPipfileLock],
  [/(^|\/)go\.mod$/i, fromGoMod],
  [/(^|\/)Cargo\.lock$/i, fromCargoLock],
  [/(^|\/)Gemfile\.lock$/i, fromGemfileLock],
  [/(^|\/)composer\.lock$/i, fromComposerLock],
];

/** Dokładne wersje zależności z jednego pliku (po nazwie). []  gdy plik nie jest rozpoznanym manifestem/blokadą. */
function depsFromFile(relPath, text) {
  for (const [re, fn] of PARSERS) if (re.test(relPath)) { try { return fn(text, relPath).filter((d) => d.name && /^v?\d/.test(d.version)); } catch (_) { return []; } }
  return [];
}

/* --------------------------------- OSV --------------------------------- */
const sevFromCvss = (vec) => { const m = /\/C:([NLH]).*?\/I:([NLH]).*?\/A:([NLH])/.exec(String(vec)); if (!m) return null; const w = { N: 0, L: 1, H: 2 }; const s = w[m[1]] + w[m[2]] + w[m[3]]; return s >= 5 ? 'critical' : s >= 3 ? 'high' : s >= 1 ? 'medium' : 'low'; };
function severityOf(v) {
  for (const s of v.severity || []) { const g = sevFromCvss(s.score); if (g) return g; }
  const d = (v.database_specific && String(v.database_specific.severity || '')).toLowerCase();
  if (['critical', 'high', 'medium', 'moderate', 'low'].includes(d)) return d === 'moderate' ? 'medium' : d;
  return 'medium';
}
function fixedVersion(v, name) {
  for (const a of v.affected || []) { if (name && a.package && a.package.name && a.package.name.toLowerCase() !== name.toLowerCase()) continue; for (const r of a.ranges || []) for (const e of r.events || []) if (e.fixed) return e.fixed; }
  return null;
}
const bestId = (v) => { const al = [v.id, ...(v.aliases || [])]; return al.find((x) => /^CVE-/.test(x)) || v.id; };

/**
 * scan({ files:[{rel,text}], fetchImpl?, now? }) → { available, queried, findings:[...], ecosystems, errors }
 * findings: { scanner:'sca-osv', rule:'osv', severity, id, cwe, title, pkg, version, fixed, file, url }
 * Sieć niedostępna / wszystkie zapytania padły → available:false z powodem (reszta skanu repo działa dalej).
 */
async function scan({ files = [], fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
  const seen = new Set();
  const deps = [];
  for (const f of files) for (const d of depsFromFile(f.rel, f.text)) { const k = `${d.ecosystem}|${d.name}|${d.version}`; if (!seen.has(k)) { seen.add(k); deps.push(d); if (deps.length >= MAX_DEPS) break; } }
  if (!deps.length) return { available: true, queried: 0, findings: [], ecosystems: [], errors: [], note: 'brak plików blokad ani przypiętych wersji do sprawdzenia w OSV' };

  const post = async (url, body) => { const r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(timeoutMs) }); if (!r.ok) throw new Error('OSV HTTP ' + r.status); return r.json(); };
  const errors = [];
  const vulnByDep = []; // aligned to deps subset we queried
  let queried = 0, anyOk = false;
  for (let i = 0; i < deps.length; i += BATCH) {
    const chunk = deps.slice(i, i + BATCH);
    try {
      const res = await post(OSV_BATCH, { queries: chunk.map((d) => ({ version: d.version.replace(/^v/, ''), package: { name: d.name, ecosystem: d.ecosystem } })) });
      anyOk = true; queried += chunk.length;
      (res.results || []).forEach((r, j) => { const vulns = (r && r.vulns) || []; if (vulns.length) vulnByDep.push({ dep: chunk[j], ids: vulns.map((v) => v.id) }); });
    } catch (e) { errors.push(String(e && e.message || e)); }
  }
  if (!anyOk) return { available: false, reason: 'OSV nieosiągalne: ' + (errors[0] || 'brak sieci'), queried: 0, findings: [], ecosystems: [...new Set(deps.map((d) => d.ecosystem))], errors };

  // Szczegóły podatności (waga, tytuł, wersja naprawiona) — unikalne id, z limitem.
  const ids = [...new Set(vulnByDep.flatMap((x) => x.ids))].slice(0, MAX_DETAILS);
  const details = new Map();
  await Promise.all(ids.map(async (id) => { try { const r = await fetchImpl(OSV_VULN + encodeURIComponent(id), { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) }); if (r.ok) details.set(id, await r.json()); } catch (_) { /* zostaje sam id */ } }));

  const findings = [];
  const fseen = new Set();
  for (const { dep, ids: vids } of vulnByDep) {
    for (const id of vids) {
      const v = details.get(id);
      const shownId = v ? bestId(v) : id;
      const key = `${dep.ecosystem}|${dep.name}|${dep.version}|${shownId}`;
      if (fseen.has(key)) continue; fseen.add(key);
      const sev = v ? severityOf(v) : 'medium';
      const fixed = v ? fixedVersion(v, dep.name) : null;
      const summary = v ? String(v.summary || (v.details || '').split('\n')[0] || '').slice(0, 160) : '';
      findings.push({ scanner: 'sca-osv', rule: 'osv', severity: sev, id: shownId, cwe: 'CWE-1395',
        title: `${dep.name}@${dep.version} (${dep.ecosystem}) — ${shownId}${summary ? ': ' + summary : ''}${fixed ? ` (naprawione w ${fixed})` : ''}`,
        pkg: dep.name, version: dep.version, fixed, file: dep.file, url: `https://osv.dev/vulnerability/${shownId}` });
    }
  }
  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  findings.sort((a, b) => (order[a.severity] - order[b.severity]) || (a.pkg < b.pkg ? -1 : 1));
  return { available: true, queried, findings, ecosystems: [...new Set(deps.map((d) => d.ecosystem))], errors };
}

module.exports = { scan, depsFromFile, severityOf, fixedVersion, PARSERS };
