// Which AI the user connected, and one entry point to call it. Settings live in <data dir>/llm.json (git-ignored).
// A key is accepted only from a direct local request, is never returned by the API (only a masked hint), and is
// stripped from every error message.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config');
const { CALLS, PROVIDERS } = require('./providers');

const FILE = path.join(DATA_DIR, 'llm.json');
const ENV_KEYS = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY', 'openai-compatible': 'OPENAI_COMPATIBLE_API_KEY' };

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) { return {}; }
}
function save(cfg) {
  fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

/** The effective choice: saved file first, then QA_LLM and the provider's usual key variable, else the Claude Code CLI. */
function current() {
  const c = load();
  const id = PROVIDERS[c.provider] ? c.provider : (PROVIDERS[process.env.QA_LLM] ? process.env.QA_LLM : 'claude-cli');
  const def = PROVIDERS[id];
  const keys = c.keys || {};
  return {
    id, def,
    model: c.model && c.provider === id ? c.model : (process.env.QA_LLM_MODEL || ''),
    baseUrl: (c.baseUrls && c.baseUrls[id]) || def.baseUrl || '',
    key: keys[id] || process.env[ENV_KEYS[id]] || '',
  };
}

const mask = (k) => (k ? (k.length > 10 ? k.slice(0, 3) + '…' + k.slice(-4) : '••••') : '');

function view() {
  const c = current();
  return {
    selected: c.id, model: c.model, baseUrl: c.baseUrl, keySet: !!c.key, keyHint: mask(c.key),
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, needsKey: p.needsKey, needsModel: p.needsModel, baseUrlEditable: p.baseUrl !== false, baseUrlRequired: !!p.baseUrlRequired, agents: p.agents, note: p.note || '', modelHint: p.modelHint || '', defaultBaseUrl: p.baseUrl || '' })),
    agentsNote: c.def.agents ? '' : 'Agents (Analyses, QA MCP, UI Tests, Autotests) still run on Claude Code. This provider serves the single-step features until the agent loop is built.',
  };
}

function update(b) {
  const id = String(b.provider || '');
  if (!PROVIDERS[id]) throw Object.assign(new Error('Unknown provider'), { code: 400 });
  const cfg = load();
  cfg.provider = id;
  cfg.model = String(b.model || '').trim().slice(0, 200);
  cfg.baseUrls = cfg.baseUrls || {};
  if (PROVIDERS[id].baseUrl !== false) {
    const u = String(b.baseUrl || '').trim();
    if (u) {
      let p; try { p = new URL(u); } catch (_) { throw Object.assign(new Error('The address is not valid.'), { code: 400 }); }
      if (!/^https?:$/.test(p.protocol) || p.username || p.password) throw Object.assign(new Error('Use an http(s) address without a user name or password.'), { code: 400 });
      cfg.baseUrls[id] = p.href.replace(/\/+$/, '');
    } else delete cfg.baseUrls[id];
  }
  cfg.keys = cfg.keys || {};
  if (typeof b.key === 'string' && b.key.trim()) cfg.keys[id] = b.key.trim().slice(0, 500);
  if (b.clearKey) delete cfg.keys[id];
  save(cfg);
  return view();
}

/** One step: text in, text out, with the selected provider. */
async function complete(system, input, { timeoutMs = 240000 } = {}) {
  const c = current();
  if (c.id === 'claude-cli') {
    const { claudeCliOnce } = require('../claude-once');
    return { ...(await claudeCliOnce(system, input, timeoutMs)), provider: c.id };
  }
  if (c.def.needsKey && !c.key) throw new Error(`No API key for ${c.def.label}. Add it in Settings > AI provider.`);
  if (c.def.needsModel && !c.model) throw new Error('Choose a model name in Settings > AI provider.');
  if (!c.baseUrl) throw new Error('Enter the address of the endpoint in Settings > AI provider.');
  try {
    const r = await CALLS[c.id]({ key: c.key, model: c.model, baseUrl: c.baseUrl, system, input, timeoutMs });
    return { text: r.text, costUsd: null, usage: r.usage, provider: c.id, model: c.model };
  } catch (e) {
    let m = String(e && e.message || e);
    if (c.key) m = m.split(c.key).join('***');
    throw new Error(m);
  }
}

module.exports = { complete, current, mask, update, view };
