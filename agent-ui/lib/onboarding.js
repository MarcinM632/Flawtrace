// Onboarding: turns the connected sources into product knowledge the agents start from.
//
//   1. Scan     (no model)  Confluence pages, Jira issues, repository docs and structure, the API model, the team's own
//                           knowledge files and past runs are read into numbered documents [S1], [S2], ...
//   2. Extract  (model)     Batches of documents -> short facts, each with the ids of the documents it comes from.
//                           A fact without a valid id is dropped, so nothing enters the knowledge base unsourced.
//   3. Write    (model)     One Markdown file per topic (overview, glossary, business rules, test flows, known defects,
//                           risk areas), built only from the facts, with [S] citations checked against the scan.
//   4. Digest   (model)     A short briefing that every agent gets at the start of every run.
//
// Output lives in <knowledge folder>/product/ and is read by the agents through the same knowledge tools as the rest of
// the knowledge base. A file the user edited by hand (its generated marker removed) is never overwritten: the new draft
// is saved beside it as <name>.new.md. Nothing is invented by code; the model only restates what the sources say.
const fs = require('fs');
const path = require('path');

const MARK = '<!-- flawtrace:generated -->';
const PER_DOC = 7000;
const DEPTH = { quick: { chars: 120000, docs: 40, jira: 30, batch: 14000 }, standard: { chars: 250000, docs: 90, jira: 70, batch: 14000 }, deep: { chars: 500000, docs: 200, jira: 160, batch: 14000 } };
const SHIPPED = new Set(['README.md', 'test-process.md', 'test-techniques.md', 'performance-testing.md']);
const TYPES = ['module', 'actor', 'term', 'rule', 'flow', 'defect', 'risk', 'env'];

// What each generated file is and which facts feed it.
const OUTPUTS = [
  { file: 'product/overview.md', title: 'Product overview', types: ['module', 'actor', 'env'], ask: 'what the product is for, its modules and how they relate, who uses it (actors and roles), environments and integrations. Short sections, one per module or actor.' },
  { file: 'product/glossary.md', title: 'Glossary', types: ['term'], ask: 'a glossary: term, what it means in this product, and the names it goes by in other places (synonyms, translations, field names). Alphabetical bullets "**term** - meaning".' },
  { file: 'product/business-rules.md', title: 'Business rules', types: ['rule'], ask: 'the business rules, limits, thresholds, validations, statuses and state transitions, grouped by module. Keep exact numbers, field names and status names. Where two sources disagree, list both under "## Conflicts".' },
  { file: 'product/test-flows.md', title: 'Key flows and test data', types: ['flow', 'env'], ask: 'the main user and API flows. For each: name, preconditions, steps in order, expected result, test data or accounts to use. Only what the sources state.' },
  { file: 'product/known-defects.md', title: 'Known defects and fragile areas', types: ['defect', 'risk'], ask: 'recurring defect patterns, past defects worth re-checking and the areas that break often. For each: what went wrong, where, and what to re-check when this area changes.' },
];

