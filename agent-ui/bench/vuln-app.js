// Celowo podatna aplikacja testowa dla benchmarku silnika pentestowego. Serwer HTML renderowany po stronie serwera
// (z linkami i formularzami), żeby crawler Recon zobaczył powierzchnię tak jak w produkcji — benchmark mierzy więc
// też jakość crawlera, nie tylko detektorów. Każda klasa podatności ma wariant PODATNY i BEZPIECZNY, żeby liczyć
// zarazem wykrywalność (recall) i fałszywe alarmy (precyzję). GROUND_TRUTH niżej to lista tego, co faktycznie podatne.
//
// To NIE jest wzorzec bezpiecznego kodu — służy wyłącznie do testów i nie zawiera prawdziwych danych.
const http = require('http');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PASSWD = 'root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin\n';
const CMD_OK = String(7919 * 104729); // 829348951 — wynik „obliczenia w powłoce” dla command injection
const BOB_SECRET = 'bob-order-secret-7h3x';
const comments = []; // stored XSS
const uploads = new Map();
const parseCookies = (h) => Object.fromEntries(String(h || '').split(/;\s*/).filter(Boolean).map((p) => [p.split('=')[0], p.split('=').slice(1).join('=')]));

function page(title, bodyHtml, headers = {}) {
  const h = { 'content-type': 'text/html; charset=utf-8', ...headers };
  return { status: 200, headers: h, body: `<!doctype html><html><head><title>${title}</title></head><body>${bodyHtml}</body></html>` };
}
const json = (o, status = 200, headers = {}) => ({ status, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(o) });

// Strona główna: linki i formularze, z których Recon odkryje parametry obu wariantów (podatny i bezpieczny).
const HOME = `
<h1>Vuln Bench</h1>
<ul>
 <li><a href="/search?q=hello">search (vuln reflected xss)</a></li>
 <li><a href="/safe-search?q=hello">safe search</a></li>
 <li><a href="/product?id=1">product (vuln sqli error)</a></li>
 <li><a href="/item?id=1">item (vuln sqli boolean)</a></li>
 <li><a href="/safe-product?id=1">safe product</a></li>
 <li><a href="/download?file=readme.txt">download (vuln traversal)</a></li>
 <li><a href="/safe-download?file=readme.txt">safe download</a></li>
 <li><a href="/ping?host=127.0.0.1">ping (vuln cmd injection)</a></li>
 <li><a href="/safe-ping?host=127.0.0.1">safe ping</a></li>
 <li><a href="/go?url=/home">redirect (vuln open redirect)</a></li>
 <li><a href="/safe-go?url=/home">safe redirect</a></li>
 <li><a href="/fetch?url=http://example.com/avatar.png">fetch (vuln ssrf)</a></li>
 <li><a href="/comments">comments (stored xss sink)</a></li>
 <li><a href="/dom#hello">dom (vuln dom xss)</a></li>
</ul>
<script>fetch('/api/data').then(r=>r.json())</script>
<form method="POST" action="/comment"><input name="author" value="a"><input name="text" value="hi"><button>post</button></form>
<form method="POST" action="/upload" enctype="multipart/form-data"><input type="file" name="file"><button>up</button></form>
<form method="POST" action="/login"><input name="email"><input name="password" type="password"><button>login</button></form>`;

