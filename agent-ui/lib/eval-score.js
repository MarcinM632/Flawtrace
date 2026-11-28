// Scores the reports of a Full test against the seeded defects of the benchmark (eval/expected.js).
// Pure: no model, no network. Used by scripts/eval.js after a live run and by test/eval.test.js.
//
//   findings(layer, report)  -> the finding texts of one phase report (only what the phase claims is wrong)
//   score({ BENCH-1: { static, whitebox, api, ui }, ... }, expected) -> recall, per phase, false alarms, extra findings
const { sections } = require('./pipeline');
const rf = require('./report-format');

const LAYERS = ['static', 'whitebox', 'api', 'ui'];

/** A machine-readable block, when the report has one: ```json {"findings":[{"title":..,"detail":..}]} ```. */
function jsonFindings(report) {
  const m = String(report || '').match(/```json\s*([\s\S]*?)```/i);
  if (!m) return null;
  try {
    const d = JSON.parse(m[1]);
    const list = Array.isArray(d) ? d : Array.isArray(d.findings) ? d.findings : null;
    if (!list) return null;
    return list.map((f) => (typeof f === 'string' ? f : Object.values(f).filter((v) => typeof v === 'string' || typeof v === 'number').join('\n'))).filter(Boolean);
  } catch (_) { return null; }
}

/** Numbered or bulleted items of a block of text; a line that does not start an item continues the previous one. */
function items(text, start = /^\s*(?:\d+[.)]|[-*])\s+/) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    if (start.test(line)) out.push(line.replace(start, '').trim());
    else if (out.length) out[out.length - 1] += '\n' + line.trim();
  }
  return out.filter((t) => !/^none\.?$/i.test(t));
}

function staticFindings(report) {
  const s = sections(report);
  const f = items(s.findings);
  const q = items(s['open questions']);
  return [...f, ...q];
}

function whiteboxFindings(report) {
  const v = rf.parseAnalysis(String(report || ''), '');
  const out = v.cases.map((c) => [c.title, c.actual, c.expected, c.impact, c.proof].filter(Boolean).join('\n'));
  if (v.outside && !/^(brak|none|nic|-)\b/i.test(v.outside)) out.push(v.outside);
  if (v.integration && /błąd|nie |break|ignor|brak|missing|wrong|forgot|pomin/i.test(v.integration)) out.push(v.integration);
  return out;
}

function apiFindings(report) {
  const v = rf.parseReport('execution', String(report || ''), '');
  if (!v) return [];
  const errs = (v.errors || []).filter((e) => !/KONFIGURACJA|CONFIG/i.test(e.kind || ''))
    .map((e) => [e.title, e.endpoint, e.expected && 'expected: ' + e.expected, e.actual && 'got: ' + e.actual, e.gate].filter(Boolean).join('\n'));
  const bad = (v.steps || []).filter((s) => s.bad).map((s) => s.text);
  return [...errs, ...bad];
}

function uiFindings(report) {
  const text = String(report || '');
  const fails = text.split('\n').filter((l) => /^\s*\[[sa]\d+\]\s*FAIL\b/i.test(l)).map((l) => l.trim());
  const s = sections(text.replace(/^--- KONIEC TREŚCI ---[\s\S]*$/m, ''));
  const f = s.findings ? items(s.findings).length ? items(s.findings) : [s.findings].filter((t) => !/^none\.?$/i.test(t.trim())) : [];
  return [...fails, ...f];
}

/** The finding texts of one phase. A JSON block wins over the text, so the scorer follows the reports as they improve. */
function findings(layer, report) {
  if (!report) return [];
  const j = jsonFindings(report);
  if (j) return j;
  if (layer === 'static') return staticFindings(report);
  if (layer === 'whitebox') return whiteboxFindings(report);
  if (layer === 'api') return apiFindings(report);
  if (layer === 'ui') return uiFindings(report);
  return [];
}

const matches = (rule, text) => rule.match.some((alt) => alt.every((re) => re.test(text))) && !(rule.unless && rule.unless.test(text));

