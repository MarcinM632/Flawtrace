// Which AI the user connected, and one entry point to call it. Settings live in <data dir>/llm.json (git-ignored).
// A key is accepted only from a direct local request, is never returned by the API (only a masked hint), and is
// stripped from every error message.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config');
const { ACP_MODES, ACP_PRESETS, API_MODES, CALLS, PROVIDERS } = require('./providers');

const FILE = path.join(DATA_DIR, 'llm.json');
const ENV_KEYS = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY', 'openai-compatible': 'OPENAI_COMPATIBLE_API_KEY' };

// A hosted deployment (QA_HOSTED=1) has no Claude Code login and no local agent to start: only API-key providers exist.
const hosted = () => process.env.QA_HOSTED === '1';
const allowedIds = () => Object.keys(PROVIDERS).filter((id) => !hosted() || PROVIDERS[id].loop);

const secrets = require('../secrets');
const KEY_FIELDS = [['keys', '*']];
function load() {
  try { return secrets.mapFields(JSON.parse(fs.readFileSync(FILE, 'utf8')), KEY_FIELDS, secrets.open); } catch (_) { return {}; }
}
function save(cfg) {
  fs.writeFileSync(FILE, JSON.stringify(secrets.mapFields(cfg, KEY_FIELDS, secrets.seal), null, 2), { mode: 0o600 });
}

/** The effective choice: saved file first, then QA_LLM and the provider's usual key variable, else the Claude Code CLI. */
function current() {
  const c = load();
  const ok = (x) => PROVIDERS[x] && allowedIds().includes(x);
  const id = ok(c.provider) ? c.provider : (ok(process.env.QA_LLM) ? process.env.QA_LLM : (hosted() ? 'anthropic' : 'claude-cli'));
  const def = PROVIDERS[id];
  const keys = c.keys || {};
  return {
    id, def,
    model: c.model && c.provider === id ? c.model : (process.env.QA_LLM_MODEL || def.defaultModel || ''),
    baseUrl: (c.baseUrls && c.baseUrls[id]) || def.baseUrl || '',
    key: keys[id] || process.env[ENV_KEYS[id]] || '',
  };
}

/** The agent command for ACP: a preset, or the user's own command line (split on spaces). */
function acpCommand() {
  const c = load();
  const preset = ACP_PRESETS[c.acpPreset] ? c.acpPreset : 'claude';
  if (preset !== 'custom') return { preset, ...ACP_PRESETS[preset] };
  // Words split on spaces; a part in double quotes may contain spaces (paths on Windows).
  const parts = [...String(c.acpCommand || '').matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] != null ? m[1] : m[2]);
  return { preset, label: ACP_PRESETS.custom.label, command: parts[0] || '', args: parts.slice(1) };
}

/** Who runs the agent of this mode: the Claude Code CLI as always, or the customer's own agent through ACP. */
function runnerFor(mode) {
  const c = current();
  if (c.def.loop) {
    // An API key: the built-in agent loop runs the agent when it only needs the MCP tool servers.
    if (API_MODES.has(mode)) {
      if (c.def.needsKey && !c.key) return { kind: 'unsupported', note: `No API key for ${c.def.label}. Add it in Settings > AI provider.` };
      if (!c.model) return { kind: 'unsupported', note: 'Choose a model name in Settings > AI provider.' };
      return { kind: 'api', label: c.def.label, provider: { id: c.id, key: c.key, model: c.model, baseUrl: c.baseUrl } };
    }
    if (hosted()) return { kind: 'unsupported', note: 'Autotests run code and write into a repository, so they are not part of Flawtrace Cloud yet. The other agents are available.' };
    return { kind: 'claude-cli', note: 'This agent is not available on an API key yet, so it runs on Claude Code.' };
  }
  if (c.id !== 'acp') return { kind: 'claude-cli' };
  const a = acpCommand();
  if (!a.command) return { kind: 'claude-cli', note: 'No agent command set under Settings > AI provider, so this run uses Claude Code.' };
  if (!ACP_MODES.has(mode)) return { kind: 'claude-cli', note: 'This agent is not available on your own agent (ACP) yet, so it runs on Claude Code.' };
  // Only the Claude Code adapter lets Flawtrace limit the agent's built-in tools (Bash, Write, ...), the way the CLI
  // path does. For any other agent the limits are whatever that agent enforces itself.
  return { kind: 'acp', command: a.command, args: a.args, label: a.label, limitsTools: a.preset === 'claude',
    ...(a.preset === 'claude' ? {} : { note: 'Note: for this agent Flawtrace cannot limit its built-in tools; its own permission settings apply.' }) };
}

const mask = (k) => (k ? (k.length > 10 ? k.slice(0, 3) + '…' + k.slice(-4) : '••••') : '');

function view() {
  const c = current();
  return {
    selected: c.id, chosen: !!load().provider, model: c.model, baseUrl: c.baseUrl, keySet: !!c.key, keyHint: mask(c.key),
    hosted: hosted(), apiModes: [...API_MODES],
    providers: Object.entries(PROVIDERS).filter(([id]) => allowedIds().includes(id)).map(([id, p]) => ({ id, label: p.label, needsKey: p.needsKey, needsModel: p.needsModel, baseUrlEditable: p.baseUrl !== false, baseUrlRequired: !!p.baseUrlRequired, agents: p.agents, loop: !!p.loop, note: p.note || '', modelHint: p.modelHint || '', defaultBaseUrl: p.baseUrl || '' })),
    acp: c.id === 'acp' ? { preset: acpCommand().preset, command: load().acpCommand || '', presets: Object.entries(ACP_PRESETS).map(([id, p]) => ({ id, label: p.label })), ported: [...ACP_MODES] } : null,
    agentsNote: c.id === 'acp' ? `Ported to your own agent so far: ${[...ACP_MODES].join(', ')}. The other agents still run on Claude Code and the run log says so.` : c.def.agents ? '' : `With this key these agents run on the built-in agent loop: ${[...API_MODES].join(', ')}. ${hosted() ? 'The other agents are not available yet.' : 'The other agents still run on Claude Code.'}`,
  };
}

function update(b) {
  const id = String(b.provider || '');
  if (!PROVIDERS[id] || !allowedIds().includes(id)) throw Object.assign(new Error('Unknown provider'), { code: 400 });
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
  if (id === 'acp') {
    if (ACP_PRESETS[b.acpPreset]) cfg.acpPreset = b.acpPreset;
    if (typeof b.acpCommand === 'string') cfg.acpCommand = b.acpCommand.trim().slice(0, 500);
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
  if (c.id === 'claude-cli' && !hosted()) {
    const { claudeCliOnce } = require('../claude-once');
    return { ...(await claudeCliOnce(system, input, timeoutMs)), provider: c.id };
  }
  if (c.id === 'acp') throw new Error('Your own agent (ACP) runs the agents, not single steps. Pick another provider for single-step features, or Claude Code.');
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

module.exports = { acpCommand, complete, current, mask, runnerFor, update, view };
