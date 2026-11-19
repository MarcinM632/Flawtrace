// Minimal MCP client over stdio (JSON-RPC 2.0, one message per line). No dependencies.
// Used by the agent loop for API-key providers: it starts the MCP servers of a run (qa, sources, playwright, ...),
// lists their tools and calls them on behalf of the model.
const { spawn } = require('child_process');

const REQUEST_MS = Number(process.env.MCP_TOOL_TIMEOUT) || 30 * 60000;

/** Starts one server: { command, args, env } -> { tools, call(name, args), close() }. */
function connect(name, spec, { cwd, env, onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const win = process.platform === 'win32';
    // npx and other .cmd shims need a shell on Windows; a plain node.exe does not.
    const cmd = win && !/\.exe$/i.test(spec.command) && spec.command !== 'node' ? 'cmd' : spec.command;
    const argv = win && cmd === 'cmd' ? ['/c', spec.command, ...(spec.args || [])] : (spec.args || []);
    let proc;
    try { proc = spawn(cmd, argv, { cwd, env: { ...process.env, ...(env || {}), ...(spec.env || {}) }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); }
    catch (e) { return reject(new Error(`MCP server "${name}" did not start: ${e.message}`)); }
    let buf = '', nextId = 1, closed = false, stderr = '';
    const pending = new Map();
    const kill = () => { if (closed) return; closed = true; try { if (win) spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); else proc.kill('SIGKILL'); } catch (_) { /* gone */ } };
    const failAll = (why) => { for (const p of pending.values()) p.fail(new Error(why)); pending.clear(); };
    proc.on('error', (e) => { failAll(`MCP server "${name}": ${e.message}`); reject(new Error(`MCP server "${name}" did not start: ${e.message}`)); });
    proc.on('close', (code) => { closed = true; failAll(`MCP server "${name}" exited (code ${code}). ${stderr.slice(-300)}`); });
    proc.stderr.on('data', (c) => { stderr = (stderr + c.toString('utf8')).slice(-4000); if (onStderr) onStderr(c.toString('utf8')); });
    proc.stdin.on('error', () => {});
    proc.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch (_) { continue; }
        if (m.id != null && !m.method) {
          const p = pending.get(m.id); pending.delete(m.id);
          if (p) { clearTimeout(p.timer); m.error ? p.fail(new Error(m.error.message || 'MCP error')) : p.ok(m.result); }
        } else if (m.id != null && m.method) {
          // A server asking the client for something (sampling, roots): not supported.
          try { proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Not supported' } }) + '\n'); } catch (_) { /* closed */ }
        }
      }
    });
    const request = (method, params, ms = REQUEST_MS) => new Promise((ok, fail) => {
      if (closed) return fail(new Error(`MCP server "${name}" is not running.`));
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); fail(new Error(`MCP server "${name}": ${method} timed out after ${Math.round(ms / 1000)} s`)); }, ms);
      pending.set(id, { ok, fail, timer });
      try { proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); } catch (e) { clearTimeout(timer); pending.delete(id); fail(e); }
    });
    (async () => {
      try {
        await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'flawtrace', version: '1.0.0' } }, 120000);
        try { proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'); } catch (_) { /* closed */ }
        const tools = [];
        let cursor;
        do {
          const r = await request('tools/list', cursor ? { cursor } : {}, 120000);
          tools.push(...(r.tools || []));
          cursor = r.nextCursor;
        } while (cursor);
        resolve({
          name, tools,
          async call(tool, args) {
            const r = await request('tools/call', { name: tool, arguments: args || {} });
            const text = (r.content || []).map((c) => c.type === 'text' ? c.text : c.type === 'image' ? '[image]' : c.type === 'resource' && c.resource && c.resource.text ? c.resource.text : '').filter(Boolean).join('\n');
            return { text: text || (r.structuredContent ? JSON.stringify(r.structuredContent) : ''), isError: !!r.isError };
          },
          close: kill,
          get stderr() { return stderr; },
        });
      } catch (e) { kill(); reject(e); }
    })();
  });
}

/** Starts every server of a map { name: { command, args, env } }. A server that fails is reported, not fatal. */
async function connectAll(map, opts = {}) {
  const ok = [], failed = [];
  await Promise.all(Object.entries(map || {}).map(async ([name, spec]) => {
    try { ok.push(await connect(name, spec, opts)); } catch (e) { failed.push({ name, error: String(e && e.message || e) }); }
  }));
  return { clients: ok, failed, close: () => ok.forEach((c) => c.close()) };
}

module.exports = { connect, connectAll };
