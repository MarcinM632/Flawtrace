// Strażnik reguły Hedge Exposure "AUTOTEST" wokół przebiegów pytest z pętli weryfikacji Autotests.
//   node scripts/autotest-guard.mjs snapshot <plik>   — zapisuje regułę, jaka jest teraz
//   node scripts/autotest-guard.mjs restore <plik>    — gdy reguła różni się od migawki, przywraca ją; wypisuje JSON {changed, restored, diff}
// Powód: wygenerowany test przebudował regułę pod siebie i nie przywrócił jej (2026-10-20), a hedger przyjmuje zmianę
// tylko wyłączonej reguły — przywrócenie musi więc wyłączyć regułę, zapisać ją i dopiero potem ustawić stan isEnabled.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mcp = path.resolve(here, '..', '..', 'mcp-server', 'src');
const load = (p) => import(pathToFileURL(path.join(mcp, p)).href);
const { findTool, targetFor } = await load('mcp/registry.js');
const { call } = await load('plat/client.js');

const RULE_NAME = 'AUTOTEST';
const BASE = '/api/hedger/config/hedge-exposure-rule';
const FIELDS = ['longThreshold', 'shortThreshold', 'enableTranches', 'trancheSize', 'minTrancheExposureVolume', 'sendNotificationToSlack', 'maxRejectsCount', 'rejectsTimeWindowMs', 'rejectCooldownMs'];
const A_FIELDS = ['hedgerId', 'hedgeSymbol', 'maxLotLimitForHedger', 'maxLotPerTrade', 'minOrderStep', 'assignmentWeight', 'isEnabled', 'executionCooldownMs'];
const target = targetFor(findTool('core_hedger_read_get_hedge_exposure_rule'));

async function readRule() {
  const r = await call(target, { method: 'GET', path: BASE });
  if (r.status >= 400) throw new Error(`GET ${BASE} -> HTTP ${r.status}`);
  const rules = Array.isArray(r.json) ? r.json : r.json.items;
  const rule = rules.find((x) => x.name === RULE_NAME);
  if (!rule) throw new Error(`Hedge rule ${RULE_NAME} not found`);
  return rule;
}

/** Porównywalny kształt reguły: bez id przypisań (zmieniają się przy ponownym utworzeniu), przypisania posortowane. */
const shape = (rule) => ({
  isEnabled: rule.isEnabled, exposureRuleId: rule.exposureRuleId, ...Object.fromEntries(FIELDS.map((k) => [k, rule[k]])),
  levels: [...rule.hedgerAssignmentLevels].sort((a, b) => a.priority - b.priority).map((l) => ({
    priority: l.priority,
    assignments: l.assignments.map((a) => Object.fromEntries(A_FIELDS.map((k) => [k, a[k]]))).sort((a, b) => a.hedgerId - b.hedgerId),
  })),
});

function diff(before, now) {
  const out = [];
  const a = shape(before), b = shape(now);
  for (const k of ['isEnabled', 'exposureRuleId', ...FIELDS]) if (a[k] !== b[k]) out.push(`${k}: ${a[k]} -> ${b[k]}`);
  const key = (l, x) => `P${l.priority}/${x.hedgerId}/${x.hedgeSymbol}`;
  const flat = (s) => new Map(s.levels.flatMap((l) => l.assignments.map((x) => [key(l, x), JSON.stringify(x)])));
  const fa = flat(a), fb = flat(b);
  for (const [k, v] of fa) if (!fb.has(k)) out.push(`assignment ${k} removed`); else if (fb.get(k) !== v) out.push(`assignment ${k} changed`);
  for (const k of fb.keys()) if (!fa.has(k)) out.push(`assignment ${k} added`);
  return out;
}

async function setEnabled(id, enabled) {
  const r = await call(target, { method: 'POST', path: `${BASE}/id/${id}/enabled`, query: { enabled } });
  if (r.status >= 400) throw new Error(`enable=${enabled} -> HTTP ${r.status}`);
}

async function restore(before) {
  const now = await readRule();
  const changes = diff(before, now);
  if (!changes.length) return { changed: false, restored: false, diff: [] };
  const live = new Set(now.hedgerAssignmentLevels.flatMap((l) => l.assignments.map((a) => a.id)));
  const body = {
    id: before.id, name: before.name, exposureRuleId: before.exposureRuleId, ...Object.fromEntries(FIELDS.map((k) => [k, before[k]])),
    hedgerAssignmentLevels: before.hedgerAssignmentLevels.map((l) => ({
      priority: l.priority,
      assignments: l.assignments.map((a) => ({ ...(live.has(a.id) ? { id: a.id } : {}), ...Object.fromEntries(A_FIELDS.map((k) => [k, a[k]])) })),
    })),
  };
  if (now.isEnabled) await setEnabled(before.id, false);
  const put = await call(target, { method: 'PUT', path: `${BASE}/id/${before.id}`, body });
  if (put.status >= 400) throw new Error(`PUT rule -> HTTP ${put.status}: ${JSON.stringify(put.json || put.text).slice(0, 300)}`);
  if (before.isEnabled) await setEnabled(before.id, true);
  const left = diff(before, await readRule());
  return { changed: true, restored: left.length === 0, diff: changes, left };
}

