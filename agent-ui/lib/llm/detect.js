// Which AI tools are installed on this machine and whether the user is signed in to them, so the first-run wizard can
// say "found / signed in" before the user chooses, and start the tool's own browser sign-in with one click.
// Only fixed commands are run (`<tool> --version`, the tool's status command, the tool's login command); nothing the
// user types reaches a shell. A shell is needed on Windows, where npm tools are .cmd files.
// Nothing about the account (e-mail, plan) is returned: only a yes/no.
const { exec, spawn } = require('child_process');

const TOOLS = { claude: 'claude', codex: 'codex', gemini: 'gemini', npx: 'npx' };
// Signed in? Each tool's own status command; exit code 0 and, for Claude, loggedIn:true in its JSON.
const STATUS = {
  claude: (code, out) => { try { return !!JSON.parse(out).loggedIn; } catch (_) { return code === 0; } },
  codex: (code) => code === 0,
};
const STATUS_CMD = { claude: 'claude auth status', codex: 'codex login status' };
const LOGIN = { claude: ['claude', ['auth', 'login']], codex: ['codex', ['login']] };

function run(cmd, timeout = 8000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout, windowsHide: true }, (err, stdout) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: String(stdout || '') }));
  });
}

async function probe(id) {
  const v = await run(TOOLS[id] + ' --version', 6000);
  if (v.code !== 0) return { found: false };
  const r = { found: true, version: v.out.trim().split(/\r?\n/)[0].slice(0, 80) };
  if (STATUS_CMD[id]) { const s = await run(STATUS_CMD[id]); r.loggedIn = STATUS[id](s.code, s.out); }
  return r;
}

async function detect() {
  const out = {};
  await Promise.all(Object.keys(TOOLS).map(async (id) => { out[id] = await probe(id); }));
  out.login = loginState();
  return out;
}

// One browser sign-in at a time. The tool opens the browser itself; if it also prints the address we pass it on, for a
// machine where no browser opens. Killed after 5 minutes so an abandoned sign-in does not linger.
const logins = {};
const URL_RE = /https?:\/\/[^\s"'<>]+/;
function loginState() {
  const o = {};
  for (const [id, l] of Object.entries(logins)) o[id] = { running: l.running, url: l.url || '' };
  return o;
}
function startLogin(id) {
  if (!LOGIN[id]) throw Object.assign(new Error('Unknown tool'), { code: 400 });
  if (logins[id] && logins[id].running) return loginState()[id];
  const [cmd, args] = LOGIN[id];
  const l = logins[id] = { running: true, url: '' };
  const child = spawn(cmd, args, { shell: process.platform === 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const take = (b) => { const m = URL_RE.exec(String(b)); if (m && !l.url) l.url = m[0]; };
  child.stdout.on('data', take); child.stderr.on('data', take);
  const done = () => { l.running = false; clearTimeout(timer); };
  const timer = setTimeout(() => { try { child.kill(); } catch (_) { /* gone */ } done(); }, 300000);
  child.on('error', done); child.on('close', done);
  return { running: true, url: '' };
}

module.exports = { detect, startLogin };
