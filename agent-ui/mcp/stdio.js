// A minimal MCP server over stdio (JSON-RPC 2.0, one message per line). No dependencies.
// serve({ name, version, tools: [{ name, description, inputSchema, handler }] })
const readline = require('readline');

function serve({ name, version = '1.0.0', instructions = '', tools }) {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
  const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch (_) { return fail(null, -32700, 'Parse error'); }
    const { id, method, params } = msg;
    if (id === undefined) return; // notification
    try {
      if (method === 'initialize') {
        return reply(id, {
          protocolVersion: (params && params.protocolVersion) || '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name, version },
          ...(instructions ? { instructions } : {}),
        });
      }
      if (method === 'ping') return reply(id, {});
      if (method === 'tools/list') return reply(id, { tools: tools.map(({ name: n, description, inputSchema }) => ({ name: n, description, inputSchema })) });
      if (method === 'tools/call') {
        const t = byName.get(params && params.name);
        if (!t) return reply(id, { content: [{ type: 'text', text: `Unknown tool ${params && params.name}` }], isError: true });
        try {
          const out = await t.handler((params && params.arguments) || {});
          return reply(id, { content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 2) }] });
        } catch (e) {
          return reply(id, { content: [{ type: 'text', text: 'Error: ' + (e && e.message ? e.message : String(e)) }], isError: true });
        }
      }
      if (method === 'resources/list') return reply(id, { resources: [] });
      if (method === 'prompts/list') return reply(id, { prompts: [] });
      return fail(id, -32601, 'Method not found: ' + method);
    } catch (e) {
      return fail(id, -32603, e.message);
    }
  });
}

/** Cuts a long text so one tool answer does not fill the context of the agent. */
const clip = (s, n = 60000) => (s.length > n ? s.slice(0, n) + `\n... (cut, ${s.length} characters in total)` : s);

module.exports = { serve, clip };
