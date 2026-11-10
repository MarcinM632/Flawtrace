// Knowledge sources and the test environment the agents work with.
// Jira and Confluence are read through their REST APIs, repositories are cloned locally, the knowledge base is a
// folder of documents and the API specifications (OpenAPI or Swagger JSON) describe the endpoints QA MCP calls.
// Settings live in DATA_DIR/sources.json, which is ignored by git, so tokens never reach the repository.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { APP_DIR, DATA_DIR, ROOT } = require('./config');
const openapi = require('./openapi');

const FILE = process.env.QA_SOURCES_FILE ? path.resolve(process.env.QA_SOURCES_FILE) : path.join(DATA_DIR, 'sources.json');
const SPECS_DIR = path.join(DATA_DIR, 'specs');
const REPOS_DIR = path.join(DATA_DIR, 'repos');
const DEFAULT_KNOWLEDGE = path.join(ROOT, 'knowledge');
const MASK = '********';
const SECRETS = [['jira', 'token'], ['confluence', 'token'], ['api', 'authValue']];

const EMPTY = () => ({
  jira: { url: '', email: '', token: '', projects: '' },
  confluence: { url: '', email: '', token: '', spaces: '' },
  repos: [],
  knowledgeDir: '',
  api: { baseUrl: '', authHeader: 'Authorization', authValue: '', specs: [], readOnly: false },
});

function read() {
  const c = EMPTY();
  try {
    const f = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    for (const k of Object.keys(c)) if (f[k] !== undefined) c[k] = typeof c[k] === 'object' && !Array.isArray(c[k]) ? { ...c[k], ...f[k] } : f[k];
  } catch (_) { /* not configured yet */ }
  // Environment variables win, so a hosted deployment can keep tokens out of the file.
  const env = process.env;
  if (env.JIRA_URL) c.jira.url = env.JIRA_URL;
  if (env.JIRA_EMAIL) c.jira.email = env.JIRA_EMAIL;
  if (env.JIRA_TOKEN) c.jira.token = env.JIRA_TOKEN;
  if (env.CONFLUENCE_URL) c.confluence.url = env.CONFLUENCE_URL;
  if (env.API_BASE_URL) c.api.baseUrl = env.API_BASE_URL;
  if (env.API_AUTH_VALUE) c.api.authValue = env.API_AUTH_VALUE;
  return c;
}

/** Settings for the UI: secrets replaced by a mask, so they are never sent back to the browser. */
function view() {
  const c = read();
  for (const [a, b] of SECRETS) c[a][b] = c[a][b] ? MASK : '';
  return { ...c, knowledgeDefault: rel(DEFAULT_KNOWLEDGE), status: status() };
}

function save(patch) {
  const cur = read();
  const next = EMPTY();
  for (const k of ['jira', 'confluence', 'api']) next[k] = { ...cur[k], ...(patch[k] || {}) };
  // A masked or missing secret means "keep the stored one".
  for (const [a, b] of SECRETS) if (!patch[a] || patch[a][b] === MASK || patch[a][b] === undefined) next[a][b] = cur[a][b];
  next.repos = Array.isArray(patch.repos) ? patch.repos.map(cleanRepo).filter(Boolean) : cur.repos;
  next.api.specs = Array.isArray(patch.api && patch.api.specs) ? patch.api.specs.map(cleanSpec).filter(Boolean) : cur.api.specs;
  next.knowledgeDir = patch.knowledgeDir !== undefined ? String(patch.knowledgeDir || '').trim() : cur.knowledgeDir;
  for (const k of ['jira', 'confluence']) next[k].url = String(next[k].url || '').trim().replace(/\/+$/, '');
  next.api.baseUrl = String(next.api.baseUrl || '').trim().replace(/\/+$/, '');
  next.api.readOnly = !!next.api.readOnly;
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
  return view();
}