const clip = (s, n) => { const t = String(s == null ? '' : s); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/* ------------------------------------------------------------ pure helpers ------------------------------------------------------------ */

/** Groups documents into batches that fit the size limit; a document never gets split. */
function batches(docs, limit) {
  const out = []; let cur = []; let n = 0;
  for (const d of docs) {
    const len = d.text.length + d.title.length + 40;
    if (cur.length && n + len > limit) { out.push(cur); cur = []; n = 0; }
    cur.push(d); n += len;
  }
  if (cur.length) out.push(cur);
  return out;
}

const docBlock = (d) => `### [${d.id}] ${d.kind}: ${d.title}${d.ref ? ' (' + d.ref + ')' : ''}\n${d.text}`;

/** Reads the model's answer into facts. Tolerates code fences and text around the JSON. */
function parseFacts(text, validIds) {
  let t = String(text || '').replace(/```(?:json)?/gi, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return { facts: [], dropped: 0, bad: true };
  let j; try { j = JSON.parse(t.slice(a, b + 1)); } catch (_) { return { facts: [], dropped: 0, bad: true }; }
  const out = []; let dropped = 0;
  for (const f of Array.isArray(j.facts) ? j.facts : []) {
    const type = TYPES.includes(f && f.type) ? f.type : '';
    const text1 = clip(String(f && f.text || '').replace(/\s+/g, ' ').trim(), 500);
    const src = [...new Set((Array.isArray(f && f.src) ? f.src : [f && f.src]).map((x) => String(x || '').replace(/[\[\]\s]/g, '')).filter((x) => validIds.has(x)))];
    if (!type || text1.length < 8 || !src.length) { dropped++; continue; }
    out.push({ type, text: text1, src });
  }
  return { facts: out, dropped, bad: false };
}

/** Same statement from two batches: keep one, with the union of sources. */
function dedupe(facts) {
  const m = new Map();
  for (const f of facts) {
    const k = f.type + '|' + norm(f.text);
    const have = m.get(k);
    if (have) have.src = [...new Set([...have.src, ...f.src])]; else m.set(k, { ...f, src: [...f.src] });
  }
  return [...m.values()];
}

/** Checks the citations of a generated document against the scan: unknown ids are removed, and a content line that
 *  cites nothing real is dropped. Returns the cleaned text and what was removed. */
function checkCitations(md, validIds) {
  let removed = 0, unsourced = 0;
  const cited = new Set();
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n').map((line) => {
    if (/^\s*(#|>|\||```|---)/.test(line) || !line.trim()) return line;
    const ids = [...line.matchAll(/\[(S\d+)\]/g)].map((m) => m[1]);
    let l = line;
    for (const id of ids) if (!validIds.has(id)) { l = l.split('[' + id + ']').join(''); removed++; }
    const good = ids.filter((id) => validIds.has(id));
    good.forEach((id) => cited.add(id));
    if (/^\s*([-*]|\d+\.)\s+\S/.test(l) && !good.length) { unsourced++; return null; }
    return l.replace(/[ \t]+$/g, '');
  }).filter((l) => l !== null);
  return { text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), removed, unsourced, cited };
}

/** The list of the documents a file cites, so every statement can be traced back. */
function sourcesIndex(cited, docsById) {
  const rows = [...cited].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).map((id) => docsById.get(id)).filter(Boolean)
    .map((d) => `- [${d.id}] ${d.kind}: ${d.title}${d.ref ? ' - ' + d.ref : ''}`);
  return rows.length ? '\n\n## Sources\n\n' + rows.join('\n') : '';
}

const header = (title, ctx) => `${MARK}\n# ${title}\n\n> Generated by Flawtrace onboarding on ${ctx.date} from ${ctx.docs} source documents. Every statement cites its source as [S#]; the list is at the end. Edit freely: remove the first line of this file and Flawtrace will keep your version when it runs again.\n\n`;

/* ------------------------------------------------------------ prompts ------------------------------------------------------------ */

const LANG = (l) => (l && l !== 'auto' ? `Write in ${l}.` : 'Write in the language of the source documents; keep names, field names, statuses and numbers exactly as they appear.');

const EXTRACT_SYSTEM = (lang) => `You build a product knowledge base for software testers from source documents (specifications, tickets, code documentation, earlier test reports).
Extract ONLY what the documents state. Never use general knowledge, never guess, never fill gaps. If a document says nothing useful, return no facts for it.
Answer with ONE JSON object and nothing else: {"facts":[{"type":"<type>","text":"<one self-contained statement>","src":["S1","S4"]}]}
Types: module (a part of the product and what it does), actor (a user role or external system and what it may do), term (a word or name and what it means here), rule (a business rule, limit, threshold, validation, status or transition, with the exact values), flow (a user or API flow: steps, preconditions, expected result), defect (a defect or failed check from the past: what went wrong and where), risk (an area that is fragile, complex or often changed), env (an environment, account, test-data or configuration fact).
Rules: one statement per fact; keep exact names, numbers, field names and status names; "src" lists the ids of the documents the statement comes from (the [S..] in the headings) and must not be empty; at most 30 facts; skip marketing text and anything that is not about how the product behaves. ${lang}`;

