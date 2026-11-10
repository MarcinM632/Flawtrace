#!/usr/bin/env node
// MCP server "qa": calls the test environment through the endpoints of the imported OpenAPI specifications.
// Every call is numbered (c1, c2, ...) and written in full to the call log, so a report can prove each value it states.
const fs = require('fs');
const path = require('path');
const { serve, clip } = require('./stdio');
const { loadFolder } = require('../lib/openapi');
const appModel = require('../lib/app-model');

const SPECS_DIR = process.env.QA_SPECS_DIR || path.join(__dirname, '..', 'specs');
const SOURCES_FILE = process.env.QA_SOURCES_FILE || path.join(__dirname, '..', 'sources.json');
const CALL_LOG = process.env.QA_CALL_LOG || '';

let settings = {};
try { settings = JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8')).api || {}; } catch (_) { /* nothing configured */ }
const BASE = String(process.env.API_BASE_URL || settings.baseUrl || '').replace(/\/+$/, '');
const AUTH_HEADER = settings.authHeader || 'Authorization';
const AUTH_VALUE = process.env.API_AUTH_VALUE || settings.authValue || '';
const READ_ONLY = !!settings.readOnly;

const cat = loadFolder(SPECS_DIR);
const byName = new Map(cat.endpoints.map((e) => [e.name, e]));
let seq = 0;
const called = new Map(); // endpoint name -> number of calls

function log(entry) {
  if (!CALL_LOG) return;
  try { fs.appendFileSync(CALL_LOG, JSON.stringify(entry) + '\n'); } catch (_) { /* the log is evidence, not a precondition */ }
}

function find(args) {
  if (args.name) {
    const e = byName.get(String(args.name));
    if (e) return e;
  }
  if (args.method && args.path) {
    const m = String(args.method).toUpperCase();
    const e = cat.endpoints.find((x) => x.method === m && x.path === args.path);
    if (e) return e;
  }
  const hint = cat.endpoints.filter((e) => args.name && e.name.includes(String(args.name).toLowerCase().slice(0, 12))).slice(0, 5).map((e) => e.name);
  throw new Error(`Unknown endpoint ${args.name || (args.method + ' ' + args.path)}.${hint.length ? ' Similar: ' + hint.join(', ') : ''} Use general_read_list_endpoints.`);
}

const describe = (e) => ({
  name: e.name, method: e.method, path: e.path, group: e.groupLabel, summary: e.summary, read: e.read,
  params: e.params.filter((p) => p.in !== 'body'), body: e.body,
});

async function call(args) {
  const e = find(args);
  const ref = 'c' + (++seq);
  const started = Date.now();
  const entry = { ref, tool: 'general_call_endpoint', endpoint: e.name, args, ok: false, at: new Date(started).toISOString() };
  try {
    if (!BASE) throw new Error('No base address of the test environment. Set it in the Sources tab.');
    if (READ_ONLY && !e.read) throw new Error(`The environment is read only in the Sources settings, so ${e.method} is not allowed.`);
    const pp = args.path_params || {};
    let p = e.path.replace(/\{([^}]+)\}/g, (_, k) => {
      if (pp[k] === undefined) throw new Error(`Missing path parameter "${k}"`);
      return encodeURIComponent(String(pp[k]));
    });
    const missing = e.params.filter((x) => x.required && x.in === 'query' && (args.query || {})[x.name] === undefined).map((x) => x.name);
    if (missing.length) throw new Error('Missing required query parameters: ' + missing.join(', '));
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(args.query || {})) {
      if (Array.isArray(v)) v.forEach((x) => qs.append(k, String(x)));
      else if (v !== undefined && v !== null) qs.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    const url = BASE + p + (qs.toString() ? '?' + qs : '');
    const headers = { Accept: 'application/json', ...(AUTH_VALUE ? { [AUTH_HEADER]: AUTH_VALUE } : {}), ...(args.headers || {}) };
    let body;
    if (args.body !== undefined && !['GET', 'HEAD'].includes(e.method)) {
      body = typeof args.body === 'string' ? args.body : JSON.stringify(args.body);
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }
    const res = await fetch(url, { method: e.method, headers, body, signal: AbortSignal.timeout(Number(args.timeout_ms) || 60000) });
    const text = await res.text();
    let data = text;
    try { data = text ? JSON.parse(text) : null; } catch (_) { /* not JSON */ }
    const response = {
      _call: ref, status: res.status, ok: res.ok, ms: Date.now() - started,
      url: url.replace(BASE, ''),
      contentType: res.headers.get('content-type') || '',
      body: data,
    };
    called.set(e.name, (called.get(e.name) || 0) + 1);
    Object.assign(entry, { ok: true, response });
    log(entry);
    const out = JSON.stringify(response, null, 2);
    return clip(out);
  } catch (err) {
    entry.error = err.message;
    log(entry);
    throw new Error(`[${ref}] ${err.message}`);
  }
}

