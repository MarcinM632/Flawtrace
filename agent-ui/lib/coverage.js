// Coverage watch: nowy komentarz na tasku z Workspace (lib/workspace.js) -> sprawdź, czy zmiana w
// repo serwisu (GitLab) ma odzwierciedlenie w faktycznie WYKONANYCH testach (historia runów tej
// appki) — i policz procent pokrytej logiki biznesowej względem benchmarku 100%. Nie czeka na
// powiązanie Jira<->MR (ten mechanizm w tej Jirze nie jest w ogóle podłączony — pole "Development"
// jest puste nawet na ticketach z merge'em), tylko patrzy w repo danego serwisu: ostatnie commity
// na gałęzi domyślnej od daty założenia ticketu.
const fs = require('fs');
const path = require('path');
const { DATA_DIR, RUNS_DIR } = require('./config');
const { claudeOnce } = require('./claude-once');
const gitlab = require('./gitlab');
const workspace = require('./workspace');

const STATE_FILE = path.join(DATA_DIR, 'coverage.json');
const POLL_EVERY = (Number(process.env.COVERAGE_WATCH_MINUTES) || 30) * 60 * 1000;

let state = { seenComments: {}, results: {} }; // key -> comment count widziany ostatnio | key -> wynik oceny
try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) { /* pierwszy start */ }
const save = () => { try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch (_) { /* nieistotne */ } };

const busy = new Set();

/** Runy tej appki (QA MCP, Autotests, design/flow) dotyczące danego ticketu — to jest "co faktycznie
 * wykonano", nie lista istniejących plików testowych. meta.ticket bywa wolnym tekstem ze zleceniem,
 * więc dopasowanie to klucz jako całe słowo, nie samo query startsWith. */
function executedEvidence(key) {
  const re = new RegExp(`\\b${key}\\b`, 'i');
  const out = [];
  let files; try { files = fs.readdirSync(RUNS_DIR).filter((f) => f.endsWith('.json')); } catch (_) { return out; }
  for (const f of files) {
    let d; try { d = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), 'utf8')); } catch (_) { continue; }
    const m = d.meta;
    if (!m || m.status !== 'done' || !re.test(`${m.ticket || ''}\n${m.notes || ''}`)) continue;
    out.push({ agent: m.label || m.agent, reportStatus: m.reportStatus || '', finishedAt: m.finishedAt, text: String(m.finalText || '').slice(0, 1500) });
  }
  out.sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
  return out.slice(0, 8);
}

const SYSTEM = `Jesteś QA auditorem coverage. Dostajesz: opis ticketu (nowa funkcjonalność/zmiana), diff kodu z repo serwisu
i dowody faktycznie WYKONANYCH testów (raporty z przebiegów agentów QA). Twoje zadanie: wypisać reguły biznesowe/zachowania
wprowadzone lub zmienione w diffie, i dla każdej ocenić, czy dowody wykonanych testów ją faktycznie sprawdzają (nie wystarczy,
że test "dotyka" tego samego pliku/serwisu — musi sprawdzać TĘ regułę). Benchmark to 100% = każda reguła z diffu ma dowód
wykonania. Nie zgaduj i nie zakładaj testu, którego nie widzisz w dowodach. Brak dowodów = diff niepokryty, nawet jeśli
wygląda na prosty. Odpowiedz WYŁĄCZNIE jednym obiektem JSON, bez tekstu przed/po, bez bloku kodu:
{"rules":[{"rule":"<krótki opis reguły/zachowania ze zmiany>","covered":true|false,"evidence":"<który dowód to pokrywa, albo pusty>"}],
"percent":<liczba całkowita 0-100, covered/total reguł>,"gaps":["<reguła bez dowodu>", ...],"note":"<1-2 zdania, po polsku>"}
Gdy diff jest pusty albo nie zawiera zmian logiki (np. tylko formatowanie/zależności), zwróć rules:[], percent:100, gaps:[],
note wyjaśniające że nie było logiki do pokrycia.`;

