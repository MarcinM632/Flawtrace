#!/usr/bin/env node
// MCP server "flawtrace": lets Claude (Desktop, Code) or any MCP client start UI and backend tests in the
// running app and read the results. It is a thin client of the app's /api/v1 (same tools as the OpenAPI spec).
//   FLAWTRACE_URL  address of the running app (default http://127.0.0.1:4317)
//   FLAWTRACE_API_KEY  the API key (default: read from <app>/api-key.txt on the same machine)
const fs = require('fs');
const path = require('path');
const { serve, clip } = require('./stdio');
const { TOOLS, pathParams } = require('../lib/integration');

const BASE = String(process.env.FLAWTRACE_URL || 'http://127.0.0.1:4317').replace(/\/+$/, '');
function key() {
  if (process.env.FLAWTRACE_API_KEY) return process.env.FLAWTRACE_API_KEY.trim();
  const dir = process.env.QA_DATA_DIR || path.join(__dirname, '..');
  try { return fs.readFileSync(path.join(dir, 'api-key.txt'), 'utf8').trim(); } catch (_) { return ''; }
}

async function call(t, args) {
  let p = '/api/v1' + t.path;
  const rest = { ...args };
  for (const n of pathParams(t)) { p = p.replace(`{${n}}`, encodeURIComponent(String(rest[n] || ''))); delete rest[n]; }
  const get = t.method === 'GET';
  const qs = get && Object.keys(rest).length ? '?' + new URLSearchParams(rest) : '';
  const res = await fetch(BASE + p + qs, {
    method: t.method,
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key() },
    body: get ? undefined : JSON.stringify(rest),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return clip(text);
}

serve({
  name: 'flawtrace',
  instructions: 'Start UI and backend tests in Flawtrace and read their reports. A started test returns a run id; poll get_run until its status is no longer "running".',
  tools: TOOLS.map((t) => ({ name: t.name, description: t.summary, inputSchema: t.input, handler: (a) => call(t, a) })),
});