const listSchema = {
  type: 'object',
  properties: {
    filter: { type: 'string', description: 'Words to match in the name, path, group or summary' },
    group: { type: 'string', description: 'Only this group (tag of the specification)' },
    limit: { type: 'number', description: 'Maximum number of rows, 200 by default' },
  },
};

serve({
  name: 'qa',
  instructions: 'Calls the test environment through the endpoints of the imported OpenAPI specifications. Start with general_get_status, find endpoints with general_read_list_endpoints, read the contract with general_read_describe_endpoint and call it with general_call_endpoint. Every answer carries _call (c1, c2, ...), which is the evidence a report refers to.',
  tools: [
    {
      name: 'general_get_status',
      description: 'Which environment this server calls, how many endpoints it knows, the groups and whether writes are allowed.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        const groups = {};
        for (const e of cat.endpoints) groups[e.groupLabel] = (groups[e.groupLabel] || 0) + 1;
        return {
          baseUrl: BASE || '(not set)', endpoints: cat.endpoints.length, readOnly: READ_ONLY,
          specifications: cat.specs.map((s) => ({ source: s.source, title: s.title, version: s.version, endpoints: s.endpoints.length })),
          specErrors: cat.errors, loadedGroups: Object.keys(groups), groups, callsInThisRun: seq,
        };
      },
    },
    {
      name: 'general_read_list_endpoints',
      description: 'Lists endpoints: name, method, path, group and summary. Filter by words or by group.',
      inputSchema: listSchema,
      handler: async (a) => {
        const words = String(a.filter || '').toLowerCase().split(/\s+/).filter(Boolean);
        const rows = cat.endpoints.filter((e) => (!a.group || e.groupLabel.toLowerCase() === String(a.group).toLowerCase() || e.group === a.group)
          && words.every((w) => (e.name + ' ' + e.path + ' ' + e.groupLabel + ' ' + e.summary).toLowerCase().includes(w)));
        const limit = Math.min(Number(a.limit) || 200, 1000);
        return { total: rows.length, shown: Math.min(limit, rows.length), endpoints: rows.slice(0, limit).map((e) => ({ name: e.name, method: e.method, path: e.path, group: e.groupLabel, summary: e.summary, loaded: true })) };
      },
    },
    {
      name: 'general_read_describe_endpoint',
      description: 'The contract of one endpoint: path, query and header parameters and the outline of the request body.',
      inputSchema: { type: 'object', properties: { name: { type: 'string' }, method: { type: 'string' }, path: { type: 'string' } } },
      handler: async (a) => describe(find(a)),
    },
    {
      name: 'general_read_app_model',
      description: 'What the specification says about the application: its resources, what each can do, which resource must exist before another (order to create test data in) and the life-cycle flow to test for each. Read it first when there is no ticket or documentation.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => appModel.markdown(appModel.build(cat.endpoints), cat.specs.map((s) => s.title).filter(Boolean).join(', ') || 'the application'),
    },
    {
      name: 'general_call_endpoint',
      description: 'Calls one endpoint on the test environment and returns status, time and body. Use the name from general_read_list_endpoints, or method and path.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Endpoint name from the list' },
          method: { type: 'string' },
          path: { type: 'string', description: 'Path template from the specification, for example /orders/{id}' },
          path_params: { type: 'object', description: 'Values for {placeholders} in the path' },
          query: { type: 'object', description: 'Query parameters' },
          body: { description: 'Request body, usually a JSON object' },
          headers: { type: 'object', description: 'Extra headers' },
          timeout_ms: { type: 'number' },
        },
      },
      handler: call,
    },
    {
      name: 'general_read_get_coverage',
      description: 'Which endpoints were called in this run and how many of each group were not called.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        const groups = {};
        for (const e of cat.endpoints) {
          const g = groups[e.groupLabel] || (groups[e.groupLabel] = { total: 0, called: 0 });
          g.total++; if (called.has(e.name)) g.called++;
        }
        return { calledEndpoints: Object.fromEntries(called), groups };
      },
    },
  ],
});