async function evaluate(task) {
  const key = task.key;
  const result = { key, computedAt: Date.now(), ok: false };
  try {
    if (!task.service || task.service === 'nieustalony') {
      result.error = 'Service not identified for this ticket — cannot pick a GitLab repo.';
      return result;
    }
    const proj = await gitlab.findProject(task.service);
    if (!proj) {
      result.error = `No GitLab project found matching service "${task.service}".`;
      return result;
    }
    result.repo = proj.path;
    const commits = await gitlab.recentCommits(proj.id, proj.defaultBranch, task.created, 15);
    if (!commits.length) {
      result.ok = true; result.percent = null; result.rules = []; result.gaps = [];
      result.note = `No commits found on ${proj.defaultBranch} since ${task.created || '(unknown date)'} — nothing to compare yet.`;
      return result;
    }
    let dossier = '';
    for (const c of commits) {
      dossier += `\n### commit ${c.short_id} — ${c.title}\n`;
      const files = await gitlab.commitDiff(proj.id, c.id);
      for (const f of files) dossier += `-- ${f.path} --\n${f.diff}\n`;
      if (dossier.length > 45000) { dossier = dossier.slice(0, 45000) + '\n...(truncated)'; break; }
    }
    const evidence = executedEvidence(key);
    const input = `TICKET ${key}: ${task.summary}\nType: ${task.type} · Status: ${task.status}\nRepo: ${proj.path} (branch ${proj.defaultBranch})\n\n`
      + `=== CODE DIFF (${commits.length} recent commits since ${task.created || 'unknown'}) ===\n${dossier || '(no diff content)'}\n\n`
      + `=== EXECUTED TEST EVIDENCE (this app's run history) ===\n${evidence.length ? evidence.map((e) => `[${e.agent}, ${e.reportStatus}] ${e.text}`).join('\n---\n') : '(no runs found for this ticket)'}`;
    const { text } = await claudeOnce(SYSTEM, input, 240000);
    const a = text.indexOf('{'), z = text.lastIndexOf('}');
    const j = JSON.parse(text.slice(a, z + 1));
    result.ok = true;
    result.percent = Math.max(0, Math.min(100, Math.round(Number(j.percent) || 0)));
    result.rules = Array.isArray(j.rules) ? j.rules.slice(0, 30) : [];
    result.gaps = Array.isArray(j.gaps) ? j.gaps.slice(0, 30) : [];
    result.note = String(j.note || '').slice(0, 500);
  } catch (e) {
    result.error = String((e && e.message) || e).slice(0, 300);
  }
  return result;
}

async function triggerCheck(task) {
  const key = task.key;
  if (busy.has(key)) return;
  busy.add(key);
  try {
    state.results[key] = { ...(state.results[key] || {}), checking: true };
    const r = await evaluate(task);
    state.results[key] = r;
    save();
  } finally { busy.delete(key); }
}

/** Nowe komentarze od ostatniego sprawdzenia -> przelicz coverage. Pierwszy raz widziany ticket tylko
 * zapisuje punkt odniesienia (ten sam powód co w release-watch: nie odpalać się dla całego backlogu
 * komentarzy, które już tam były, zanim appka ruszyła). */
async function checkAll() {
  await workspace.refresh(false).catch(() => {});
  for (const task of workspace.state.tasks) {
    const prev = state.seenComments[task.key];
    if (prev === undefined) { state.seenComments[task.key] = task.comments; continue; }
    if (task.comments > prev) {
      state.seenComments[task.key] = task.comments;
      save();
      triggerCheck(task).catch(() => {});
    } else if (task.comments !== prev) {
      state.seenComments[task.key] = task.comments; // komentarz usunięty — tylko zaktualizuj punkt odniesienia
    }
  }
  save();
}

let started = false;
function start() {
  if (started) return;
  started = true;
  checkAll().catch(() => {});
  setInterval(() => checkAll().catch(() => {}), POLL_EVERY);
}

const forCheck = (key) => state.results[key.toUpperCase()] || null;
/** Ręczne wymuszenie (przycisk w UI) — nie czeka na nowy komentarz. */
function forceCheck(key) {
  const task = workspace.state.tasks.find((t) => t.key === key.toUpperCase());
  if (!task) throw Object.assign(new Error('Unknown task — refresh Workspace first'), { status: 404 });
  if (busy.has(task.key)) return state.results[task.key] || { key: task.key, checking: true };
  triggerCheck(task).catch(() => {});
  return { key: task.key, checking: true };
}

module.exports = { forCheck, forceCheck, start };
