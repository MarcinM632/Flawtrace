// Which AI tools are installed on this machine, so the first-run wizard can say "found" or "not found" before the user
// chooses. Only runs `<tool> --version` (nothing is started, nothing is sent anywhere). A shell is needed on Windows,
// where npm tools are .cmd files; the command names are fixed constants, never user input.
const { exec } = require('child_process');

const TOOLS = { claude: 'claude', codex: 'codex', gemini: 'gemini', npx: 'npx' };

function probe(cmd) {
  return new Promise((resolve) => {
    exec(cmd + ' --version', { timeout: 6000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve({ found: false });
      resolve({ found: true, version: String(stdout || '').trim().split(/\r?\n/)[0].slice(0, 80) });
    });
  });
}

async function detect() {
  const out = {};
  await Promise.all(Object.entries(TOOLS).map(async ([id, cmd]) => { out[id] = await probe(cmd); }));
  return out;
}

module.exports = { detect };
