// Lessons from past runs, written without a model. When the tester confirms the results of a Full test, each result is
// either a defect or "not a defect". Both are worth remembering: the first tells the agents where this product breaks,
// the second stops them from reporting the same false alarm again. The agents read these files at the start of a run.
const fs = require('fs');
const path = require('path');

const MARK = '<!-- flawtrace:generated -->';
const FILES = {
  defect: { file: 'lessons/confirmed-defects.md', title: 'Confirmed defects', intro: 'Results the tester confirmed as real defects. When a change touches one of these areas, check it again first.' },
  noise: { file: 'lessons/false-alarms.md', title: 'False alarms', intro: 'Results the tester judged "not a defect". Do not report the same behaviour again unless the task or the specification changed.' },
};
const MAX = 200;
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

function readEntries(p) {
  try { return fs.readFileSync(p, 'utf8').split('\n').filter((l) => /^- \(/.test(l)); } catch (_) { return []; }
}

function append(dir, kind, lines) {
  if (!lines.length) return 0;
  const f = FILES[kind], p = path.join(dir, f.file);
  const have = readEntries(p);
  // The same result is the same lesson whatever the ticket, the detail or the tester's note.
  const key = (l) => norm(l.replace(/^- \([^)]*\)\s*/, '').replace(/\s*\(tester:.*\)$/, '').split(' - ')[0]);
  const seen = new Set(have.map(key));
  const fresh = lines.filter((l) => !seen.has(key(l)));
  if (!fresh.length) return 0;
  // A file the user took over (marker removed) is left alone.
  try { if (!fs.readFileSync(p, 'utf8').startsWith(MARK)) return 0; } catch (_) { /* new file */ }
  const all = [...have, ...fresh].slice(-MAX);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${MARK}\n# ${f.title}\n\n> ${f.intro} Written by Flawtrace when you confirm the results of a Full test.\n\n${all.join('\n')}\n`);
  return fresh.length;
}

/** items: [{ layer, title, detail, decision: 'defect' | 'not-defect' }]. Returns how many lines were added. */
function record(dir, { ticket, items = [], note = '', date = new Date() }) {
  const d = date.toISOString().slice(0, 10);
  const t = clean(ticket, 60);
  const line = (i) => `- (${d}, ${t}) [${String(i.layer || '').toUpperCase()}] ${clean(i.title, 200)}${i.detail ? ' - ' + clean(i.detail, 240) : ''}`;
  const defects = items.filter((i) => i.decision === 'defect').map(line);
  const noise = items.filter((i) => i.decision === 'not-defect').map((i) => line(i) + (note ? ` (tester: ${clean(note, 160)})` : ''));
  return append(dir, 'defect', defects) + append(dir, 'noise', noise);
}

/** Short text for the agents' brief, or '' when nothing has been recorded. */
function digest(dir, perKind = 8) {
  const out = [];
  for (const [kind, f] of Object.entries(FILES)) {
    const e = readEntries(path.join(dir, f.file)).slice(-perKind);
    if (e.length) out.push(`${f.title} (latest ${e.length}):\n` + e.join('\n'));
  }
  return out.join('\n\n');
}

module.exports = { record, digest, FILES, MARK };
