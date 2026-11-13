// Weryfikator raportów: drugi, niezależny agent (osobna sesja claude -p, nie wznowienie sesji autora) sprawdza raport
// punkt po punkcie ze źródłami: Jira, Confluence, baza wiedzy, kod, specyfikacja API. Jego instrukcja to
// agents/claudeAgentVerifier/CLAUDE.md. Aplikacja nie ufa i jemu: cytat, którego nie ma w raporcie, jest odrzucany,
// a zbyt długie zdania łapie deterministyczna kontrola bez modelu.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const sources = require('./sources');
const { AGENTS_ROOT, MODEL, RUNS_DIR } = require('./config');

const FILE = () => path.join(AGENTS_ROOT, 'claudeAgentVerifier', 'CLAUDE.md');
const LIMIT_MS = () => (Number(process.env.QA_VERIFIER_LIMIT_MIN) || 15) * 60000;
const MAX_WORDS = 35; // zdanie dłuższe niż to jest "pogmatwane"
const MAX_ISSUES = 25; // tyle zarzutów naraz da się sensownie poprawić w jednej turze

const enabled = () => process.env.QA_VERIFIER !== '0' && fs.existsSync(FILE());

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

const LABEL = {
  'bad-source': 'Wrong or missing source',
  unsupported: 'No source for this claim',
  'term-not-in-sources': 'Term not used in the sources',
  'complex-sentence': 'Sentence too complex',
  vague: 'Guessing word instead of a fact',
  contradiction: 'Contradicts a source',
  'cannot-verify': 'Could not be checked',
};

/** Deterministyczna kontrola długości zdań: nie potrzebuje modelu, więc działa zawsze. */
function longSentences(report) {
  const out = [];
  for (const line of String(report || '').split('\n')) {
    const text = line.replace(/`[^`]*`/g, 'X').replace(/\(src:[^)]*\)/gi, '').replace(/^[\s>*#|\-–\d.)]+/, '');
    for (const s of text.split(/(?<=[.!?;])\s+/)) {
      const words = s.split(/\s+/).filter(Boolean).length;
      if (words > MAX_WORDS) out.push({ code: 'verify-long-sentence', quote: s.trim().slice(0, 200), text: `Sentence too long (${words} words, the limit is ${MAX_WORDS}): "${s.trim().slice(0, 120)}…". Split it into short sentences with one fact each.` });
    }
  }
  return out.slice(0, 8);
}

/** Wyciąga obiekt JSON z odpowiedzi modelu (może być w bloku ```json albo otoczony tekstem). */
function parseVerdict(text) {
  const t = String(text || '');
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced && fenced[1], t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)].filter(Boolean);
  for (const c of candidates) {
    try { const j = JSON.parse(c); if (j && Array.isArray(j.findings)) return j; } catch (_) { /* próbuj dalej */ }
  }
  return null;
}

/** Zamienia odpowiedź weryfikatora w listę problemów; odrzuca cytaty, których nie ma w raporcie. */
function toIssues(verdict, report) {
  const hay = norm(report);
  const issues = []; let dropped = 0;
  for (const f of verdict.findings || []) {
    const type = LABEL[f && f.type] ? f.type : 'unsupported';
    const quote = String((f && f.quote) || '').trim();
    if (type !== 'cannot-verify' && (quote.length < 4 || !hay.includes(norm(quote)))) { dropped++; continue; }
    const parts = [`${LABEL[type]}: "${quote.slice(0, 160)}"`, f.problem && String(f.problem).trim(), f.evidence && `Source says: ${String(f.evidence).trim()}`, f.fix && `Fix: ${String(f.fix).trim()}`].filter(Boolean);
    issues.push({ code: 'verify-' + type, quote, text: parts.join(' — ').slice(0, 700) });
  }
  return { issues, dropped };
}

