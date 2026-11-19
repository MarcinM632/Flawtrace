// One model turn WITH tools, for the API-key providers. The agent loop (lib/agent-loop.js) is built on this.
//   chatTurn({ provider, key, model, baseUrl, system, messages, tools, signal }) -> { text, calls, usage, stop, raw }
// Messages use one neutral shape, converted per provider:
//   { role: 'user', text }
//   { role: 'assistant', text, calls: [{ id, name, input }], raw }      raw = provider-native content to replay exactly
//   { role: 'tool', results: [{ id, name, text, isError }] }
// tools: [{ name, description, schema }]   (names must already be valid for the provider: [A-Za-z0-9_-], at most 64)
// Failed calls with a transient cause (429, 5xx, overloaded) are retried with a growing pause.

const trim = (s) => String(s || '').replace(/\/+$/, '');
const sleep = (ms, signal) => new Promise((res) => { const t = setTimeout(res, ms); if (signal) signal.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true }); });

async function post(url, headers, body, { signal, timeoutMs = 300000, retries = 4 } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal && signal.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true });
    const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    let res, text;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: sig });
      text = await res.text();
    } catch (e) {
      if (signal && signal.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true });
      last = new Error('Network error: ' + (e && e.message || e));
      if (attempt < retries) { await sleep(1500 * 2 ** attempt, signal); continue; }
      throw last;
    }
    let json = null; try { json = JSON.parse(text); } catch (_) { /* not JSON */ }
    if (res.ok) return json || {};
    const msg = (json && ((json.error && (json.error.message || json.error)) || json.message)) || text.slice(0, 300);
    last = Object.assign(new Error(`HTTP ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`), { status: res.status });
    const transient = res.status === 429 || res.status === 408 || res.status === 409 || res.status >= 500 || res.status === 529;
    if (!transient || attempt === retries) throw last;
    const ra = Number(res.headers.get('retry-after'));
    await sleep(Math.min(60000, ra > 0 ? ra * 1000 : 1500 * 2 ** attempt), signal);
  }
  throw last;
}

const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const parseArgs = (s) => { if (s && typeof s === 'object') return s; try { return asObject(JSON.parse(s || '{}')); } catch (_) { return {}; } };

// ---------- Anthropic ----------
const anthropic = {
  async turn({ key, model, baseUrl, system, messages, tools, signal, maxTokens }) {
    const msgs = messages.map((m) => {
      if (m.role === 'user') return { role: 'user', content: m.text };
      if (m.role === 'assistant') {
        const content = [];
        if (m.text) content.push({ type: 'text', text: m.text });
        for (const c of m.calls || []) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input || {} });
        return { role: 'assistant', content: content.length ? content : [{ type: 'text', text: '(no text)' }] };
      }
      return { role: 'user', content: m.results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.text || '(empty)', ...(r.isError ? { is_error: true } : {}) })) };
    });
    const defs = tools.map((t, i) => ({ name: t.name, description: t.description || '', input_schema: t.schema && t.schema.type ? t.schema : { type: 'object', properties: {} }, ...(i === tools.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}) }));
    const j = await post(trim(baseUrl) + '/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      { model, max_tokens: maxTokens || 16000, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], messages: msgs, ...(defs.length ? { tools: defs } : {}) }, { signal });
    const blocks = j.content || [];
    const u = j.usage || {};
    return {
      text: blocks.filter((b) => b.type === 'text').map((b) => b.text).join(''),
      calls: blocks.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: asObject(b.input) })),
      usage: { input: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), output: u.output_tokens || 0, cached: u.cache_read_input_tokens || 0 },
      stop: j.stop_reason === 'tool_use' ? 'tool' : j.stop_reason === 'max_tokens' ? 'length' : 'end',
    };
  },
};

// ---------- OpenAI and anything that speaks its chat-completions format ----------
const openai = {
  async turn({ key, model, baseUrl, system, messages, tools, signal }) {
    const msgs = [{ role: 'system', content: system }];
    for (const m of messages) {
      if (m.role === 'user') msgs.push({ role: 'user', content: m.text });
      else if (m.role === 'assistant') {
        msgs.push({ role: 'assistant', content: m.text || null, ...(m.calls && m.calls.length ? { tool_calls: m.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input || {}) } })) } : {}) });
      } else for (const r of m.results) msgs.push({ role: 'tool', tool_call_id: r.id, content: r.text || '(empty)' });
    }
    const defs = tools.map((t) => ({ type: 'function', function: { name: t.name, description: (t.description || '').slice(0, 1000), parameters: t.schema && t.schema.type ? t.schema : { type: 'object', properties: {} } } }));
    const j = await post(trim(baseUrl) + '/chat/completions', key ? { authorization: 'Bearer ' + key } : {}, { model, messages: msgs, ...(defs.length ? { tools: defs } : {}) }, { signal });
    const ch = (j.choices && j.choices[0]) || {};
    const msg = ch.message || {};
    const u = j.usage || {};
    return {
      text: typeof msg.content === 'string' ? msg.content : '',
      calls: (msg.tool_calls || []).map((c, i) => ({ id: c.id || 'call_' + i, name: c.function && c.function.name, input: parseArgs(c.function && c.function.arguments) })).filter((c) => c.name),
      usage: { input: u.prompt_tokens || 0, output: u.completion_tokens || 0, cached: (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0 },
      stop: ch.finish_reason === 'tool_calls' ? 'tool' : ch.finish_reason === 'length' ? 'length' : (msg.tool_calls && msg.tool_calls.length ? 'tool' : 'end'),
    };
  },
};