/**
 * reports: { [ticket]: { static, whitebox, api, ui } } (report texts; a missing phase is '').
 * expected: { DEFECTS, TRAPS } from eval/expected.js. Only the tickets present in `reports` are scored.
 */
function score(reports, expected) {
  const tickets = Object.keys(reports);
  const found = [], missed = [], falseAlarms = [];
  const phase = Object.fromEntries(LAYERS.map((l) => [l, { expected: 0, found: 0, findings: 0, matched: 0, ran: false }]));
  const used = new Set(); // "ticket|layer|index" of findings that matched a seeded defect
  const all = {};
  for (const t of tickets) for (const l of LAYERS) {
    all[t + '|' + l] = findings(l, reports[t][l]);
    if (reports[t][l]) { phase[l].ran = true; phase[l].findings += all[t + '|' + l].length; }
  }
  for (const d of expected.DEFECTS.filter((x) => tickets.includes(x.ticket))) {
    const by = [];
    for (const l of d.layers) all[d.ticket + '|' + l].forEach((f, i) => { if (matches(d, f)) { by.push(l); used.add(d.ticket + '|' + l + '|' + i); } });
    const layers = [...new Set(by)];
    const p = phase[d.primary];
    if (reports[d.ticket][d.primary]) p.expected += 1;
    if (layers.includes(d.primary)) p.found += 1;
    (layers.length ? found : missed).push({ id: d.id, ticket: d.ticket, what: d.what, primary: d.primary, by: layers });
  }
  for (const tr of expected.TRAPS.filter((x) => tickets.includes(x.ticket))) {
    for (const l of LAYERS) all[tr.ticket + '|' + l].forEach((f, i) => { if (matches(tr, f)) falseAlarms.push({ id: tr.id, ticket: tr.ticket, layer: l, what: tr.what, finding: f.slice(0, 300) }); });
  }
  const extra = [];
  for (const [k, list] of Object.entries(all)) list.forEach((f, i) => {
    const [t, l] = k.split('|');
    if (used.has(k + '|' + i)) phase[l].matched += 1;
    else extra.push({ ticket: t, layer: l, finding: f.slice(0, 300) });
  });
  const total = found.length + missed.length;
  return {
    recall: total ? Math.round((found.length / total) * 1000) / 1000 : 0,
    found: found.length, total, falseAlarms: falseAlarms.length,
    // Precision of the findings: share of the reported findings that point at a seeded defect. Real but unseeded
    // problems lower it too, so read `extra` before calling them noise.
    precision: (() => { const n = Object.values(phase).reduce((s, p) => s + p.findings, 0); const m = Object.values(phase).reduce((s, p) => s + p.matched, 0); return n ? Math.round((m / n) * 1000) / 1000 : null; })(),
    phase, foundList: found, missedList: missed, falseAlarmList: falseAlarms, extra,
  };
}

/** A short table for the terminal and for the history file. */
function summary(s, meta = {}) {
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '-');
  const lines = [`Detected ${s.found}/${s.total} seeded defects (${pct(s.found, s.total)}), false alarms ${s.falseAlarms}, findings that point at a seeded defect ${s.precision == null ? '-' : Math.round(s.precision * 100) + '%'}`
    + (meta.costUsd != null ? `, cost $${meta.costUsd.toFixed(2)}` : '') + (meta.minutes != null ? `, ${meta.minutes} min` : '')];
  lines.push('Phase      found by its own phase   findings  matched');
  for (const l of LAYERS) { const p = s.phase[l]; if (p.ran) lines.push(`${l.padEnd(10)} ${String(p.found + '/' + p.expected).padEnd(6)} ${pct(p.found, p.expected).padEnd(17)} ${String(p.findings).padEnd(9)} ${p.matched}`); }
  if (s.missedList.length) lines.push('Missed:', ...s.missedList.map((d) => `  ${d.id} [${d.primary}] ${d.what}`));
  if (s.falseAlarmList.length) lines.push('False alarms:', ...s.falseAlarmList.map((f) => `  ${f.id} [${f.layer}] ${f.what}`));
  return lines.join('\n');
}

module.exports = { findings, score, summary, matches, LAYERS };
