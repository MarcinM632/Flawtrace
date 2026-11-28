#!/usr/bin/env node
// Live benchmark of the testing flow: runs Full tests on the benchmark shop (eval/) with real agents and scores the result.
//
//   npm run eval                          all tickets, one after another
//   npm run eval -- --only BENCH-2        some tickets (comma separated)
//   npm run eval -- --parallel            all tickets at the same time (faster, same cost)
//   npm run eval -- --budget 3            pause a case after $3 (then it is stopped and scored as it is)
//   npm run eval -- --score <resultsDir>  score saved reports again, no agents (after a change of the scorer)
//   --dry                                 only check the setup (shop, spec, repo, agents), start no case
//   --keep                                keep the temporary data folder (runs, clones) for a look
//
// What it does: builds the shop repo, starts the shop and a separate Flawtrace instance with its own data folder (your
// own settings, lessons and product knowledge are not touched and not used), connects the shop's API, spec and repo,
// starts one Full test per ticket, continues past a BLOCKED review, waits, reads the phase reports and scores them
// against eval/expected.js. Results: eval/results/<stamp>/ (reports + score), one line per run in eval/history.jsonl.
// It spends real tokens: roughly the price of 3 Full tests.
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, execFileSync } = require('child_process');
const { build } = require('../eval/build-shop');
const expected = require('../eval/expected');
const { score, summary, LAYERS } = require('../lib/eval-score');

const APP = path.join(__dirname, '..');
const EVAL = path.join(APP, 'eval');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

async function http(base, method, p, body) {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch (_) { data = text; }
  if (!res.ok) throw new Error(`${method} ${p}: HTTP ${res.status} ${typeof data === 'string' ? data.slice(0, 200) : data.error || ''}`);
  return data;
}
async function waitUp(base, p, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { await http(base, 'GET', p); return; } catch (_) { await sleep(500); } }
  throw new Error('Not up in time: ' + base + p);
}

function startChild(cmd, argv, env, logFile) {
  const out = fs.openSync(logFile, 'a');
  const c = spawn(cmd, argv, { env: { ...process.env, ...env }, stdio: ['ignore', out, out], windowsHide: true });
  return c;
}

const commit = () => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: APP, encoding: 'utf8' }).trim(); } catch (_) { return ''; } };

/** Reads the reports of a results folder: <dir>/<ticket>/<phase>.md */
function readResults(dir) {
  const reports = {};
  for (const t of fs.readdirSync(dir).filter((n) => expected.TICKETS[n])) {
    reports[t] = {};
    for (const l of LAYERS) { const f = path.join(dir, t, l + '.md'); reports[t][l] = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; }
  }
  return reports;
}

async function runCase(base, ticket, shopBase, budget, timeoutMin) {
  const t = expected.TICKETS[ticket];
  const text = fs.readFileSync(path.join(EVAL, 'tickets', t.file), 'utf8');
  const c = await http(base, 'POST', '/api/fulltest', {
    task: text, details: '', stages: t.stages, family: 'core', url: shopBase + t.page,
    username: 'demo@shop.test', password: 'Demo12345', budgetUsd: budget || 0,
  });
  log(`${ticket}: case ${c.id} started (${Object.entries(t.stages).filter(([, v]) => v).map(([k]) => k).join(', ')})`);
  const end = Date.now() + timeoutMin * 60000;
  const notes = [];
  let retried = false, last = '';
  for (;;) {
    await sleep(10000);
    const v = await http(base, 'GET', '/api/fulltest/' + c.id);
    const now = LAYERS.concat('design').map((k) => `${k}:${v.stages[k].status}`).join(' ');
    if (now !== last) { log(`${ticket}: ${v.status} | ${now} | $${v.costUsd}`); last = now; }
    if (['done', 'waiting', 'cancelled', 'failed'].includes(v.status)) return { view: v, notes };
    if (Date.now() > end) { notes.push('timed out, stopped'); await http(base, 'POST', `/api/fulltest/${c.id}/stop`, {}); return { view: await http(base, 'GET', '/api/fulltest/' + c.id), notes }; }
    if (v.status === 'paused') {
      const p = v.pause || {};
      notes.push(`paused at ${p.stage}: ${p.reason}`);
      if (/budget/i.test(p.reason || '')) { await http(base, 'POST', `/api/fulltest/${c.id}/stop`, {}); continue; }
      if (p.stage === 'static' && (p.actions || []).includes('continue')) { log(`${ticket}: review said BLOCKED, continuing`); await http(base, 'POST', `/api/fulltest/${c.id}/continue`, {}); continue; }
      if ((p.actions || []).includes('retry') && !retried) { retried = true; log(`${ticket}: ${p.reason} - retrying once`); await http(base, 'POST', `/api/fulltest/${c.id}/retry`, {}); continue; }
      await http(base, 'POST', `/api/fulltest/${c.id}/stop`, {});
    }
  }
}

