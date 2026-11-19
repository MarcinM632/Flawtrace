// Outbound network guard for a HOSTED deployment (QA_HOSTED=1). A customer types addresses into Flawtrace (Jira,
// Confluence, the test API, repositories, a page for UI tests, an AI endpoint) and the server then calls them. Without
// a guard that is a way to reach things only the server can reach: the cloud metadata service, other customers'
// processes on loopback, the internal network. This module:
//   - refuses addresses that resolve to private, loopback, link-local, multicast or reserved ranges,
//   - follows redirects by hand and checks every hop (a public host cannot bounce a call to an internal one),
//   - drops credentials when a redirect leaves the original host.
// Not hosted: nothing is changed, so a local install can still test an API on localhost.
const dns = require('dns').promises;
const net = require('net');

const blocked = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) blocked.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32], ['100::', 64]]) blocked.addSubnet(a, p, 'ipv6');

const hosted = () => process.env.QA_HOSTED === '1';
const stripBrackets = (h) => String(h || '').replace(/^\[|\]$/g, '');

/** True when an IP address (v4 or v6) must not be reached from a hosted server. */
function isPrivateIp(ip) {
  const v = net.isIP(ip);
  if (!v) return true; // not an address: refuse
  if (v === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);              // ::ffff:10.0.0.1
    if (mapped) return isPrivateIp(mapped[1]);
    const nat64 = /^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);             // NAT64 with a dotted tail
    if (nat64) return isPrivateIp(nat64[1]);
    const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip); // ::ffff:a00:1
    if (hexMapped) { const n = (parseInt(hexMapped[1], 16) << 16) | parseInt(hexMapped[2], 16); return isPrivateIp([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')); }
  }
  return blocked.check(ip, v === 6 ? 'ipv6' : 'ipv4');
}

/** The app's own loopback calls (lib/integration.js) are the one allowed exception. */
const isSelf = (u) => (u.hostname === '127.0.0.1' || u.hostname === 'localhost') && String(u.port) === String(process.env.PORT || 4317);

/** Throws when the URL is not a public http(s) address. Resolves with the parsed URL. */
async function assertPublicUrl(raw, { schemes = ['http:', 'https:'] } = {}) {
  let u;
  try { u = new URL(String(raw)); } catch (_) { throw new Error('The address is not valid: ' + String(raw).slice(0, 80)); }
  // Tests only: lets a test talk to a fake provider on loopback. Never set in a deployment.
  if (process.env.QA_GUARD_ALLOW_LOOPBACK === '1' && ['127.0.0.1', 'localhost'].includes(u.hostname)) return u;
  if (!schemes.includes(u.protocol)) throw new Error(`Only ${schemes.map((s) => s.replace(':', '')).join(' or ')} addresses are allowed here.`);
  if (u.username || u.password) throw new Error('Use an address without a user name or password.');
  if (isSelf(u)) return u;
  const host = stripBrackets(u.hostname);
  if (!host) throw new Error('The address has no host name.');
  if (net.isIP(host)) { if (isPrivateIp(host)) throw new Error('This address is private or internal. Flawtrace Cloud can only reach public addresses.'); return u; }
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan)$/i.test(host)) throw new Error('This host name is internal. Flawtrace Cloud can only reach public addresses.');
  let addrs;
  try { addrs = await dns.lookup(host, { all: true }); } catch (_) { throw new Error('The host name could not be resolved: ' + host); }
  if (!addrs.length) throw new Error('The host name could not be resolved: ' + host);
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error('This host name points to a private or internal address. Flawtrace Cloud can only reach public addresses.');
  return u;
}

const SENSITIVE = /^(authorization|cookie|proxy-authorization|private-token|x-api-key|x-goog-api-key)$/i;

/** Wraps fetch: every request and every redirect hop is checked. Installed once, only when hosted. */
function install() {
  if (!hosted() || globalThis.fetch.__guarded) return;
  const orig = globalThis.fetch;
  const guarded = async (input, init = {}) => {
    const isStr = typeof input === 'string' || input instanceof URL;
    if (!isStr) { await assertPublicUrl(input.url); return orig(input, { ...init, redirect: 'error' }); }
    if (init.redirect === 'manual' || init.redirect === 'error') { await assertPublicUrl(String(input)); return orig(input, init); }
    let url = String(input), method = String(init.method || 'GET').toUpperCase(), body = init.body, headers = { ...(init.headers || {}) };
    const origin0 = new URL(url).origin;
    for (let hop = 0; hop <= 5; hop++) {
      await assertPublicUrl(url);
      const res = await orig(url, { ...init, method, body, headers, redirect: 'manual' });
      const loc = res.headers.get('location');
      if (![301, 302, 303, 307, 308].includes(res.status) || !loc) return res;
      try { await res.body.cancel(); } catch (_) { /* nothing to cancel */ }
      url = new URL(loc, url).href;
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) { method = 'GET'; body = undefined; }
      if (new URL(url).origin !== origin0) headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !SENSITIVE.test(k)));
    }
    throw new Error('Too many redirects.');
  };
  guarded.__guarded = true;
  globalThis.fetch = guarded;
}

module.exports = { assertPublicUrl, hosted, install, isPrivateIp };
