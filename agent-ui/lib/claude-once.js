// Jedno wywołanie `claude -p` bez narzędzi (tekst wchodzi, tekst wychodzi) — żadnego MCP, żadnej
// pamięci sesji. Wydzielone z lib/pe.js do osobnego modułu bez żadnych innych zależności w repo,
// żeby lib/metrics.js (analiza ekonometryczna — AI tylko opisuje słowami już policzone liczby)
// mogło go użyć bez wciągania lib/pe.js → lib/run-agent.js → lib/metrics.js (cykl require).
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { MODEL, RUNS_DIR } = require('./config');

function claudeOnce(system, input, timeoutMs = 240000) {
  return new Promise((resolve, reject) => {
    const dir = path.join(RUNS_DIR, 'work', 'pe');
    fs.mkdirSync(dir, { recursive: true });
    const sysFile = path.join(dir, crypto.randomBytes(4).toString('hex') + '.system.txt');
    fs.writeFileSync(sysFile, system);
    const args = ['-p', '--model', MODEL, '--output-format', 'json', '--system-prompt-file', sysFile,
      '--tools', '', '--permission-mode', 'dontAsk', '--strict-mcp-config', '--no-session-persistence'];
    const proc = spawn('claude', args, { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '', err = '', done = false;
    const end = (fn, v) => { if (done) return; done = true; clearTimeout(timer); fs.rm(sysFile, { force: true }, () => {}); fn(v); };
    const timer = setTimeout(() => { proc.kill(); end(reject, new Error('Timed out after ' + timeoutMs / 1000 + ' s')); }, timeoutMs);
    proc.stdout.on('data', (c) => { out += c; });
    proc.stderr.on('data', (c) => { err += c; });
    proc.on('error', (e) => end(reject, new Error('Could not start claude: ' + e.message)));
    proc.on('close', (code) => {
      let j = null;
      try { j = JSON.parse(out.trim().split('\n').filter(Boolean).pop()); } catch (_) { /* nie JSON */ }
      if (j && !j.is_error && typeof j.result === 'string') return end(resolve, { text: j.result, costUsd: j.total_cost_usd ?? null });
      end(reject, new Error((j && j.result) || err.trim().slice(-600) || `claude exited with code ${code}`));
    });
    proc.stdin.on('error', () => {});
    proc.stdin.end(input);
  });
}

module.exports = { claudeOnce };