const safeName = (s) => String(s || '').trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
function cleanRepo(r) {
  if (!r || !String(r.url || '').trim()) return null;
  const url = String(r.url).trim();
  const name = (safeName(r.name) || safeName(path.basename(url).replace(/\.git$/, ''))).toLowerCase();
  return name ? { name, url, branch: String(r.branch || '').trim() } : null;
}
function cleanSpec(s) {
  if (!s || !String(s.url || '').trim()) return null;
  const url = String(s.url).trim();
  let name = safeName(s.name);
  if (!name) { try { name = safeName(new URL(url).hostname.split('.')[0]); } catch (_) { name = 'api'; } }
  return { name, url };
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/') || '.';
const knowledgeDir = () => { const d = read().knowledgeDir; return d ? path.resolve(ROOT, d) : DEFAULT_KNOWLEDGE; };
const confluenceBase = (c) => c.confluence.url || (c.jira.url ? c.jira.url + '/wiki' : '');

/* ------------------------------------------------ Atlassian ------------------------------------------------ */

function authHeader(email, token) {
  if (!token) return {};
  return email ? { Authorization: 'Basic ' + Buffer.from(email + ':' + token).toString('base64') } : { Authorization: 'Bearer ' + token };
}

async function getJson(url, headers, timeoutMs = 30000) {
  const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} from ${new URL(url).host}: ${text.replace(/\s+/g, ' ').slice(0, 200)}`), { status: res.status });
  try { return JSON.parse(text); } catch (_) { throw new Error(`The answer from ${new URL(url).host} is not JSON`); }
}

const jiraCfg = () => { const c = read(); if (!c.jira.url) throw new Error('Jira is not connected. Add it under Sources.'); return c; };
const jiraGet = (c, p) => getJson(c.jira.url + p, authHeader(c.jira.email, c.jira.token));

/** Plain text from Atlassian Document Format (Jira Cloud API v3) or from a plain string (API v2). */
function adfText(n) {
  if (n == null) return '';
  if (typeof n === 'string') return n;
  if (Array.isArray(n)) return n.map(adfText).join('');
  if (n.type === 'text') return n.text || '';
  if (n.type === 'hardBreak') return '\n';
  if (n.type === 'mention') return (n.attrs && n.attrs.text) || '';
  const inner = adfText(n.content || []);
  if (['paragraph', 'heading', 'blockquote', 'codeBlock', 'rule'].includes(n.type)) return inner + '\n';
  if (n.type === 'listItem') return '- ' + inner.trim() + '\n';
  if (n.type === 'tableRow') return '| ' + (n.content || []).map((c) => adfText(c).trim()).join(' | ') + ' |\n';
  return inner;
}

async function jiraIssue(key) {
  const c = jiraCfg();
  const f = 'summary,status,issuetype,priority,components,labels,parent,subtasks,description,comment,created,updated,assignee,fixVersions';
  const i = await jiraGet(c, `/rest/api/2/issue/${encodeURIComponent(key)}?fields=${f}`);
  const x = i.fields || {};
  return {
    key: i.key, summary: x.summary || '', status: x.status && x.status.name, type: x.issuetype && x.issuetype.name,
    priority: x.priority && x.priority.name, components: (x.components || []).map((k) => k.name), labels: x.labels || [],
    parent: x.parent ? x.parent.key + ' ' + ((x.parent.fields && x.parent.fields.summary) || '') : '',
    subtasks: (x.subtasks || []).map((s) => s.key + ' ' + ((s.fields && s.fields.summary) || '')),
    fixVersions: (x.fixVersions || []).map((v) => v.name),
    description: adfText(x.description).trim(),
    comments: ((x.comment && x.comment.comments) || []).map((k) => ({ author: k.author && k.author.displayName, created: k.created, body: adfText(k.body).trim() })),
    url: c.jira.url + '/browse/' + i.key,
  };
}

async function jiraSearch(jql, max = 20) {
  const c = jiraCfg();
  const q = `jql=${encodeURIComponent(jql)}&maxResults=${Math.min(Number(max) || 20, 100)}&fields=summary,status,issuetype,priority,updated`;
  let r;
  // Jira Cloud moved search to /search/jql; Jira Data Center still uses /api/2/search.
  try { r = await jiraGet(c, '/rest/api/3/search/jql?' + q); }
  catch (e) { if (![404, 405, 410].includes(e.status)) throw e; r = await jiraGet(c, '/rest/api/2/search?' + q); }
  return (r.issues || []).map((i) => ({ key: i.key, summary: i.fields.summary, status: i.fields.status && i.fields.status.name, type: i.fields.issuetype && i.fields.issuetype.name, updated: i.fields.updated }));
}

/** Issue text in the shape the agents already read: description and every comment, verbatim. */
async function jiraIssueText(keys) {
  const parts = [];
  for (const k of keys) {
    const i = await jiraIssue(k);
    parts.push(`## ${i.key} — ${i.summary}\nStatus: ${i.status || ''} | Type: ${i.type || ''} | Subtasks: ${i.subtasks.join('; ') || 'none'}` +
      `${i.parent ? ' | Parent: ' + i.parent : ''}\n### Description\n${i.description || '(empty)'}\n### Comments (${i.comments.length})\n` +
      i.comments.map((c, n) => `#### Comment ${n + 1} — ${c.author || ''}, ${c.created || ''}\n${c.body}`).join('\n'));
  }
  return parts.join('\n\n');
}

