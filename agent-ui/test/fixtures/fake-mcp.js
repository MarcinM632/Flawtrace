// A tiny MCP server for tests: `echo` returns its input, `boom` fails, `big` returns a long text.
const { serve } = require('../../mcp/stdio');
serve({
  name: 'fake', tools: [
    { name: 'echo', description: 'Returns the text it gets', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, handler: async (a) => 'echo:' + a.text },
    { name: 'boom', description: 'Always fails', inputSchema: { type: 'object', properties: {} }, handler: async () => { throw new Error('boom happened'); } },
    { name: 'big', description: 'Long answer', inputSchema: { type: 'object', properties: {} }, handler: async () => 'x'.repeat(100000) },
    { name: 'secret_tool', description: 'Not on the allowlist', inputSchema: { type: 'object', properties: {} }, handler: async () => 'should never run' },
  ],
});