const WRITE_SYSTEM = (title, ask, lang) => `You write one document of a QA knowledge base: "${title}".
Write ${ask}
Use ONLY the facts given below. Do not add anything that is not in them and do not repeat the same fact twice. Every bullet or sentence ends with the ids of its sources exactly as given, like [S3] or [S3][S8]. Use Markdown with ## headings. No introduction, no closing remarks, no advice that is not a fact. ${lang}`;

const DIGEST_SYSTEM = (lang) => `You write a briefing for a software tester who starts work on this product today and has two minutes to read it.
Use ONLY the text below. At most 1500 characters. Cover: what the product is, its main modules, the most important business rules with exact values, the riskiest areas, and one line on what is still unknown. Plain sentences or short bullets, no headings, no source ids. ${lang}`;

/* ------------------------------------------------------------ the engine ------------------------------------------------------------ */

/**
 * deps: { sources, llm, knowledgeDir, dataDir, runs(): [{meta, events}], now? }
 * sources: the lib/sources.js API; llm: { complete(system, input, opts) -> { text, costUsd? }, current() }
 */
function create(deps) {
  const now = deps.now || Date.now;
  const stateFile = path.join(deps.dataDir, 'onboarding.json');
  const workDir = path.join(deps.dataDir, 'onboarding');
  let st = load();
  let cancel = false;
  let running = null;

  function load() {
    try { const s = JSON.parse(fs.readFileSync(stateFile, 'utf8')); if (s.status === 'running') { s.status = 'failed'; s.error = 'Interrupted by a restart.'; } return s; } catch (_) { return { status: 'idle', steps: [], log: [] }; }
  }
  const persist = () => { try { fs.mkdirSync(deps.dataDir, { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(st)); } catch (_) { /* kept in memory */ } };
  const log = (m) => { st.log.push(new Date(now()).toISOString().slice(11, 19) + ' ' + m); if (st.log.length > 200) st.log.shift(); persist(); };
  const step = (key, status, note) => { const s = st.steps.find((x) => x.key === key); if (s) { s.status = status; if (note !== undefined) s.note = note; } persist(); };
  const stopIfCancelled = () => { if (cancel) throw Object.assign(new Error('Stopped by you.'), { cancelled: true }); };
  const kdir = () => deps.knowledgeDir();

  /* ---- 1. scan ---- */
  async function scan(opts, lim) {
    const docs = [];
    const budget = { chars: 0 };
    const add = (kind, title, ref, text) => {
      const t = clip(String(text || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), PER_DOC);
      if (t.length < 80 || budget.chars + t.length > lim.chars || docs.length >= lim.docs + lim.jira + 60) return false;
      budget.chars += t.length; docs.push({ id: 'S' + (docs.length + 1), kind, title: clip(title, 160), ref: ref || '', text: t }); return true;
    };
    const src = deps.sources, s = src.status();
    const counts = {};
    const count = (k) => { counts[k] = (counts[k] || 0) + 1; };

    // Documents the team wrote: first, because they are the most reliable.
    for (const f of src.knowledgeFiles().files) {
      const base = path.basename(f.path);
      if (f.path.startsWith('product/') || f.path.startsWith('lessons/') || (SHIPPED.has(base) && !f.path.includes('/'))) continue;
      if (!/\.(md|txt|feature|ya?ml|csv|json)$/i.test(f.path) || f.size > 400000) continue;
      try { if (add('knowledge', f.path, f.path, fs.readFileSync(path.join(kdir(), f.path), 'utf8'))) count('knowledge'); } catch (_) { /* unreadable */ }
    }
    stopIfCancelled();

    if (s.confluence && src.confluenceList) {
      try {
        const pages = await src.confluenceList(Math.min(lim.docs, 120));
        log(`Confluence: ${pages.length} page(s) found`);
        await pool(pages, 4, async (p) => {
          stopIfCancelled();
          try { const full = await src.confluencePage(p.id); if (add('confluence', full.title, full.url, full.text)) count('confluence'); } catch (e) { log(`Confluence page ${p.id} skipped: ${clip(e.message, 80)}`); }
        });
      } catch (e) { log('Confluence skipped: ' + clip(e.message, 140)); }
    }
    stopIfCancelled();

    if (s.jira) {
      try {
        const keys = src.jiraProjectKeys();
        const clause = src.projectClause ? src.projectClause(keys) : '';
        const fields = ['summary', 'description', 'issuetype', 'status', 'components', 'labels', 'comment', 'resolution'];
        const groups = [['Bug', Math.ceil(lim.jira * 0.5)], ['Epic', Math.ceil(lim.jira * 0.15)], ['Story', Math.ceil(lim.jira * 0.35)]];
        for (const [type, n] of groups) {
          stopIfCancelled();
          const q = src.jql(clause, `issuetype = ${type}`, 'ORDER BY updated DESC');
          const list = await src.jiraSearchAll(q, fields, n);
          log(`Jira ${type}: ${list.length} issue(s)`);
          for (const i of list) {
            const f = i.fields || {};
            const comments = ((f.comment && f.comment.comments) || []).slice(-4).map((c) => '- ' + clip(src.adfText(c.body).replace(/\s+/g, ' ').trim(), 400)).join('\n');
            const text = [`${i.key} [${type}] status: ${(f.status && f.status.name) || ''}${f.resolution ? ' (' + f.resolution.name + ')' : ''}`,
              (f.components || []).length ? 'Components: ' + f.components.map((c) => c.name).join(', ') : '', (f.labels || []).length ? 'Labels: ' + f.labels.join(', ') : '',
              clip(src.adfText(f.description).trim(), 2500), comments ? 'Comments:\n' + comments : ''].filter(Boolean).join('\n');
            if (add('jira-' + type.toLowerCase(), `${i.key} ${f.summary || ''}`, i.key, text)) count('jira');
          }
        }
      } catch (e) { log('Jira skipped: ' + clip(e.message, 140)); }
    }
    stopIfCancelled();

    for (const r of src.repoList().filter((x) => x.ready)) {
      try { for (const d of repoDocs(r)) if (add('repo', `${r.name}: ${d.title}`, `${r.name}/${d.title}`, d.text)) count('repo'); } catch (e) { log(`Repository ${r.name} skipped: ${clip(e.message, 100)}`); }
    }
    if (s.api) { try { if (add('api', 'API model of the test environment', '', src.appModel().markdown)) count('api'); } catch (_) { /* no model */ } }

    // Earlier runs: what the agents reported before, so the next ones start from it.
    try {
      const done = (deps.runs() || []).map((r) => r.meta).filter((m) => m && m.status === 'done' && m.report && !/PRZERWANO/i.test(m.reportStatus || '')).sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0)).slice(0, 25);
      for (const m of done) if (add('run', `${m.agent} run: ${clip(m.ticket, 80)}`, m.id, `Agent: ${m.agent}\nTask: ${m.ticket}\nStatus: ${m.reportStatus || ''}\n${clip(m.report, 3500)}`)) count('run');
    } catch (_) { /* no runs */ }
    return { docs, counts, chars: budget.chars };
  }

  /** README, docs and a short map of a repository: enough to name modules, not to read the code. */
  function repoDocs(r) {
    const out = [];
    const root = r.path;
    const skip = new Set(['node_modules', '.git', 'dist', 'build', 'target', '.next', 'vendor', '__pycache__', '.venv', 'venv', 'coverage', '.idea', '.gradle']);
    const tree = [];
    const walk = (d, depth) => {
      let list = []; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
      for (const e of list.sort((a, b) => a.name.localeCompare(b.name))) {
        if (skip.has(e.name) || e.name.startsWith('.')) continue;
        const rel = path.relative(root, path.join(d, e.name)).split(path.sep).join('/');
        if (e.isDirectory()) { tree.push(rel + '/'); if (depth < 3) walk(path.join(d, e.name), depth + 1); }
        else if (depth <= 2) tree.push(rel);
        if (tree.length >= 220) return;
      }
    };
    walk(root, 0);
    if (tree.length) out.push({ title: 'structure', text: 'Files and folders (top levels):\n' + tree.join('\n') });
    const docsFound = tree.filter((p) => /(^|\/)(readme|changelog|contributing|architecture)[^/]*\.(md|txt|rst)$/i.test(p) || /^docs?\/.+\.(md|rst|txt)$/i.test(p)).slice(0, 8);
    for (const p of docsFound) { try { out.push({ title: p, text: fs.readFileSync(path.join(root, p), 'utf8') }); } catch (_) { /* unreadable */ } }
    const code = tree.filter((p) => /(controller|router|routes?|handler|resolver|endpoint|api)[^/]*\.(js|ts|py|kt|java|go|cs|rb)$/i.test(p)).slice(0, 10);
    for (const p of code) { try { out.push({ title: p, text: fs.readFileSync(path.join(root, p), 'utf8').split('\n').slice(0, 80).join('\n') }); } catch (_) { /* unreadable */ } }
    return out;
  }

  /* ---- 2 and 3: the model steps ---- */
  async function ask(system, input, label) {
    stopIfCancelled();
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await deps.llm.complete(system, input, { timeoutMs: 300000 });
        if (r && r.costUsd) st.costUsd = (st.costUsd || 0) + r.costUsd;
        st.calls = (st.calls || 0) + 1; persist();
        return String((r && r.text) || '');
      } catch (e) { lastErr = e; if (cancel) throw e; log(`${label}: ${clip(e.message, 120)}${attempt ? '' : ', trying again'}`); }
    }
    throw lastErr;
  }

  async function extract(docs, lim, lang) {
    const valid = new Set(docs.map((d) => d.id));
    const all = []; let dropped = 0, failed = 0;
    const groups = batches(docs, lim.batch);
    let done = 0;
    await pool(groups, 2, async (g, i) => {
      try {
        const out = await ask(EXTRACT_SYSTEM(lang), g.map(docBlock).join('\n\n'), `Batch ${i + 1}`);
        const p = parseFacts(out, valid);
        if (p.bad) { failed++; log(`Batch ${i + 1}: the answer was not readable, skipped`); } else { all.push(...p.facts); dropped += p.dropped; }
      } catch (e) { if (e.cancelled) throw e; failed++; log(`Batch ${i + 1} failed: ${clip(e.message, 120)}`); }
      step('extract', 'running', `${++done} of ${groups.length} batches`);
    });
    if (failed === groups.length && groups.length) throw new Error('The AI did not answer any batch. Check the AI provider under Settings and try again.');
    return { facts: dedupe(all), dropped, failed, batches: groups.length };
  }

  function writeFile(rel, content) {
    const target = path.join(kdir(), rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    let existing = null; try { existing = fs.readFileSync(target, 'utf8'); } catch (_) { /* new file */ }
    // The user took the marker off: this version is theirs. The new draft goes beside it.
    const dest = existing != null && !existing.startsWith(MARK) ? target.replace(/\.md$/, '.new.md') : target;
    fs.writeFileSync(dest, content);
    return { path: path.relative(kdir(), dest).split(path.sep).join('/'), kept: dest !== target };
  }

  async function writeAll(docs, facts, lang) {
    const byId = new Map(docs.map((d) => [d.id, d]));
    const valid = new Set(byId.keys());
    const ctx = { date: new Date(now()).toISOString().slice(0, 10), docs: docs.length };
    const written = [];
    const todo = OUTPUTS.filter((o) => facts.some((f) => o.types.includes(f.type)));
    let n = 0;
    for (const o of todo) {
      stopIfCancelled();
      const mine = facts.filter((f) => o.types.includes(f.type));
      const input = mine.map((f) => `- ${f.text} ${f.src.map((x) => '[' + x + ']').join('')}`).join('\n');
      step('write', 'running', `${o.title} (${++n} of ${todo.length})`);
      try {
        const md = await ask(WRITE_SYSTEM(o.title, o.ask, lang), clip(input, 60000), o.title);
        const c = checkCitations(md, valid);
        if (c.text.length < 40) { log(`${o.title}: nothing usable came back`); continue; }
        if (c.removed || c.unsourced) log(`${o.title}: removed ${c.removed} unknown source id(s) and ${c.unsourced} unsourced line(s)`);
        const w = writeFile(o.file, header(o.title, ctx) + c.text + sourcesIndex(c.cited, byId) + '\n');
        written.push({ title: o.title, path: w.path, facts: mine.length, kept: w.kept });
      } catch (e) { if (e.cancelled) throw e; log(`${o.title} failed: ${clip(e.message, 120)}`); }
    }
    return written;
  }

  async function digest(written, lang) {
    const parts = [];
    for (const w of written) { try { parts.push(fs.readFileSync(path.join(kdir(), w.path), 'utf8').replace(/<!--[\s\S]*?-->/g, '').split('\n## Sources')[0]); } catch (_) { /* skip */ } }
    if (!parts.length) return null;
    const text = clip(await ask(DIGEST_SYSTEM(lang), clip(parts.join('\n\n'), 30000), 'Digest'), 1800).replace(/\[S\d+\]/g, '');
    const w = writeFile('product/digest.md', `${MARK}\n${text}\n`);
    return { title: 'Briefing for every agent', path: w.path, kept: w.kept };
  }

  /* ---- the run ---- */
  async function run(opts) {
    const lim = DEPTH[opts.depth] || DEPTH.standard;
    const lang = LANG(opts.language);
    try {
      step('scan', 'running');
      const sc = await scan(opts, lim);
      fs.mkdirSync(workDir, { recursive: true });
      try { fs.writeFileSync(path.join(workDir, 'corpus.json'), JSON.stringify(sc.docs)); } catch (_) { /* optional */ }
      st.scan = { docs: sc.docs.length, chars: sc.chars, counts: sc.counts };
      const calls = batches(sc.docs, lim.batch).length + OUTPUTS.length + 1;
      st.scan.estimatedCalls = calls;
      step('scan', 'done', `${sc.docs.length} documents (${Object.entries(sc.counts).map(([k, v]) => v + ' ' + k).join(', ') || 'none'})`);
      if (!sc.docs.length) throw new Error('The scan found nothing to learn from. Connect Jira, Confluence or a repository under Sources, or add documents to the knowledge folder.');
      if (opts.scanOnly) { st.status = 'done'; st.finishedAt = now(); st.scanOnly = true; log(`Scan only: about ${calls} model calls would be needed.`); persist(); return; }

      step('extract', 'running');
      const ex = await extract(sc.docs, lim, lang);
      st.facts = { count: ex.facts.length, dropped: ex.dropped, failedBatches: ex.failed };
      try { fs.writeFileSync(path.join(workDir, 'facts.json'), JSON.stringify(ex.facts)); } catch (_) { /* optional */ }
      step('extract', 'done', `${ex.facts.length} facts${ex.dropped ? `, ${ex.dropped} dropped for missing source` : ''}${ex.failed ? `, ${ex.failed} batch(es) failed` : ''}`);
      if (!ex.facts.length) throw new Error('No facts could be taken from the sources. Try a different AI provider or a smaller scope.');

      step('write', 'running');
      const written = await writeAll(sc.docs, ex.facts, lang);
      if (!written.length) throw new Error('No document could be written. Check the AI provider under Settings.');
      step('write', 'done', `${written.length} document(s)`);

      step('digest', 'running');
      let d = null; try { d = await digest(written, lang); } catch (e) { if (e.cancelled) throw e; log('Briefing skipped: ' + clip(e.message, 120)); }
      if (d) written.push(d);
      step('digest', d ? 'done' : 'failed', d ? '' : 'skipped');

      st.outputs = written; st.status = 'done'; st.finishedAt = now(); st.finishedBy = 'completed'; log('Finished.');
    } catch (e) {
      st.status = e.cancelled ? 'cancelled' : 'failed'; st.error = e.cancelled ? '' : clip(e.message, 300); st.finishedAt = now();
      for (const s of st.steps) if (s.status === 'running') s.status = e.cancelled ? 'cancelled' : 'failed';
      log(e.cancelled ? 'Stopped.' : 'Failed: ' + st.error);
    } finally { running = null; persist(); }
  }

  function start(opts = {}) {
    if (running) throw Object.assign(new Error('Onboarding is already running.'), { status: 409 });
    const cur = deps.llm.current ? deps.llm.current() : null;
    if (cur && cur.id === 'acp' && !opts.scanOnly) throw Object.assign(new Error('Onboarding needs an AI provider that answers single questions: Claude Code, or an API key (Anthropic, OpenAI, Gemini or compatible). Your own agent (ACP) cannot do it yet. Change it under Settings > AI provider.'), { status: 409 });
    cancel = false;
    st = { status: 'running', startedAt: now(), finishedAt: 0, costUsd: 0, calls: 0, error: '', log: [], outputs: st.outputs || [], options: { depth: DEPTH[opts.depth] ? opts.depth : 'standard', language: String(opts.language || 'auto').slice(0, 40), scanOnly: !!opts.scanOnly },
      steps: [['scan', 'Read the sources'], ['extract', 'Take out facts'], ['write', 'Write the knowledge files'], ['digest', 'Write the briefing']].map(([key, label]) => ({ key, label, status: 'pending', note: '' })) };
    if (opts.scanOnly) st.steps = st.steps.slice(0, 1);
    persist();
    running = run({ depth: st.options.depth, language: st.options.language, scanOnly: !!opts.scanOnly });
    return view();
  }

  function stop() { if (!running) throw Object.assign(new Error('Nothing is running.'), { status: 409 }); cancel = true; return view(); }

  /** Generated and hand-kept files in product/ and lessons/, for the UI. */
  function files() {
    const out = [];
    for (const sub of ['product', 'lessons']) {
      let list = []; try { list = fs.readdirSync(path.join(kdir(), sub)); } catch (_) { continue; }
      for (const n of list.filter((x) => /\.md$/.test(x))) {
        const p = path.join(kdir(), sub, n);
        let head = ''; try { head = fs.readFileSync(p, 'utf8').slice(0, 60); } catch (_) { /* skip */ }
        out.push({ path: sub + '/' + n, bytes: fs.statSync(p).size, generated: head.startsWith(MARK), modified: fs.statSync(p).mtimeMs });
      }
    }
    return out;
  }
  function readFile(rel) {
    const r = String(rel || '');
    if (!/^(product|lessons)\/[\w.-]+\.md$/.test(r)) throw Object.assign(new Error('Not an onboarding file.'), { status: 400 });
    try { return fs.readFileSync(path.join(kdir(), r), 'utf8'); } catch (_) { throw Object.assign(new Error('Not found'), { status: 404 }); }
  }

  function view() {
    const s = deps.sources.status();
    // Only the team's own documents count: the files shipped with the app and the generated ones are not a source.
    const own = deps.sources.knowledgeFiles().files.filter((f) => !/^(product|lessons)\//.test(f.path) && !(SHIPPED.has(path.basename(f.path)) && !f.path.includes('/'))).length;
    return { ...st, running: !!running, files: files(), sources: { jira: s.jira, confluence: s.confluence, repos: s.repos, api: s.api, knowledge: own }, llm: deps.llm.current ? deps.llm.current().id : '' };
  }

  return { start, stop, view, readFile, files, scan, _state: () => st, whenDone: () => running };
}

/** Runs fn over items with at most n at a time. */
async function pool(items, n, fn) {
  let i = 0; let err = null;
  const worker = async () => { while (i < items.length && !err) { const k = i++; try { await fn(items[k], k); } catch (e) { err = e; } } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
  if (err) throw err;
}

module.exports = { create, batches, parseFacts, dedupe, checkCitations, sourcesIndex, docBlock, OUTPUTS, MARK, TYPES, DEPTH };