const htmlText = (h) => String(h || '')
  .replace(/<(br|\/p|\/h\d|\/li|\/tr)[^>]*>/gi, '\n').replace(/<li[^>]*>/gi, '- ').replace(/<\/t[dh]>/gi, ' | ')
  .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/\n{3,}/g, '\n\n').trim();

function confluenceCfg() {
  const c = read();
  const base = confluenceBase(c);
  if (!base) throw new Error('Confluence is not connected. Add it under Sources.');
  const email = c.confluence.token ? c.confluence.email : c.jira.email;
  const token = c.confluence.token || c.jira.token;
  return { c, base, headers: authHeader(email, token) };
}

async function confluenceSearch(text, max = 10) {
  const { c, base, headers } = confluenceCfg();
  const spaces = String(c.confluence.spaces || '').split(/[\s,]+/).filter(Boolean);
  const cql = `type=page AND text ~ "${String(text).replace(/"/g, '\\"')}"` + (spaces.length ? ` AND space in (${spaces.map((s) => '"' + s + '"').join(',')})` : '') + ' ORDER BY lastmodified DESC';
  const r = await getJson(`${base}/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=${Math.min(Number(max) || 10, 50)}&expand=space,version`, headers);
  return (r.results || []).map((p) => ({ id: p.id, title: p.title, space: p.space && p.space.key, updated: p.version && p.version.when, url: base + ((p._links && p._links.webui) || '') }));
}

async function confluencePage(id) {
  const { base, headers } = confluenceCfg();
  const p = await getJson(`${base}/rest/api/content/${encodeURIComponent(id)}?expand=body.storage,version,space`, headers);
  return { id: p.id, title: p.title, space: p.space && p.space.key, version: p.version && p.version.number, url: base + ((p._links && p._links.webui) || ''), text: htmlText(p.body && p.body.storage && p.body.storage.value) };
}

/* ------------------------------------------------ Repositories ------------------------------------------------ */

const isLocal = (u) => /^([A-Za-z]:[\\/]|\/|\.{1,2}[\\/])/.test(u) && fs.existsSync(path.resolve(ROOT, u));
const repoPath = (r) => (isLocal(r.url) ? path.resolve(ROOT, r.url) : path.join(REPOS_DIR, r.name));

function git(args, cwd, timeout = 300000) {
  return new Promise((resolve) => {
    const p = spawn('git', args, { cwd, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    let out = '', err = '';
    const t = setTimeout(() => p.kill(), timeout);
    p.stdout.on('data', (c) => { out += c; });
    p.stderr.on('data', (c) => { err += c; });
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: e.message }); });
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out: out.trim(), err: err.trim() }); });
  });
}

function repoList() {
  return read().repos.map((r) => {
    const p = repoPath(r);
    const ready = fs.existsSync(path.join(p, '.git')) || (isLocal(r.url) && fs.existsSync(p));
    return { ...r, path: p.split(path.sep).join('/'), local: isLocal(r.url), ready };
  });
}

