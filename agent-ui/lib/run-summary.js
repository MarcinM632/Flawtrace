// Run Summary: one page compiling the whole Test Flow chain (phases 1-7) for a single ticket.
// Built fresh from the run store on every request — no cache, no file to go stale — so it always
// shows the latest run of each phase, whichever way that phase was started (manual click or the
// auto-chain). This is intentionally the only "clever" part: everything else is a read of meta
// fields that already exist on every run.
const { AGENTS } = require('./agents');
const { runs } = require('./store');

const PHASES = ['planning', 'analysis', 'design', 'implementation', 'execution', 'completion'];

function phaseEntry(ticket, key) {
  const agent = AGENTS[key];
  const matches = [...runs.values()].filter((r) => r.meta.agent === key && String(r.meta.ticket || '').trim() === ticket);
  if (!matches.length) return { key, label: agent.label, status: 'missing' };
  const byTime = (a, b) => (b.meta.finishedAt || b.meta.startedAt) - (a.meta.finishedAt || a.meta.startedAt);
  const done = matches.filter((r) => r.meta.status === 'done').sort(byTime)[0];
  const latest = done || [...matches].sort(byTime)[0];
  const m = latest.meta;
  const audit = m.audit;
  const auditBad = !!(audit && !audit.noCode && audit.issues && audit.issues.length);
  const firstLine = String(m.reportStatus || '').split('\n')[0].trim();
  const verdict = firstLine || (m.status === 'running' ? 'In progress' : m.status === 'failed' ? (m.error || 'Failed to run') : m.status === 'cancelled' ? 'Cancelled' : '—');
  const excerpt = String(m.report || '').replace(/\s+/g, ' ').trim().slice(0, 220);
  return {
    key,
    label: agent.label,
    id: m.id,
    status: m.status,
    stale: !done && matches.length > 0,
    verdict,
    auditBad,
    auditIssues: auditBad ? audit.issues.length : 0,
    startedAt: m.startedAt,
    finishedAt: m.finishedAt,
    durationMs: m.finishedAt ? m.finishedAt - m.startedAt : null,
    excerpt,
  };
}

function buildRunSummary(ticket) {
  ticket = String(ticket || '').trim();
  const phases = PHASES.map((k) => phaseEntry(ticket, k));
  const ran = phases.filter((p) => p.status !== 'missing');
  const bad = phases.some((p) => p.auditBad || p.status === 'failed' || /BŁĄD|FAIL|PRZERWANO/i.test(p.verdict || ''));
  const missing = phases.some((p) => p.status === 'missing');
  const running = phases.some((p) => p.status === 'running');
  const overall = !ran.length ? 'EMPTY' : bad ? 'FAIL' : running ? 'RUNNING' : missing ? 'PARTIAL' : 'PASS';
  return { ticket, phases, overall, generatedAt: Date.now() };
}

/** Tickets with at least one Completion run, newest first — for the picker when none is given. */
function recentTickets(limit = 30) {
  const seen = new Map();
  for (const r of runs.values()) {
    if (r.meta.agent !== 'completion') continue;
    const t = String(r.meta.ticket || '').trim();
    if (!t) continue;
    const ts = r.meta.finishedAt || r.meta.startedAt || 0;
    if (!seen.has(t) || seen.get(t) < ts) seen.set(t, ts);
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([ticket]) => ticket);
}

module.exports = { buildRunSummary, recentTickets };
