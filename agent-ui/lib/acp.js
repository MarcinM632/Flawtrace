// Minimal Agent Client Protocol client (https://agentclientprotocol.com): runs ONE task on the customer's own coding
// agent (Claude Code, Codex, Gemini CLI, ... through an ACP adapter) and streams what the agent does. No dependencies.
// Wire format (checked against the official schema, v1): newline-delimited JSON-RPC 2.0 over the agent's stdio.
//   client -> agent: initialize, session/new, session/prompt, session/cancel (notification)
//   agent -> client: session/update (notification), session/request_permission (request)
// The system prompt is put in front of the task text, so it works with every agent (the protocol's own systemPrompt
// field is optional and agents may refuse it).
const { spawn } = require('child_process');

const READ_KINDS = new Set(['read', 'search', 'fetch', 'think']);

/** Turns the app's MCP server map ({ name: { command, args, env } }) into the ACP array. */
function toAcpServers(map) {
  return Object.entries(map || {}).map(([name, s]) => ({
    name, command: s.command, args: s.args || [],
    env: Object.entries(s.env || {}).map(([k, v]) => ({ name: k, value: String(v) })),
  }));
}

const textOf = (content) => {
  if (!content) return '';
  if (Array.isArray(content)) return content.map(textOf).join('\n');
  if (content.type === 'content' && content.content) return textOf(content.content);
  return typeof content.text === 'string' ? content.text : '';
};

/**
 * opts: { command, args, cwd, env, mcpServers (ACP array), systemPrompt, prompt, timeoutMs,
 *   allow(toolCall) -> boolean   decides a permission request,
 *   onToolUse({id,name,title,kind,input}), onToolResult({id,text,error}), onText(text), onStatus(text),
 *   isCancelled() -> boolean }
 * Resolves { text, lastText, stopReason, usage, stderr, timedOut, cancelled, proc }.
 */
function runAcp(opts) {
  return new Promise((resolve) => {
    const win = process.platform === 'win32';
    const cmd = win && !/\.exe$/i.test(opts.command) ? 'cmd' : opts.command;
    const argv = win && cmd === 'cmd' ? ['/c', opts.command, ...(opts.args || [])] : (opts.args || []);
    let proc;
    const state = { text: '', lastText: '', stopReason: null, usage: null, stderr: '', timedOut: false, cancelled: false, error: null };
    let settled = false, nextId = 1, buf = '', sessionId = null;
    const pending = new Map();
    const kill = () => { try { if (win) spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); else proc.kill('SIGKILL'); } catch (_) { /* gone */ } };
    const done = (extra) => { if (settled) return; settled = true; clearTimeout(timer); clearInterval(poll); kill(); resolve({ ...state, ...extra, proc }); };

    try { proc = spawn(cmd, argv, { cwd: opts.cwd, env: opts.env || process.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); }
    catch (e) { return resolve({ ...state, error: 'Could not start the agent: ' + e.message }); }
    if (opts.onProc) opts.onProc(proc);
    proc.on('error', (e) => done({ error: 'Could not start the agent: ' + e.message }));
    proc.on('close', (code) => done({ error: state.stopReason ? null : (state.error || `The agent exited (code ${code}) before finishing.`) }));
    proc.stderr.on('data', (c) => { state.stderr = (state.stderr + c.toString('utf8')).slice(-4000); });
    proc.stdin.on('error', () => {});

    const send = (msg) => { try { proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n'); } catch (_) { /* closed */ } };
    const request = (method, params) => new Promise((ok, fail) => { const id = nextId++; pending.set(id, { ok, fail }); send({ id, method, params }); });

    const timer = setTimeout(() => { state.timedOut = true; done({}); }, opts.timeoutMs || 20 * 60000);
    const poll = setInterval(() => {
      if (opts.isCancelled && opts.isCancelled() && !state.cancelled) {
        state.cancelled = true;
        if (sessionId) send({ method: 'session/cancel', params: { sessionId } });
        setTimeout(() => done({}), 3000);
      }
    }, 500);

    const onNotify = (m) => {
      const u = m.params && m.params.update;
      if (!u) return;
      switch (u.sessionUpdate) {
        case 'agent_message_chunk': {
          const t = textOf(u.content);
          if (t) { state.text += t; state.lastText = (state.lastMessageId === u.messageId && u.messageId != null ? state.lastText : '') + t; state.lastMessageId = u.messageId; }
          break;
        }
        case 'tool_call':
          if (opts.onToolUse) opts.onToolUse({ id: u.toolCallId, name: u.name || u.title || '', title: u.title || '', kind: u.kind || 'other', input: u.rawInput });
          break;
        case 'tool_call_update':
          if (u.status === 'completed' || u.status === 'failed') {
            if (opts.onToolResult) opts.onToolResult({ id: u.toolCallId, text: textOf(u.content) || (u.rawOutput != null ? JSON.stringify(u.rawOutput) : ''), error: u.status === 'failed' });
          }
          break;
        case 'usage_update': state.usage = { used: u.used, size: u.size, cost: u.cost || null }; break;
        default: break;
      }
    };
    const onRequest = (m) => {
      if (m.method === 'session/request_permission') {
        const tc = (m.params && m.params.toolCall) || {};
        const options = (m.params && m.params.options) || [];
        let ok = false;
        try { ok = !!opts.allow({ id: tc.toolCallId, name: tc.name || tc.title || '', title: tc.title || '', kind: tc.kind || 'other', input: tc.rawInput }); } catch (_) { ok = false; }
        const pick = options.find((o) => o.kind === (ok ? 'allow_once' : 'reject_once')) || options.find((o) => o.kind.startsWith(ok ? 'allow' : 'reject'));
        if (opts.onStatus && !ok) opts.onStatus(`Denied: ${tc.title || tc.name || 'a tool'} is not on this agent's allowlist`);
        return send({ id: m.id, result: { outcome: pick ? { outcome: 'selected', optionId: pick.optionId } : { outcome: 'cancelled' } } });
      }
      send({ id: m.id, error: { code: -32601, message: 'Method not supported by this client: ' + m.method } });
    };
    proc.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch (_) { continue; }
        if (m.id != null && !m.method) {
          const p = pending.get(m.id); pending.delete(m.id);
          if (p) (m.error ? p.fail(new Error(m.error.message || 'ACP error')) : p.ok(m.result));
        } else if (m.id != null) onRequest(m);
        else onNotify(m);
      }
    });

    (async () => {
      try {
        await request('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: 'flawtrace', version: '1.0.0' } });
        const s = await request('session/new', { cwd: opts.cwd, mcpServers: opts.mcpServers || [] });
        sessionId = s.sessionId;
        const text = (opts.systemPrompt ? opts.systemPrompt + '\n\n---\n\n' : '') + opts.prompt;
        const r = await request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] });
        state.stopReason = r.stopReason || 'end_turn';
        done({});
      } catch (e) { done({ error: e.message }); }
    })();
  });
}

/** Permission policy: an allowlisted tool, or a read-only kind, is allowed; writing, running and deleting are not. */
function allowPolicy(allowlist) {
  const names = (allowlist || []).map((n) => String(n).replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '')).filter(Boolean);
  return (tc) => {
    const hay = `${tc.name} ${tc.title}`.toLowerCase();
    if (names.some((n) => n && hay.includes(n.toLowerCase().replace(/\*$/, '')))) return true;
    return READ_KINDS.has(tc.kind);
  };
}

module.exports = { allowPolicy, runAcp, textOf, toAcpServers };
