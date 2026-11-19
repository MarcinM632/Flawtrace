// What changes when Flawtrace runs as one customer's process behind the Flawtrace Cloud gateway (QA_HOSTED=1).
// The process is never reachable from outside: it listens on loopback and answers only requests that carry the
// gateway's secret (QA_GATEWAY_TOKEN). Anything that could run code or touch the host is switched off.
const crypto = require('crypto');

const HOSTED = process.env.QA_HOSTED === '1';

/** True when the request came through the gateway. Not hosted: always true (a local install has no gateway). */
function gatewayOk(req) {
  if (!HOSTED) return true;
  const want = process.env.QA_GATEWAY_TOKEN || '';
  const got = String(req.headers['x-flawtrace-gateway'] || '');
  if (!want || want.length < 24 || got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

// Paths that must not exist on a shared host: restarting the process, signing in a CLI tool, running customer code
// (pytest) on the server, the outside integration API (the gateway has its own), and the local-folder helpers.
const BLOCKED = [
  /^\/api\/admin(\/|$)/, /^\/api\/llm\/(login|detect)$/, /^\/api\/suite(\/|$)/, /^\/api\/autotests?(\/|$)/,
  /^\/api\/v1(\/|$)/, /^\/api\/integration(\/|$)/, /^\/api\/tools\/rescan$/,
];
const blocked = (method, p) => HOSTED && BLOCKED.some((re) => re.test(p));

/** Async check of every address a customer can type into the Sources settings. Returns an error text, or '' when fine. */
async function checkSources(patch) {
  if (!HOSTED || !patch) return '';
  const { assertPublicUrl } = require('./net-guard');
  const list = [];
  for (const k of ['jira', 'confluence']) if (patch[k] && patch[k].url) list.push([k, patch[k].url, ['https:']]);
  if (patch.api && patch.api.baseUrl) list.push(['The test API', patch.api.baseUrl, ['http:', 'https:']]);
  for (const s of (patch.api && patch.api.specs) || []) if (s && s.url) list.push(['A specification address', s.url, ['http:', 'https:']]);
  for (const r of patch.repos || []) if (r && r.url) list.push(['A repository address', r.url, ['https:']]);
  for (const [what, url, schemes] of list) {
    try { await assertPublicUrl(url, { schemes }); } catch (e) { return `${what}: ${e.message}`; }
  }
  return '';
}

module.exports = { HOSTED, blocked, checkSources, gatewayOk };
