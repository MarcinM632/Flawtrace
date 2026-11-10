// Czyste funkcje pomocnicze runów: opis narzędzi i endpointów, wyciąganie raportu, przebieg QA MCP jako wejście dla Autotests.
const { spawn } = require('child_process');
const path = require('path');
const { MCP_SERVER, ROOT } = require('./config');

// Wywołania serwera `plat` są treścią raportu QA MCP, nie szumem — dostają własny typ zdarzenia,
// żeby UI mogło je zliczyć i wypisać osobno. `mcp__${MCP_SERVER}__manager_read_get_account_balance`
// pokazujemy jako `manager_read_get_account_balance`, bo prefiks jest zawsze ten sam.
const MCP_PREFIX = `mcp__${MCP_SERVER}__`;
const isEndpoint = (name) => typeof name === 'string' && name.startsWith(MCP_PREFIX);
function summarizeEndpoint(name, input) {
  const short = name.slice(MCP_PREFIX.length);
  // Wiadomość do testowanego czatu MCP jest wejściem przypadku testowego, więc log pokazuje jej treść.
  if (short === 'general_read_ask_mcp_chat' && input && input.message) return `${short} · „${String(input.message).replace(/\s+/g, ' ').slice(0, 160)}”`;
  const arg = input && (input.clientId || input['order.clientId'] || input.symbol || input.target);
  return arg ? `${short} · ${String(arg).slice(0, 40)}` : short;
}

function summarizeTool(name, input) {
  if (isEndpoint(name)) return summarizeEndpoint(name, input);
  if (!input) return name;
  if (name === 'Bash') return 'Bash: ' + String(input.command || '').split('\n')[0].slice(0, 160);
  if (name === 'Agent' || name === 'Task') return `Subagent ${input.subagent_type || ''}: ${input.description || ''}`;
  if (name === 'Skill') return 'Skill: ' + (input.skill || '');
  if (input.file_path) return `${name}: ${input.file_path}`;
  if (input.pattern) return `${name}: ${input.pattern}`;
  return name;
}

function extractReport(text) {
  const status = (text.match(/^STATUS:\s*(.+)$/m) || [])[1] || null;
  const m = text.match(/---\s*TREŚĆ\s*---\s*\n([\s\S]*?)\n\s*---\s*KONIEC TREŚCI\s*---/);
  if (m) return { report: m[1].trim(), status };

  // Model bywa, że otworzy blok i zgubi znacznik zamykający — zdarza się zwłaszcza, gdy zaraz po
  // treści dopisuje PYTANIA/UWAGI. Raport jest wtedy kompletny, więc szkoda go wyrzucać: bierzemy
  // wszystko od znacznika otwierającego do pierwszej z tych linii (albo do końca).
  const open = text.match(/---\s*TREŚĆ\s*---\s*\n/);
  if (!open) return { report: null, status };
  const rest = text.slice(open.index + open[0].length);
  const cut = rest.search(/^\s*(PYTANIA|UWAGI|POMINIĘTO)\s*:/m);
  return { report: (cut >= 0 ? rest.slice(0, cut) : rest).trim() || null, status };
}

// ---------- Autotests: z logu QA MCP, pliki, sprawdzenie ----------
/** Bramka, metoda, ścieżka i kontrakt wskazanych narzędzi — z lokalnego katalogu mcp-server, bez sieci. */
function endpointContracts(names) {
  return new Promise((resolve) => {
    const safe = [...new Set(names)].filter((n) => /^[a-z0-9_]+$/.test(n) && !n.startsWith('general_'));
    if (!safe.length) return resolve([]);
    const proc = spawn('node', ['tools/describe-endpoints.mjs', ...safe], { cwd: path.join(ROOT, 'mcp-server'), stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    let out = '';
    const timer = setTimeout(() => { proc.kill(); resolve([]); }, 20000);
    proc.stdout.on('data', (c) => { out += c; });
    proc.on('error', () => { clearTimeout(timer); resolve([]); });
    proc.on('close', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(out.trim().split('\n').pop())); } catch (_) { resolve([]); }
    });
  });
}

