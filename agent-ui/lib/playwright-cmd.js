// How to start the Playwright MCP server. On a developer machine: through npx (downloads on first use). In a container
// image the server and its browser are installed at build time: set QA_PLAYWRIGHT_MCP_BIN to its binary and it starts at
// once, with no download. QA_PLAYWRIGHT_NO_SANDBOX=1 adds --no-sandbox, which Chromium needs inside most containers
// (the container is then the security boundary; see docs/CLOUD.md).
const VERSION = '0.0.85';

/** extra: the arguments after the package name, e.g. ['--headless', '--isolated']. Returns { command, args }. */
function playwrightCommand(extra) {
  const args = [...extra, ...(process.env.QA_PLAYWRIGHT_NO_SANDBOX === '1' ? ['--no-sandbox'] : [])];
  if (process.env.QA_PLAYWRIGHT_MCP_BIN) return { command: process.env.QA_PLAYWRIGHT_MCP_BIN, args };
  const win = process.platform === 'win32';
  const npx = ['-y', '@playwright/mcp@' + VERSION, ...args];
  return { command: win ? 'cmd' : 'npx', args: win ? ['/c', 'npx', ...npx] : npx };
}

module.exports = { VERSION, playwrightCommand };
