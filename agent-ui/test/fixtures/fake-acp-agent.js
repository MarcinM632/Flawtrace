// A tiny ACP agent for tests: speaks the real wire format, does no AI. Behaviour is chosen by words in the prompt.
const rl = require('readline').createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
let nextReq = 1000; const waiting = new Map(); let session = null;
rl.on('line', async (line) => {
  const m = JSON.parse(line);
  if (m.id != null && !m.method) { const w = waiting.get(m.id); if (w) w(m.result); return; }
  if (m.method === 'initialize') return send({ id: m.id, result: { protocolVersion: 1, agentCapabilities: {} } });
  if (m.method === 'session/new') { session = { cwd: m.params.cwd, mcp: m.params.mcpServers, meta: m.params._meta }; return send({ id: m.id, result: { sessionId: 's1' } }); }
  if (m.method === 'session/cancel') return;
  if (m.method === 'session/prompt') {
    const text = m.params.prompt[0].text;
    const upd = (update) => send({ method: 'session/update', params: { sessionId: 's1', update } });
    if (text.includes('HANG')) return; // never answers: used for timeout and cancel
    upd({ sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'Looking at ' } });
    upd({ sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'the page.' } });
    for (const [tool, kind] of [['mcp__playwright__browser_navigate', 'other'], ['Write file', 'edit']]) {
      upd({ sessionUpdate: 'tool_call', toolCallId: tool, title: tool, kind, status: 'pending', rawInput: { url: 'http://localhost:9/' } });
      const id = nextReq++;
      const outcome = await new Promise((ok) => { waiting.set(id, ok); send({ id, method: 'session/request_permission', params: { sessionId: 's1', toolCall: { toolCallId: tool, title: tool, kind }, options: [{ optionId: 'a', name: 'Allow', kind: 'allow_once' }, { optionId: 'r', name: 'Reject', kind: 'reject_once' }] } }); });
      const allowed = outcome.outcome.outcome === 'selected' && outcome.outcome.optionId === 'a';
      upd({ sessionUpdate: 'tool_call_update', toolCallId: tool, status: allowed ? 'completed' : 'failed', content: [{ type: 'content', content: { type: 'text', text: !allowed ? 'denied' : text.includes('UIREPORT') && /navigate/.test(tool) ? '- heading "Welcome back" [level=1] [ref=e1]' : 'ok ' + tool } }] });
    }
    if (text.includes('UIREPORT')) {
      // A UI report with one PASS line the page showed and one it never showed: the app's audit must catch the second.
      upd({ sessionUpdate: 'agent_message_chunk', messageId: 'm2', content: { type: 'text', text: ['STATUS: VERIFIED', '--- TREŚĆ ---', '## Steps', '[s1] PASS — open the page → heading "Welcome back"', '## Checks',
        '[a1] PASS — heading "Your dashboard" is visible (after s1)', '## Findings', 'None', '--- KONIEC TREŚCI ---'].join('\n') } });
      return send({ id: m.id, result: { stopReason: 'end_turn' } });
    }
    upd({ sessionUpdate: 'agent_message_chunk', messageId: 'm2', content: { type: 'text', text: 'REPORT: done. mcp=' + JSON.stringify(session.mcp) + ' meta=' + JSON.stringify(session.meta || null) } });
    send({ id: m.id, result: { stopReason: 'end_turn' } });
  }
});