// Zapisy (PUT/POST: cała reguła, zlecenie) muszą dojść w całości, bo z nich test odtwarza konfigurację; skracamy odczyty.
const FLOW_STEPS_MAX = 30000;
const isWriteStep = (e) => !/_read_/.test(String(e.text).split(' · ')[0]);
/** Kroki przebiegu: wywołanie z parametrami i (gdy run je zapisał) skrócona odpowiedź endpointu po "→". */
function flowSteps(events, outMax) {
  const lines = [];
  let prev = null, rep = 0;
  const flush = () => { if (prev && rep > 1) lines[lines.length - 1].text += '  ×' + rep; prev = null; rep = 0; };
  for (const e of events) {
    if (e.type === 'endpoint') {
      const name = String(e.text).split(' · ')[0];
      const call = e.input ? name + ' ' + e.input : String(e.text);
      const max = isWriteStep(e) ? Math.max(outMax, 600) : outMax;
      const out = e.output ? '\n   → ' + (e.error ? 'BŁĄD: ' : '') + (e.output.length > max ? e.output.slice(0, max) + '…' : e.output) : '';
      // Ponawiany odczyt (czekanie na stan) zwijamy do jednej linii z ×N i odpowiedzią z OSTATNIEGO odczytu.
      if (call === prev) { rep++; lines[lines.length - 1].out = out; continue; }
      flush(); lines.push({ text: call, out }); prev = call; rep = 1;
    } else if (e.type === 'text' && e.who === 'main' && !/^\s*STATUS:/.test(e.text)) {
      flush(); lines.push({ text: 'note: ' + String(e.text).replace(/\s+/g, ' ').trim().slice(0, 300), out: '' });
    }
  }
  flush();
  return lines.map((l, i) => (i + 1) + '. ' + l.text + l.out).join('\n');
}

/** Przebieg runu QA MCP jako tekst dla agenta Autotests: wywołania z parametrami i odpowiedziami, notatki, wynik. */
function flowFromRun(src, contracts = []) {
  // Odpowiedzi skracamy coraz mocniej, aż cały przebieg się zmieści; ucięcie końca to ostateczność.
  let steps = '';
  for (const outMax of [500, 300, 160, 80]) { steps = flowSteps(src.events, outMax); if (steps.length <= FLOW_STEPS_MAX) break; }
  // Gdy i tak za długo, wycinamy środek: początek (stan wyjściowy, konfiguracja) i koniec (wynik, sprzątanie) są najcenniejsze.
  if (steps.length > FLOW_STEPS_MAX) {
    const head = Math.floor(FLOW_STEPS_MAX * 0.45);
    steps = steps.slice(0, head) + '\n(… the middle of the log was cut …)\n' + steps.slice(-(FLOW_STEPS_MAX - head));
  }
  const hasOutputs = src.events.some((e) => e.type === 'endpoint' && e.output);
  let known = contracts.filter((c) => !c.error).map((c) =>
    '- ' + c.tool + ': ' + c.gateway.toUpperCase() + ' ' + c.method + ' ' + c.path + (c.readOnly ? '  (odczyt)' : '  (zapis)')
    + '\n    wejście: ' + JSON.stringify(c.input) + (c.response && Object.keys(c.response).length ? '\n    odpowiedź: ' + JSON.stringify(c.response).slice(0, 400) : '')).join('\n');
  if (known.length > 6500) known = known.slice(0, 6500) + '\n(… cut)';
  const m = src.meta;
  return 'Zlecenie testera (tak, jak dostał je agent QA MCP — to plan, nie dowód, że coś wykonano):\n' + String(m.ticket).slice(0, 1500)
    + '\n\nPrzebieg — wywołania endpointów po kolei (nazwa i parametry JSON)'
    + (hasOutputs ? '; pod wywołaniem po "→" odpowiedź, którą endpoint NAPRAWDĘ zwrócił (skrócona)' : '; ten run nie zapisywał odpowiedzi endpointów, więc pola znasz tylko z kontraktów i notatek')
    + '; "note" to krótka notatka agenta o wyniku kroku:\n' + steps
    + (known ? '\n\nEndpointy z tego przebiegu — bramka, metoda, ścieżka i kontrakt (z katalogu serwera MCP; to są fakty dla helperów):\n' + known : '')
    + '\n\nWynik końcowy' + (m.reportStatus ? ' (status: ' + m.reportStatus + ')' : '') + ':\n'
    + String(m.report || m.finalText || '(brak)').slice(0, 3000);
}

module.exports = {
  endpointContracts,
  extractReport,
  flowFromRun,
  isEndpoint,
  summarizeTool,
};