/** Jedno przejście weryfikatora. Zwraca { ran, checked, issues, dropped, costUsd, error }. Nigdy nie rzuca. */
function verifyReport({ report, kind, task, workDir, onProc, isCancelled }) {
  const base = { ran: false, checked: 0, issues: [], dropped: 0, costUsd: 0 };
  if (!report) return Promise.resolve(base);
  const long = longSentences(report);
  if (!enabled()) return Promise.resolve({ ...base, issues: long, error: process.env.QA_VERIFIER === '0' ? 'switched off (QA_VERIFIER=0)' : 'no CLAUDE.md in agents/claudeAgentVerifier' });
  return new Promise((resolve) => {
    const dir = path.join(RUNS_DIR, 'work', 'verifier');
    fs.mkdirSync(dir, { recursive: true });
    const tag = crypto.randomBytes(4).toString('hex');
    const sysFile = path.join(dir, tag + '.system.txt');
    const cfg = path.join(dir, tag + '.mcp.json');
    fs.writeFileSync(sysFile, fs.readFileSync(FILE(), 'utf8') + '\n\n' + sources.brief('qa'));
    fs.writeFileSync(cfg, JSON.stringify({ mcpServers: sources.mcpServers({ api: false, knowledge: true }) }));
    const repos = sources.repoList().filter((r) => r.ready).map((r) => r.path);
    const addDirs = [workDir, ...repos].filter(Boolean).flatMap((d) => ['--add-dir', d]);
    const args = ['-p', '--model', MODEL, '--output-format', 'json', '--system-prompt-file', sysFile,
      '--mcp-config', cfg, '--strict-mcp-config', '--permission-mode', 'dontAsk', '--no-session-persistence',
      '--tools', 'Read,Grep,Glob', '--allowedTools', 'Read', 'Grep', 'Glob', 'mcp__sources', ...addDirs];
    let proc, out = '', err = '', done = false;
    const end = (extra) => {
      if (done) return; done = true; clearTimeout(timer);
      fs.rm(sysFile, { force: true }, () => {}); fs.rm(cfg, { force: true }, () => {});
      resolve({ ...base, ...extra, issues: [...(extra.issues || []), ...long] });
    };
    const timer = setTimeout(() => { try { proc.kill(); } catch (_) { /* już zakończony */ } end({ error: `The verifier hit its ${Math.round(LIMIT_MS() / 60000)}-minute limit` }); }, LIMIT_MS());
    try { proc = spawn('claude', args, { cwd: workDir || dir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' } }); }
    catch (e) { return end({ error: 'Could not start the verifier: ' + e.message }); }
    if (onProc) onProc(proc);
    proc.stdout.on('data', (c) => { out += c; });
    proc.stderr.on('data', (c) => { err += c; });
    proc.on('error', (e) => end({ error: 'Could not start the verifier: ' + e.message }));
    proc.on('close', (code) => {
      if (isCancelled && isCancelled()) return end({ error: 'cancelled' });
      let j = null;
      try { j = JSON.parse(out.trim().split('\n').filter(Boolean).pop()); } catch (_) { /* nie JSON */ }
      const costUsd = (j && j.total_cost_usd) || 0;
      if (!j || j.is_error || typeof j.result !== 'string') return end({ costUsd, error: (j && j.result) || err.trim().slice(-300) || `The verifier exited with code ${code}` });
      const verdict = parseVerdict(j.result);
      if (!verdict) return end({ costUsd, error: 'The verifier did not return a result in the expected format' });
      const { issues, dropped } = toIssues(verdict, report);
      end({ ran: true, costUsd, checked: Number(verdict.checked) || 0, issues: issues.slice(0, MAX_ISSUES), dropped });
    });
    proc.stdin.on('error', () => {});
    proc.stdin.end(`REPORT TYPE: ${kind}\n\nTASK GIVEN TO THE AGENT:\n${String(task || '').slice(0, 6000)}\n\nREPORT TO CHECK:\n${report}\n\nWorking folder with the agent's input files: ${workDir || '(none)'}\nCheck the report now and return the JSON object.`);
  });
}

/** Tekst tury korekty dla problemów zgłoszonych przez weryfikatora. */
const correctionText = (issues) => 'Zasady korekty (weryfikator): '
  + 'każde odwołanie (ticket, komentarz, strona Confluence, plik wiedzy, plik:linia, endpoint) musi istnieć i mówić to, co raport; '
  + 'każdy oczekiwany wynik ma źródło, które potrafisz wskazać; nazwy i terminy bierz dosłownie z źródeł klienta, bez synonimów i własnych słów; '
  + 'zdania są krótkie, jedna informacja w jednym zdaniu; zamiast "chyba / powinno / prawdopodobnie" podaj fakt ze źródła albo przenieś to do pytań otwartych. '
  + 'Czego nie umiesz oprzeć na źródle, usuń albo przenieś do "Do sprawdzenia ręcznie". '
  + 'Nie dodawaj nowych treści poza poprawkami.';

module.exports = { correctionText, enabled, longSentences, parseVerdict, toIssues, verifyReport };
