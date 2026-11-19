// AI providers. Each one turns (system, input) into text with one HTTP call, using the key the USER supplies.
// The owner of Flawtrace never pays for anybody's tokens: a key lives in the user's own data folder.
// `agents: true` marks a provider that can also drive the full agents (tool use). Today that is only the Claude Code
// CLI; the API providers serve the single-step features until the agent loop exists (see docs/saas-plan.md).

const PROVIDERS = {
  'claude-cli': { label: 'Claude Code (your own login)', needsKey: false, needsModel: false, baseUrl: false, agents: true,
    note: 'Uses the Claude Code CLI signed in on this machine. Runs every agent.' },
  acp: { label: 'Your own coding agent (ACP): Claude Code, Codex, Gemini CLI, ...', needsKey: false, needsModel: false, baseUrl: false, agents: true, acp: true,
    note: 'Flawtrace starts the agent you already have and gives it the task. It uses your own login or key; nothing goes through anybody else.' },
  anthropic: { label: 'Anthropic API (Claude)', needsKey: true, needsModel: true, baseUrl: 'https://api.anthropic.com', agents: false, loop: true, modelHint: 'claude-sonnet-5-5', defaultModel: 'claude-sonnet-5-5' },
  openai: { label: 'OpenAI API (ChatGPT)', needsKey: true, needsModel: true, baseUrl: 'https://api.openai.com/v1', agents: false, loop: true, modelHint: 'model id from your OpenAI console' },
  gemini: { label: 'Google Gemini API', needsKey: true, needsModel: true, baseUrl: 'https://generativelanguage.googleapis.com/v1beta', agents: false, loop: true, modelHint: 'model id from Google AI Studio' },
  'openai-compatible': { label: 'Any OpenAI-compatible endpoint (local or other)', needsKey: false, needsModel: true, baseUrl: '', baseUrlRequired: true, agents: false, loop: true, modelHint: 'model name served at the address' },
};

const trim = (s) => String(s || '').replace(/\/+$/, '');

async function post(url, headers, body, timeoutMs) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (_) { /* not JSON */ }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(json && (json.error && (json.error.message || json.error) || json.message)) || text.slice(0, 300)}`);
  return json || {};
}

const CALLS = {
  async anthropic({ key, model, baseUrl, system, input, timeoutMs }) {
    const j = await post(trim(baseUrl) + '/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      { model, max_tokens: 8192, system, messages: [{ role: 'user', content: input }] }, timeoutMs);
    return { text: (j.content || []).map((c) => c.text || '').join(''), usage: { input: j.usage && j.usage.input_tokens, output: j.usage && j.usage.output_tokens } };
  },
  async openai({ key, model, baseUrl, system, input, timeoutMs }) {
    const j = await post(trim(baseUrl) + '/chat/completions', key ? { authorization: 'Bearer ' + key } : {},
      { model, messages: [{ role: 'system', content: system }, { role: 'user', content: input }] }, timeoutMs);
    const u = j.usage || {};
    return { text: (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '', usage: { input: u.prompt_tokens, output: u.completion_tokens } };
  },
  async gemini({ key, model, baseUrl, system, input, timeoutMs }) {
    const j = await post(`${trim(baseUrl)}/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': key },
      { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: input }] }] }, timeoutMs);
    const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
    const u = j.usageMetadata || {};
    return { text: parts.map((p) => p.text || '').join(''), usage: { input: u.promptTokenCount, output: u.candidatesTokenCount } };
  },
};
CALLS['openai-compatible'] = CALLS.openai;

// Adapters that make a coding agent speak ACP (package names confirmed on npm). "custom" is any command the user gives.
const ACP_PRESETS = {
  claude: { label: 'Claude Code', command: 'npx', args: ['-y', '@agentclientprotocol/claude-agent-acp'] },
  codex: { label: 'Codex', command: 'npx', args: ['-y', '@zed-industries/codex-acp'] },
  custom: { label: 'Other agent (type the command)', command: '', args: [] },
};
// Agents already ported to the ACP runner. The others still run on Claude Code and say so in the run log.
const ACP_MODES = new Set(['uitest', 'qamcp', 'execution']);

// Agents that the built-in loop (lib/agent-loop.js) can run on an API key: they only need the MCP tool servers.
// The others also need a shell or file writing and stay on Claude Code / ACP until the loop gets those tools.
const API_MODES = new Set(['uitest', 'qamcp', 'execution', 'pentest']);

module.exports = { API_MODES, ACP_MODES, ACP_PRESETS, CALLS, PROVIDERS };