/** Clones missing repositories and updates the others. A local folder is used as it is. */
async function syncRepos() {
  fs.mkdirSync(REPOS_DIR, { recursive: true });
  const out = [];
  for (const r of read().repos) {
    const p = repoPath(r);
    if (isLocal(r.url)) { out.push({ name: r.name, ok: true, message: 'Local folder' }); continue; }
    let res;
    if (fs.existsSync(path.join(p, '.git'))) {
      res = await git(['-C', p, 'fetch', '--prune', 'origin'], ROOT);
      if (res.code === 0) {
        const branch = r.branch || (await git(['-C', p, 'rev-parse', '--abbrev-ref', 'origin/HEAD'], ROOT)).out.replace(/^origin\//, '') || 'main';
        res = await git(['-C', p, 'checkout', '-q', '-B', branch, 'origin/' + branch], ROOT);
      }
    } else {
      res = await git(['clone', '-q', ...(r.branch ? ['--branch', r.branch] : []), r.url, p], ROOT);
    }
    const head = res.code === 0 ? (await git(['-C', p, 'log', '-1', '--format=%h %s'], ROOT)).out : '';
    out.push({ name: r.name, ok: res.code === 0, message: res.code === 0 ? head : (res.err.split('\n').pop() || 'git failed') });
  }
  return out;
}

/* ------------------------------------------------ API specifications ------------------------------------------------ */

const SPEC_GUESSES = ['/v3/api-docs', '/openapi.json', '/swagger.json', '/v2/api-docs', '/swagger/v1/swagger.json', '/api-docs'];

async function fetchSpecDoc(url, headers) {
  const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  try { const d = JSON.parse(text); if (d.openapi || d.swagger) return d; } catch (_) { /* maybe the Swagger UI page */ }
  // A Swagger UI page: the document is usually next to it under a well known path.
  const origin = new URL(url).origin;
  const fromPage = (text.match(/url:\s*["']([^"']+\.json[^"']*)["']/) || [])[1];
  const candidates = [...(fromPage ? [new URL(fromPage, url).href] : []), ...SPEC_GUESSES.map((g) => origin + g)];
  for (const u of candidates) {
    try {
      const r = await fetch(u, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(20000) });
      if (r.ok) { const d = JSON.parse(await r.text()); if (d.openapi || d.swagger) return d; }
    } catch (_) { /* next guess */ }
  }
  throw new Error('No OpenAPI or Swagger JSON found at this address. Use the address of the JSON document.');
}

/** Downloads every configured specification into DATA_DIR/specs. A failed download keeps the previous copy. */
async function fetchSpecs() {
  const c = read();
  fs.mkdirSync(SPECS_DIR, { recursive: true });
  const headers = c.api.authValue ? { [c.api.authHeader || 'Authorization']: c.api.authValue } : {};
  const results = [];
  for (const s of c.api.specs) {
    try {
      const doc = await fetchSpecDoc(s.url, headers);
      const parsed = openapi.parseSpec(doc, s.name);
      fs.writeFileSync(path.join(SPECS_DIR, s.name + '.json'), JSON.stringify(doc));
      results.push({ label: s.name, ok: true, operations: parsed.endpoints.length, message: '' });
    } catch (e) {
      results.push({ label: s.name, ok: false, operations: null, message: e.message });
    }
  }
  // Specifications removed from the settings are removed from the catalogue too.
  const keep = new Set(c.api.specs.map((s) => s.name + '.json'));
  for (const f of fs.readdirSync(SPECS_DIR)) if (f.endsWith('.json') && f !== 'sources.json' && !keep.has(f) && !f.startsWith('upload-')) fs.rmSync(path.join(SPECS_DIR, f));
  fs.writeFileSync(path.join(SPECS_DIR, 'sources.json'), JSON.stringify(Object.fromEntries(c.api.specs.map((s) => [s.name, s.url]))));
  return results;
}

/** A specification uploaded as a file instead of downloaded. */
function uploadSpec(name, text) {
  const doc = JSON.parse(text);
  if (!doc.openapi && !doc.swagger) throw new Error('The file is not an OpenAPI or Swagger JSON document');
  const n = 'upload-' + (safeName(name).replace(/\.json$/, '') || 'api');
  fs.mkdirSync(SPECS_DIR, { recursive: true });
  fs.writeFileSync(path.join(SPECS_DIR, n + '.json'), JSON.stringify(doc));
  return { name: n, operations: openapi.parseSpec(doc, n).endpoints.length };
}

const catalogue = () => openapi.loadFolder(SPECS_DIR);
const apiReady = () => { const c = read(); return !!c.api.baseUrl && catalogue().endpoints.length > 0; };

/* ------------------------------------------------ Knowledge base ------------------------------------------------ */

function knowledgeFiles() {
  const dir = knowledgeDir();
  const out = [];
  const walk = (d) => {
    let list = [];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of list) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(md|txt|json|ya?ml|csv|pdf|feature)$/i.test(e.name)) out.push({ path: path.relative(dir, p).split(path.sep).join('/'), size: fs.statSync(p).size });
    }
  };
  walk(dir);
  return { dir: dir.split(path.sep).join('/'), files: out };
}

/** True when how-we-test.md exists and no placeholder in angle brackets is left. */
function rulesFilled() {
  try { return !/<[^>\n]{2,}>/.test(fs.readFileSync(path.join(knowledgeDir(), 'how-we-test.md'), 'utf8')); } catch (_) { return false; }
}

/* ------------------------------------------------ Status and agent wiring ------------------------------------------------ */

function status() {
  const c = read();
  const cat = catalogue();
  return {
    jira: !!(c.jira.url && c.jira.token),
    confluence: !!(confluenceBase(c) && (c.confluence.token || c.jira.token)),
    repos: repoList().filter((r) => r.ready).length,
    reposTotal: c.repos.length,
    knowledge: knowledgeFiles().files.length,
    rulesFilled: rulesFilled(),
    endpoints: cat.endpoints.length,
    api: !!c.api.baseUrl && cat.endpoints.length > 0,
  };
}

