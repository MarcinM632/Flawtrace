#!/usr/bin/env node
// MCP server "sources": read only access to the knowledge sources of the team.
// Jira and Confluence through their REST APIs, the knowledge base folder, the local repository copies and the
// contracts of the API endpoints. Nothing here writes anywhere.
const fs = require('fs');
const path = require('path');
const { serve, clip } = require('./stdio');
const src = require('../lib/sources');
const { loadFolder } = require('../lib/openapi');

const KNOWLEDGE = process.env.QA_KNOWLEDGE_DIR || src.knowledgeDir();
const SPECS_DIR = process.env.QA_SPECS_DIR || src.SPECS_DIR;
let REPOS = [];
try { REPOS = JSON.parse(process.env.QA_REPOS || '[]'); } catch (_) { REPOS = src.repoList(); }

function insideKnowledge(rel) {
  const p = path.resolve(KNOWLEDGE, String(rel || ''));
  if (!p.startsWith(path.resolve(KNOWLEDGE))) throw new Error('The path is outside the knowledge base');
  return p;
}

function knowledgeFiles() {
  const out = [];
  const walk = (d) => {
    let list = [];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of list) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(md|txt|json|ya?ml|csv|feature)$/i.test(e.name)) out.push(p);
    }
  };
  walk(KNOWLEDGE);
  return out;
}

const relK = (p) => path.relative(KNOWLEDGE, p).split(path.sep).join('/');

serve({
  name: 'sources',
  instructions: 'Read only access to the knowledge sources: the knowledge base, Jira, Confluence, local code repositories and the API endpoint contracts. Use them to ground every rule and expected result.',
  tools: [
    {
      name: 'knowledge_list',
      description: 'Lists the documents of the knowledge base with their first heading.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => knowledgeFiles().map((p) => {
        let title = '';
        try { title = (fs.readFileSync(p, 'utf8').match(/^#\s+(.+)$/m) || [])[1] || ''; } catch (_) { /* unreadable */ }
        return { path: relK(p), title, bytes: fs.statSync(p).size };
      }),
    },
    {
      name: 'knowledge_read',
      description: 'Reads one document of the knowledge base by its path from knowledge_list.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      handler: async (a) => clip(fs.readFileSync(insideKnowledge(a.path), 'utf8')),
    },
    {
      name: 'knowledge_search',
      description: 'Finds lines in the knowledge base that contain all given words, with the surrounding lines.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
      handler: async (a) => {
        const words = String(a.query).toLowerCase().split(/\s+/).filter((w) => w.length > 1);
        const hits = [];
        for (const p of knowledgeFiles()) {
          const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
          lines.forEach((l, i) => {
            const win = lines.slice(Math.max(0, i - 1), i + 2).join(' ').toLowerCase();
            if (words.length && words.every((w) => win.includes(w)) && words.some((w) => l.toLowerCase().includes(w))) {
              hits.push({ path: relK(p), line: i + 1, text: lines.slice(Math.max(0, i - 2), i + 3).join('\n') });
            }
          });
        }
        return hits.slice(0, Math.min(Number(a.limit) || 30, 100));
      },
    },
    {
      name: 'jira_get_issue',
      description: 'Reads a Jira issue: summary, status, type, parent, subtasks, description and every comment.',
      inputSchema: { type: 'object', properties: { key: { type: 'string', description: 'Issue key, for example PRJ-123' } }, required: ['key'] },
      handler: async (a) => src.jiraIssue(String(a.key).trim()),
    },
    {
      name: 'jira_search',
      description: 'Searches Jira with JQL and returns key, summary, status and type.',
      inputSchema: { type: 'object', properties: { jql: { type: 'string' }, max: { type: 'number' } }, required: ['jql'] },
      handler: async (a) => src.jiraSearch(a.jql, a.max),
    },
    {
      name: 'confluence_search',
      description: 'Searches Confluence pages by text and returns id, title, space and address.',
      inputSchema: { type: 'object', properties: { text: { type: 'string' }, max: { type: 'number' } }, required: ['text'] },
      handler: async (a) => src.confluenceSearch(a.text, a.max),
    },
    {
      name: 'confluence_get_page',
      description: 'Reads one Confluence page as plain text.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      handler: async (a) => { const p = await src.confluencePage(a.id); p.text = clip(p.text); return p; },
    },
    {
      name: 'repo_list',
      description: 'Lists the local copies of the code repositories with their paths.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => REPOS,
    },
    {
      name: 'api_app_model',
      description: 'What the API specification says about the application: resources, what each can do, dependencies between them, the order to create test data in and a life-cycle flow per resource. Read it first when there is no ticket or documentation.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => { const c = loadFolder(SPECS_DIR); const m = require('../lib/app-model'); return m.markdown(m.build(c.endpoints), c.specs.map((s) => s.title).filter(Boolean).join(', ') || 'the application'); },
    },
    {
      name: 'api_endpoints',
      description: 'Lists the endpoints of the test environment API from the imported specifications, with their parameters. Filter by words.',
      inputSchema: { type: 'object', properties: { filter: { type: 'string' }, limit: { type: 'number' } } },
      handler: async (a) => {
        const words = String(a.filter || '').toLowerCase().split(/\s+/).filter(Boolean);
        const rows = loadFolder(SPECS_DIR).endpoints.filter((e) => words.every((w) => (e.name + ' ' + e.path + ' ' + e.groupLabel + ' ' + e.summary).toLowerCase().includes(w)));
        return { total: rows.length, endpoints: rows.slice(0, Math.min(Number(a.limit) || 100, 500)).map((e) => ({ name: e.name, method: e.method, path: e.path, group: e.groupLabel, summary: e.summary, params: e.params, body: e.body })) };
      },
    },
  ],
});
