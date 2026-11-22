// Lokalne, deterministyczne narzędzia zewnętrznego serwera MCP (mcp/flawtrace-server.js). Wzorem frameworka e2e,
// gdzie `npx e2e mcp` daje agentowi kodującemu (Claude Code, Cursor) żywe możliwości testowe BEZ modelu, te
// narzędzia dają cudzemu agentowi w IDE supermoce Flawtrace, które liczy sama aplikacja — skan repo (SAST/SCA/
// sekrety), skan transportu/HTTP celu, selekcję testów po zmianie i generację configu CI. Działają w procesie
// serwera MCP (nie wymagają uruchomionej aplikacji ani klucza AI); narzędzia startujące przebiegi w aplikacji są
// osobne (proxy do /api/v1 w flawtrace-server.js). Każde narzędzie: { name, description, inputSchema, handler }.
const path = require('path');
const repoScan = require('./repo-scan');
const transportScan = require('./transport-scan');
const testImpact = require('./test-impact');
const ciExport = require('./ci-export');

const str = (description, extra = {}) => ({ type: 'string', description, ...extra });

// --- Formatowanie wyników jako czytelny tekst dla agenta (serve() owinie go w content text). ---
function fmtFindings(findings, max = 40) {
  const top = (findings || []).slice(0, max).map((f) => {
    const where = f.file ? `${f.file}${f.line ? ':' + f.line : ''}` : (f.url || '');
    return `- [${f.severity}] ${f.scanner || 'finding'} ${f.rule}${f.cwe ? ` (${f.cwe})` : ''} — ${where || f.title || ''}`.trim();
  });
  return top.join('\n') + (findings && findings.length > max ? `\n… (+${findings.length - max} more)` : '');
}

const TOOLS = [
  {
    name: 'scan_repo',
    description: 'Static security scan of a local repository folder: secrets, dangerous code patterns (SAST) and vulnerable dependencies (SCA). Reads files only, runs nothing. No model needed.',
    inputSchema: { type: 'object', properties: { path: str('Folder to scan. Default: the current working directory.') } },
    handler: ({ path: dir } = {}) => {
      const target = path.resolve(String(dir || '.'));
      const res = repoScan.scan([{ name: path.basename(target) || 'repo', path: target.split(path.sep).join('/'), ready: true }]);
      if (!res.available) return `Nothing scanned: ${res.reason}.`;
      return repoScan.summary(res) + (res.findings.length ? '\n\n' + fmtFindings(res.findings) : '') + (res.limited ? '\n\n(Scan hit a size/file limit — not exhaustive.)' : '');
    },
  },
  {
    name: 'scan_transport',
    description: 'Transport/HTTP security of a URL: security headers (HSTS, CSP, X-Content-Type-Options, X-Frame-Options), cookie flags (Secure/HttpOnly/SameSite), cleartext vs TLS, CORS reflection, version disclosure. A few safe GETs. No model needed.',
    inputSchema: { type: 'object', required: ['url'], properties: { url: str('Base URL of the target to check, e.g. https://api.example.com.') } },
    handler: async ({ url } = {}) => {
      const res = await transportScan.scan({ baseUrl: url }, { hosted: false });
      if (!res.available) return `Not run: ${res.reason}.`;
      return transportScan.summary(res) + (res.findings.length ? '\n\n' + fmtFindings(res.findings) : '');
    },
  },
  {
    name: 'select_tests',
    description: 'Test impact selection: given the changed files of a change set and the tests with what they touch, return only the tests that change can affect (unmapped or broad changes run all). No model needed.',
    inputSchema: {
      type: 'object',
      properties: {
        changed: { type: 'array', items: { type: 'string' }, description: 'Changed file paths. Or pass "diff".' },
        diff: str('Output of `git diff --name-only` / `--name-status`, or a full diff. Used if "changed" is absent.'),
        tests: { type: 'array', description: 'Tests to filter: [{id, file?, touches?:string[], areas?:string[], always?:bool}].', items: { type: 'object' } },
      },
    },
    handler: ({ changed, diff, tests } = {}) => {
      const changedPaths = Array.isArray(changed) && changed.length ? changed : testImpact.changedFromDiff(diff || '');
      const sel = testImpact.select(changedPaths, Array.isArray(tests) ? tests : []);
      const run = sel.run.map((r) => `- ${r.id}${r.reason ? ` (${r.reason})` : ''}`).join('\n');
      return testImpact.summary(sel) + (sel.run.length ? `\n\nRun:\n${run}` : '') + (sel.skip.length ? `\n\nSkip: ${sel.skip.map((s) => s.id).join(', ')}` : '');
    },
  },
  {
    name: 'ci_config',
    description: 'Generate a ready-to-commit CI pipeline (GitHub Actions or GitLab CI) that installs deps and browsers and runs the generated tests against BASE_URL. No model needed.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: str('"github" (default) or "gitlab".'),
        stack: str('Test stack: "ts-playwright" (default), "python" or "cypress".'),
      },
    },
    handler: ({ provider, stack } = {}) => {
      const out = ciExport.forProvider(/gitlab/i.test(provider || '') ? 'gitlab' : 'github', stack || 'ts-playwright');
      return `# ${out.path}\n${out.content}`;
    },
  },
];

module.exports = { TOOLS };