/** Checks every configured connection and says what works. */
async function test() {
  const c = read();
  const out = {};
  const run = async (k, fn) => { try { out[k] = { ok: true, message: await fn() }; } catch (e) { out[k] = { ok: false, message: e.message }; } };
  if (c.jira.url) await run('jira', async () => { const me = await jiraGet(c, '/rest/api/2/myself'); return 'Signed in as ' + (me.displayName || me.name || me.emailAddress); });
  if (confluenceBase(c)) await run('confluence', async () => { const { base, headers } = confluenceCfg(); const r = await getJson(base + '/rest/api/space?limit=1', headers); return 'Reachable, ' + ((r.size != null ? r.size : (r.results || []).length)) + ' space visible'; });
  if (c.api.baseUrl) await run('api', async () => { const r = await fetch(c.api.baseUrl, { method: 'GET', signal: AbortSignal.timeout(15000), headers: c.api.authValue ? { [c.api.authHeader || 'Authorization']: c.api.authValue } : {} }); return 'Reachable, HTTP ' + r.status; });
  return out;
}

const MCP_DIR = path.join(APP_DIR, 'mcp');

/** MCP server entries for a run. `qa` calls the test environment, `sources` reads the knowledge sources. */
function mcpServers({ api = false, knowledge = true, callLog = '' } = {}) {
  const servers = {};
  const env = { QA_DATA_DIR: DATA_DIR, QA_SOURCES_FILE: FILE, QA_SPECS_DIR: SPECS_DIR, QA_KNOWLEDGE_DIR: knowledgeDir(), QA_REPOS: JSON.stringify(repoList().map((r) => ({ name: r.name, path: r.path }))) };
  if (api) servers.qa = { command: process.execPath, args: [path.join(MCP_DIR, 'api-server.js')], env: { ...env, ...(callLog ? { QA_CALL_LOG: callLog } : {}) } };
  if (knowledge) servers.sources = { command: process.execPath, args: [path.join(MCP_DIR, 'sources-server.js')], env };
  return servers;
}

/** What the agent is told about its sources. Only connected sources are listed. */
function brief(mode) {
  const s = status();
  const c = read();
  const k = knowledgeFiles();
  const lines = ['KNOWLEDGE SOURCES (connected in the Sources tab; read them before you decide anything about the task):'];
  lines.push(`- Knowledge base: ${k.files.length} documents in "${k.dir}". Start with the files about how the team tests (test process, test approach, performance testing). Read them with mcp__sources__knowledge_search and mcp__sources__knowledge_read${mode === 'qa' ? ', or with Read and Grep' : ''}. They define how testing is done here and take precedence over general habits.`);
  if (s.jira) lines.push(`- Jira: ${c.jira.url}${c.jira.projects ? ', projects ' + c.jira.projects : ''}. Read the ticket with mcp__sources__jira_get_issue (description, subtasks and every comment) and look for related work with mcp__sources__jira_search.`);
  else lines.push('- Jira: not connected. Work from the text of the task; do not ask for Jira access.');
  if (s.confluence) lines.push(`- Confluence: ${confluenceBase(c)}${c.confluence.spaces ? ', spaces ' + c.confluence.spaces : ''}. Search requirements and specifications with mcp__sources__confluence_search and read pages with mcp__sources__confluence_get_page.`);
  const repos = repoList().filter((r) => r.ready);
  if (repos.length) lines.push(`- Code repositories (local copies, read only): ${repos.map((r) => `${r.name} at "${r.path}"`).join('; ')}.${mode === 'qa' ? ' Read them with Read, Grep, Glob and git -C <path> log/show/diff.' : ' List them with mcp__sources__repo_list.'}`);
  if (s.api) lines.push(`- Test environment API: ${c.api.baseUrl}, ${s.endpoints} endpoints from the imported OpenAPI specifications.${mode === 'qamcp' ? ' Call them only through the qa MCP server.' : ' Endpoint contracts are listed by mcp__sources__api_endpoints.'}`);
  lines.push('Rules: a business rule, threshold or expected result comes from these sources, never from memory. When the sources disagree with each other or with the task, report the difference. When none of them covers a rule, list it as an open question instead of inventing it. Name the source of every expected result (ticket key, page title, file path or endpoint).');
  return lines.join('\n');
}

module.exports = {
  apiReady, brief, catalogue, confluencePage, confluenceSearch, fetchSpecs, jiraIssue, jiraIssueText, jiraSearch,
  knowledgeDir, knowledgeFiles, mcpServers, read, repoList, save, status, syncRepos, test, uploadSpec, view,
  SPECS_DIR, FILE,
};