async function main() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  const historyFile = path.join(EVAL, 'history.jsonl');

  if (opt('score')) {
    const dir = path.resolve(String(opt('score')));
    const s = score(readResults(dir), expected);
    fs.writeFileSync(path.join(dir, 'score.json'), JSON.stringify(s, null, 2));
    console.log(summary(s));
    return;
  }

  const only = typeof opt('only') === 'string' ? opt('only').split(',').map((x) => x.trim().toUpperCase()) : Object.keys(expected.TICKETS);
  for (const t of only) if (!expected.TICKETS[t]) throw new Error('Unknown ticket ' + t + '. Known: ' + Object.keys(expected.TICKETS).join(', '));
  const budget = Number(opt('budget', 0)) || 0;
  const timeoutMin = Number(opt('timeout', 75)) || 75;
  const resultsDir = path.join(EVAL, 'results', stamp);
  fs.mkdirSync(resultsDir, { recursive: true });

  // The long form of the temp folder: the 8.3 short form (PCGAME~1) does not match the agents' permission rules.
  const work = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'flawtrace-eval-'));
  const dataDir = path.join(work, 'data');
  const knowledge = path.join(work, 'knowledge');
  fs.mkdirSync(dataDir, { recursive: true }); fs.mkdirSync(knowledge, { recursive: true });
  // Only the generic testing know-how of the app; product knowledge and lessons of your own work stay out of the benchmark.
  for (const f of fs.readdirSync(path.join(APP, '..', 'knowledge')).filter((n) => n.endsWith('.md'))) fs.copyFileSync(path.join(APP, '..', 'knowledge', f), path.join(knowledge, f));

  const shop = build(path.join(work, 'shop'));
  const shopPort = await freePort(), appPort = await freePort();
  const shopBase = `http://127.0.0.1:${shopPort}`, base = `http://127.0.0.1:${appPort}`;
  const children = [];
  const cleanup = () => { for (const c of children) { try { c.kill(); } catch (_) { /* gone */ } } };
  process.on('SIGINT', () => { cleanup(); process.exit(130); });

  try {
    children.push(startChild(process.execPath, [path.join(shop.app, 'server.js')], { PORT: String(shopPort) }, path.join(resultsDir, 'shop.log')));
    await waitUp(shopBase, '/openapi.json');
    log('Shop on ' + shopBase);

    fs.writeFileSync(path.join(dataDir, 'sources.json'), JSON.stringify({
      repos: [{ name: 'shop', url: shop.originUrl, branch: 'develop' }], knowledgeDir: knowledge,
      api: { baseUrl: shopBase, authHeader: 'Authorization', authValue: '', specs: [], readOnly: false },
    }, null, 2));
    children.push(startChild(process.execPath, [path.join(APP, 'server.js')], { PORT: String(appPort), QA_DATA_DIR: dataDir, QA_SOURCES_FILE: '', HOST: '127.0.0.1' }, path.join(resultsDir, 'app.log')));
    await waitUp(base, '/api/sources');
    await http(base, 'POST', '/api/sources/specs/upload', { name: 'shop', text: fs.readFileSync(path.join(shop.app, 'openapi.json'), 'utf8') });
    const sync = await http(base, 'POST', '/api/sources/repos/sync', {});
    if (!sync.results.every((r) => r.ok)) throw new Error('Repo sync failed: ' + JSON.stringify(sync.results));
    const ft = await http(base, 'GET', '/api/fulltest');
    if (!ft.agents.api) throw new Error('The API track is not available in the eval instance (spec or base URL not taken).');
    log(`Flawtrace (eval instance) on ${base}, data in ${dataDir}`);
    if (opt('dry')) { log(`Dry run: setup works (spec, repo, API track, whitebox: ${ft.agents.whitebox.join(',') || 'none'}, UI: ${ft.agents.ui}). No case started.`); fs.rmSync(resultsDir, { recursive: true, force: true }); return; }

    const started = Date.now();
    const outcomes = {};
    const one = async (t) => { try { outcomes[t] = await runCase(base, t, shopBase, budget, timeoutMin); } catch (e) { outcomes[t] = { error: e.message, notes: [] }; log(`${t}: ${e.message}`); } };
    if (opt('parallel')) await Promise.all(only.map(one)); else for (const t of only) await one(t);

    // Reports of every phase, saved as files so they can be read and scored again.
    const reports = {};
    let cost = 0;
    const cases = {};
    for (const t of only) {
      reports[t] = Object.fromEntries(LAYERS.map((l) => [l, '']));
      const o = outcomes[t];
      fs.mkdirSync(path.join(resultsDir, t), { recursive: true });
      if (!o || !o.view) { cases[t] = { error: (o && o.error) || 'no case' }; continue; }
      cost += o.view.costUsd || 0;
      cases[t] = { id: o.view.id, status: o.view.status, costUsd: o.view.costUsd, notes: o.notes, stages: Object.fromEntries(Object.entries(o.view.stages).map(([k, s]) => [k, { status: s.status, note: s.note, costUsd: s.costUsd, seconds: s.finishedAt && s.startedAt ? Math.round((s.finishedAt - s.startedAt) / 1000) : null }])) };
      for (const k of [...LAYERS, 'design']) {
        const id = o.view.stages[k].runId;
        if (!id) continue;
        const r = await http(base, 'GET', '/api/runs/' + id).catch(() => null);
        const text = r && r.meta ? String(r.meta.report || r.meta.finalText || '') : '';
        fs.writeFileSync(path.join(resultsDir, t, k + '.md'), text);
        if (LAYERS.includes(k)) reports[t][k] = text;
      }
    }
    const s = score(reports, expected);
    const minutes = Math.round((Date.now() - started) / 60000);
    fs.writeFileSync(path.join(resultsDir, 'score.json'), JSON.stringify({ ...s, cases }, null, 2));
    const text = summary(s, { costUsd: cost, minutes });
    fs.writeFileSync(path.join(resultsDir, 'summary.txt'), text + '\n');
    fs.appendFileSync(historyFile, JSON.stringify({ at: new Date().toISOString(), commit: commit(), tickets: only, recall: s.recall, found: s.found, total: s.total, falseAlarms: s.falseAlarms, precision: s.precision,
      phase: Object.fromEntries(LAYERS.map((l) => [l, s.phase[l].ran ? `${s.phase[l].found}/${s.phase[l].expected}` : null])), costUsd: Math.round(cost * 100) / 100, minutes, missed: s.missedList.map((d) => d.id) }) + '\n');
    console.log('\n' + text + '\n\nReports and score: ' + resultsDir);
  } finally {
    cleanup();
    if (!opt('keep')) { await sleep(1000); try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) { console.log('Could not remove ' + work); } }
    else console.log('Kept: ' + work);
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