// ---------- Google Gemini ----------
const GEMINI_KEYS = ['type', 'description', 'enum', 'properties', 'required', 'items', 'format', 'nullable', 'minimum', 'maximum', 'minItems', 'maxItems'];
/** Gemini accepts a subset of JSON Schema: keep what it knows, flatten unions, drop the rest. */
function geminiSchema(s) {
  if (!s || typeof s !== 'object') return { type: 'string' };
  const out = {};
  let type = s.type;
  if (Array.isArray(type)) { if (type.includes('null')) out.nullable = true; type = type.find((t) => t !== 'null') || 'string'; }
  if (!type && (s.anyOf || s.oneOf)) {
    const alt = (s.anyOf || s.oneOf).filter((x) => x && x.type !== 'null');
    if ((s.anyOf || s.oneOf).length > alt.length) out.nullable = true;
    return { ...geminiSchema(alt[0] || { type: 'string' }), ...out };
  }
  if (!type) type = s.properties ? 'object' : s.items ? 'array' : 'string';
  out.type = String(type).toLowerCase();
  for (const k of GEMINI_KEYS) {
    if (k === 'type' || s[k] === undefined) continue;
    if (k === 'properties') { out.properties = {}; for (const [n, v] of Object.entries(s.properties || {})) out.properties[n] = geminiSchema(v); }
    else if (k === 'items') out.items = geminiSchema(s.items);
    else if (k === 'enum') out.enum = (s.enum || []).map(String);
    else if (k === 'required') out.required = (s.required || []).filter((r) => !s.properties || r in s.properties);
    else if (k !== 'nullable' || s.nullable) out[k] = s[k];
  }
  if (out.type === 'object' && !out.properties) out.properties = {};
  if (out.type === 'array' && !out.items) out.items = { type: 'string' };
  if (out.required && !out.required.length) delete out.required;
  return out;
}
const gemini = {
  async turn({ key, model, baseUrl, system, messages, tools, signal }) {
    const contents = [];
    for (const m of messages) {
      if (m.role === 'user') contents.push({ role: 'user', parts: [{ text: m.text }] });
      else if (m.role === 'assistant') contents.push(m.raw ? { role: 'model', parts: m.raw } : { role: 'model', parts: [...(m.text ? [{ text: m.text }] : []), ...(m.calls || []).map((c) => ({ functionCall: { name: c.name, args: c.input || {} } }))] });
      else contents.push({ role: 'user', parts: m.results.map((r) => ({ functionResponse: { name: r.name, response: r.isError ? { error: r.text } : { result: r.text } } })) });
    }
    const body = { systemInstruction: { parts: [{ text: system }] }, contents };
    if (tools.length) body.tools = [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: (t.description || '').slice(0, 1000), ...(t.schema && t.schema.properties && Object.keys(t.schema.properties).length ? { parameters: geminiSchema(t.schema) } : {}) })) }];
    const j = await post(`${trim(baseUrl)}/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': key }, body, { signal });
    const cand = (j.candidates && j.candidates[0]) || {};
    const parts = (cand.content && cand.content.parts) || [];
    const u = j.usageMetadata || {};
    let n = 0;
    const calls = parts.filter((p) => p.functionCall).map((p) => ({ id: p.functionCall.id || 'call_' + (n++), name: p.functionCall.name, input: asObject(p.functionCall.args) }));
    if (!parts.length && j.promptFeedback && j.promptFeedback.blockReason) throw new Error('Gemini blocked the request: ' + j.promptFeedback.blockReason);
    return {
      text: parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join(''),
      calls, raw: parts.length ? parts : undefined,
      usage: { input: u.promptTokenCount || 0, output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0), cached: u.cachedContentTokenCount || 0 },
      stop: calls.length ? 'tool' : cand.finishReason === 'MAX_TOKENS' ? 'length' : 'end',
    };
  },
};

const ADAPTERS = { anthropic, openai, 'openai-compatible': openai, gemini };

async function chatTurn(opts) {
  const a = ADAPTERS[opts.provider];
  if (!a) throw new Error('This provider cannot drive agents: ' + opts.provider);
  try { return await a.turn(opts); }
  catch (e) {
    if (e && e.cancelled) throw e;
    let m = String(e && e.message || e);
    if (opts.key) m = m.split(opts.key).join('***');
    throw Object.assign(new Error(m), { status: e && e.status });
  }
}

module.exports = { ADAPTERS, chatTurn, geminiSchema };