/**
 * Stan reguł AUTOTEST jako plik dla agenta Test design: projekt opisuje testy na tych kontach, symbolu i lotach,
 * z polami pod ich nazwami z API, zamiast na literach A/B/C i progu T.
 */
async function describe() {
  const rule = await readRule();
  const v = await call(target, { method: 'GET', path: '/api/hedger/config/volume-exposure-rule' });
  const volume = v.status < 400 ? (Array.isArray(v.json) ? v.json : v.json.items).find((x) => x.id === rule.exposureRuleId) : null;
  const symbols = [...new Set(rule.hedgerAssignmentLevels.flatMap((l) => l.assignments.map((a) => a.hedgeSymbol)))];
  let instruments = [];
  try {
    const m = await call(targetFor(findTool('manager_read_get_instruments')), { method: 'GET', path: '/v1/instruments' });
    const all = m.json.instruments || m.json.items || m.json;
    instruments = symbols.map((s) => all.find((i) => i.instrumentSymbol === s) || all.find((i) => i.instrumentAlias === s)).filter(Boolean);
  } catch (_) { /* bez lotSize projekt i tak podaje loty */ }
  const out = [
    '# Reguły AUTOTEST na test-env (system SYS), odczytane przez aplikację przed startem runu',
    `Odczyt: ${new Date().toISOString()}. To jest środowisko, na którym tester wykona projekt: opisuj testy na TYCH kontach, symbolu i wartościach.`,
    '',
    `## Hedge Exposure Rule "${rule.name}" (id ${rule.id})`,
    `isEnabled=${rule.isEnabled}, ${FIELDS.map((k) => `${k}=${rule[k]}`).join(', ')}`,
    '',
    '| priority | hedgerId | hedgeSymbol | assignmentWeight | maxLotLimitForHedger | maxLotPerTrade | minOrderStep | executionCooldownMs | isEnabled |',
    '|---|---|---|---|---|---|---|---|---|',
    ...[...rule.hedgerAssignmentLevels].sort((a, b) => a.priority - b.priority).flatMap((l) => l.assignments.map((a) =>
      `| ${l.priority} | ${a.hedgerId} | ${a.hedgeSymbol} | ${a.assignmentWeight} | ${a.maxLotLimitForHedger} | ${a.maxLotPerTrade} | ${a.minOrderStep} | ${a.executionCooldownMs} | ${a.isEnabled} |`)),
    '',
  ];
  if (volume) {
    out.push(`## Volume Exposure Rule "${volume.name}" (id ${volume.id}) — konta klientów objęte regułą`);
    for (const s of volume.systemRules || []) {
      out.push(`- system ${s.system}, symbolGroupPattern ${s.symbolGroupPattern}, symbolPattern ${s.symbolPattern}: ` +
        (s.clientCoverages || []).map((c) => `klient ${c.clientId} coveragePercentage ${c.coveragePercentage}`).join(', ') +
        (s.tierId ? `; tier ${s.tierId} (tierCoverageMultiplier ${s.tierCoverageMultiplier})` : ''));
    }
    out.push('');
  }
  if (instruments.length) {
    out.push('## Instrument (PLAT Manager)');
    for (const i of instruments) out.push(`- ${i.instrumentSymbol}: lotSize ${i.lotSize}, volumePrecision ${i.volumePrecision}, contractSize ${i.contractSize} (1 lot = ${i.lotSize} jednostek wolumenu w Manager API)`);
    out.push('');
  }
  return out.join('\n');
}

const [mode, file] = process.argv.slice(2);
if (mode === 'snapshot') {
  fs.writeFileSync(file, JSON.stringify(await readRule()));
  process.stdout.write(JSON.stringify({ ok: true }));
} else if (mode === 'describe') {
  fs.writeFileSync(file, await describe());
  process.stdout.write(JSON.stringify({ ok: true }));
} else if (mode === 'restore') {
  process.stdout.write(JSON.stringify(await restore(JSON.parse(fs.readFileSync(file, 'utf8')))));
} else {
  throw new Error('usage: autotest-guard.mjs snapshot|restore|describe <file>');
}