function handle(req, body) {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  const q = (k) => u.searchParams.get(k) || '';
  const method = req.method;

  if (p === '/' || p === '/home') return page('Home', HOME); // brak nagłówków bezpieczeństwa → config findings (prawda)

  // --- Reflected XSS ---
  if (p === '/search') return page('Search', `<p>Results for ${q('q')}</p>`); // bez kodowania → XSS
  if (p === '/safe-search') return page('Search', `<p>Results for ${esc(q('q'))}</p>`);

  // --- SQLi error-based ---
  if (p === '/product') { if (/['"]/.test(q('id'))) return { status: 500, headers: { 'content-type': 'text/html' }, body: 'Database error: You have an error in your SQL syntax near \'\'\' at line 1' }; return page('Product', `<p>Product ${esc(q('id'))}</p>`); }
  if (p === '/safe-product') return page('Product', `<p>Product ${esc(q('id').replace(/\D/g, ''))}</p>`);
  // --- SQLi boolean (bez błędu; prawda/fałsz różnią treścią) ---
  if (p === '/item') { const id = q('id'); const truthy = !/1\s*=\s*2|' and '1'='2/i.test(id) || /1\s*=\s*1/i.test(id); return page('Item', truthy ? '<p>Item found: Widget Pro, price 9.99, in stock, blue</p>' : '<p>No item</p>'); }

  // --- Path traversal ---
  if (p === '/download') { const f = q('file'); if (/\.\.(\/|\\)|etc\/passwd/.test(f) || f.startsWith('/')) return { status: 200, headers: { 'content-type': 'text/plain' }, body: PASSWD }; return { status: 200, headers: { 'content-type': 'text/plain' }, body: 'readme contents' }; }
  if (p === '/safe-download') { const f = q('file').replace(/[^\w.]/g, ''); return { status: 200, headers: { 'content-type': 'text/plain' }, body: f === 'readme.txt' ? 'readme contents' : 'not found' }; }

  // --- OS command injection (reflected) ---
  if (p === '/ping') { const h = q('host'); const m = /expr (\d+) '\*' (\d+)/.exec(h); const out = m ? '\n' + (Number(m[1]) * Number(m[2])) : ''; return { status: 200, headers: { 'content-type': 'text/plain' }, body: `PING ${esc(h.replace(/[;|&$`].*/s, ''))}${out}` }; }
  if (p === '/safe-ping') { const h = q('host').replace(/[^\w.]/g, ''); return { status: 200, headers: { 'content-type': 'text/plain' }, body: `PING ${h}` }; }

  // --- Open redirect ---
  if (p === '/go') return { status: 302, headers: { location: (q('url') || '/').replace(/[\r\n\x00-\x1f]/g, '') }, body: '' };
  if (p === '/safe-go') { const d = q('url'); return { status: 302, headers: { location: /^\//.test(d) && !/^\/\//.test(d) ? d : '/' }, body: '' }; }

  // --- SSRF (serwer pobiera podany URL) ---
  if (p === '/fetch') { const target = q('url'); if (/^https?:\/\//.test(target)) { globalThis.fetch(target).catch(() => {}); return page('Fetch', `<p>Fetched ${esc(target)}</p>`); } return page('Fetch', '<p>bad url</p>'); }

  // --- Stored XSS ---
  if (p === '/comment' && method === 'POST') { const f = Object.fromEntries(new URLSearchParams(body)); comments.push(f.text || ''); return page('Thanks', '<p>Saved</p>'); }
  if (p === '/comments') return page('Comments', '<ul>' + comments.map((c) => `<li>${c}</li>`).join('') + '</ul>'); // bez kodowania

  // --- DOM XSS ---
  if (p === '/dom') return page('Dom', '<div id="o"></div><script>document.getElementById("o").innerHTML=decodeURIComponent(location.hash.slice(1))</script>');

  // --- File upload (serwuje przesłany plik z domeny aplikacji jako jego typ) ---
  if (p === '/upload' && method === 'POST') { const m = /filename="([^"]+)"[\s\S]*?\r\n\r\n([\s\S]*?)\r\n--/m.exec(body || ''); if (m) { uploads.set(m[1], m[2]); return page('Up', `<p>Saved <a href="/uploads/${esc(m[1])}">${esc(m[1])}</a></p>`); } return page('Up', '<p>no file</p>'); }
  if (p.startsWith('/uploads/')) { const name = decodeURIComponent(p.slice('/uploads/'.length)); if (!uploads.has(name)) return { status: 404, headers: { 'content-type': 'text/plain' }, body: 'nf' }; const ct = name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.html') ? 'text/html' : 'text/plain'; return { status: 200, headers: { 'content-type': ct }, body: uploads.get(name) }; }

  // --- CORS (odbija Origin z poświadczeniami) ---
  if (p === '/api/data') { const o = req.headers.origin; const h = o ? { 'access-control-allow-origin': o, 'access-control-allow-credentials': 'true' } : {}; return json({ items: [1, 2, 3] }, 200, h); }

  // --- BOLA/IDOR: zamówienie innego użytkownika bez kontroli właściciela ---
  if (/^\/api\/orders\/\d+$/.test(p)) { const id = p.split('/').pop(); return json({ id: Number(id), secret: id === '2' ? BOB_SECRET : 'order-' + id }); }

  // --- API broken auth: /api/secret wg specyfikacji wymaga tokenu, a zwraca dane bez niego ---
  if (p === '/api/secret') return json({ apiKeys: ['sk-live-xxx'], note: 'should require auth' });

  // --- GraphQL z introspekcją ---
  if (p === '/graphql') {
    const b = method === 'POST' ? (() => { try { return JSON.parse(body); } catch (_) { return {}; } })() : { query: q('query') };
    const one = (x) => { const query = (x && x.query) || ''; if (query.includes('__schema')) return { data: { __schema: { queryType: { name: 'Query' }, types: [{ name: 'Query', kind: 'OBJECT', fields: [{ name: 'me', type: { kind: 'OBJECT', name: 'User' } }] }, { name: 'User', kind: 'OBJECT', fields: [{ name: 'name', type: { kind: 'SCALAR', name: 'String' } }] }, { name: 'String', kind: 'SCALAR' }] } } }; const m = /\{(\w+):__typename\}/.exec(query); if (m) return { data: { [m[1]]: 'Query' } }; return { data: { __typename: 'Query' } }; };
    return json(Array.isArray(b) ? b.map(one) : one(b));
  }

  // --- Login: brak blokady prób + wyliczanie użytkowników (inny komunikat dla istniejącego konta) ---
  if (p === '/login' && method === 'POST') {
    const f = (/json/.test(req.headers['content-type'] || '') || String(body).trimStart().startsWith('{')) ? (() => { try { return JSON.parse(body); } catch (_) { return {}; } })() : Object.fromEntries(new URLSearchParams(body));
    if (f.email === 'alice@bench.test' && f.password === 'Sekret-123') return json({ token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhbGljZSJ9.sig', user: 'alice' });
    const exists = f.email === 'alice@bench.test';
    return json({ error: exists ? 'Invalid password for this account' : 'No account with that email' }, 401);
  }
  if (p === '/login') return page('Login', '<form method="POST" action="/login"><input name="email"><input name="password" type="password"></form>');

  return { status: 404, headers: { 'content-type': 'text/plain' }, body: 'Not found' };
}

function createApp() {
  return http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let out;
      try { out = handle(req, body); } catch (e) { out = { status: 500, headers: { 'content-type': 'text/plain' }, body: 'err: ' + e.message }; }
      try { res.writeHead(out.status, out.headers); } catch (_) { res.writeHead(500, { 'content-type': 'text/plain' }); }
      res.end(out.body);
    });
  });
}

// OpenAPI dla testów API (broken-auth na /api/secret; excessive data na /api/orders).
const OPENAPI = {
  openapi: '3.0.0', servers: [{ url: '{base}' }],
  components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
  paths: {
    '/api/secret': { get: { security: [{ bearer: [] }], responses: { 200: { content: { 'application/json': { schema: { type: 'object', properties: { note: { type: 'string' } } } } } } } } },
    '/api/orders/{id}': { get: { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'integer' } } } } } } } } },
  },
};

// Prawda: każda pozycja = jedna oczekiwana podatność. cat → prefiks itemId findingu; path/param do dopasowania.
// browser/oob/upload oznaczone, bo zależą od przeglądarki / serwera zwrotnego (można je w benchmarku wyłączyć).
const GROUND_TRUTH = [
  { cat: 'WSTG-INPV:xss-reflected', path: '/search', param: 'q', name: 'Reflected XSS' },
  { cat: 'WSTG-INPV:sqli', path: '/product', param: 'id', name: 'SQLi error-based' },
  { cat: 'WSTG-INPV:sqli', path: '/item', param: 'id', name: 'SQLi boolean' },
  { cat: 'WSTG-ATHZ:path-traversal', path: '/download', param: 'file', name: 'Path traversal' },
  { cat: 'WSTG-INPV:cmd-injection', path: '/ping', param: 'host', name: 'OS command injection' },
  { cat: 'WSTG-INPV:open-redirect', path: '/go', param: 'url', name: 'Open redirect' },
  { cat: 'WSTG-INPV:xss-stored', path: '/comments', param: 'text', name: 'Stored XSS' },
  { cat: 'WSTG-CLNT:cors', path: '/api/data', param: null, name: 'CORS reflects origin + credentials' },
  { cat: 'WSTG-CONF:sec-headers', path: '/', param: null, name: 'Missing security headers' },
  { cat: 'WSTG-CLNT:clickjacking', path: '/', param: null, name: 'Clickjacking' },
  { cat: 'WSTG-APIT:broken-auth', path: '/api/secret', param: null, name: 'API returns data without auth' },
  { cat: 'WSTG-APIT:graphql', path: '/graphql', param: null, name: 'GraphQL introspection' },
  { cat: 'WSTG-ATHN:lockout', path: '/login', param: null, name: 'No login lockout' },
  { cat: 'WSTG-IDNT:user-enum', path: '/login', param: null, name: 'Username enumeration' },
  { cat: ['WSTG-ATHZ:idor-bola', 'WSTG-ATHZ:forced-browsing'], path: '/api/orders/2', param: null, name: 'BOLA / IDOR' },
  { cat: 'WSTG-INPV:ssrf', path: '/fetch', param: 'url', name: 'SSRF', needs: 'oob' },
  { cat: 'WSTG-CLNT:dom-xss', path: '/dom', param: null, name: 'DOM XSS', needs: 'browser' },
  { cat: 'WSTG-BUSL:file-upload', path: '/uploads', param: null, name: 'Unsafe file upload', needs: 'upload' },
];

module.exports = { createApp, handle, GROUND_TRUTH, OPENAPI, BOB_SECRET };
