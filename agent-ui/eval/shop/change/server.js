// Shop: a small web shop used as the test environment. No dependencies.
//   PORT=4400 node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const auth = require('./src/auth');
const catalogue = require('./src/catalogue');
const cart = require('./src/cart');
const orders = require('./src/orders');

const PORT = Number(process.env.PORT) || 4400;
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve(null); } });
  });
}

async function api(req, res, url) {
  const p = url.pathname;
  const out = (r) => send(res, r.status, r.body);
  let m;
  if (req.method === 'GET' && p === '/api/products') return out(catalogue.search(Object.fromEntries(url.searchParams)));
  if (req.method === 'GET' && (m = p.match(/^\/api\/products\/([^/]+)$/))) return out(catalogue.product(m[1]));
  if (req.method === 'POST' && (p === '/api/auth/register' || p === '/api/auth/login')) {
    const b = await readBody(req);
    if (b === null) return send(res, 400, { error: 'The body is not valid JSON' });
    return out(p.endsWith('register') ? auth.register(b) : auth.login(b));
  }
  const user = auth.userOf(req);
  if (p.startsWith('/api/cart') || p.startsWith('/api/orders')) {
    if (!user) return send(res, 401, { error: 'Sign in first' });
    const b = req.method === 'POST' ? await readBody(req) : {};
    if (b === null) return send(res, 400, { error: 'The body is not valid JSON' });
    if (req.method === 'GET' && p === '/api/cart') return send(res, 200, cart.view(user));
    if (req.method === 'POST' && p === '/api/cart/items') return out(cart.addItem(user, b));
    if (req.method === 'POST' && p === '/api/cart/discount') return out(cart.applyCode(user, b));
    if (req.method === 'DELETE' && (m = p.match(/^\/api\/cart\/items\/([^/]+)$/))) return out(cart.removeItem(user, m[1]));
    if (req.method === 'POST' && p === '/api/orders') return out(orders.place(user));
    if (req.method === 'GET' && (m = p.match(/^\/api\/orders\/([^/]+)$/))) return out(orders.get(user, m[1]));
  }
  return send(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname === '/openapi.json') return res.writeHead(200, { 'Content-Type': 'application/json' }), res.end(fs.readFileSync(path.join(__dirname, 'openapi.json')));
    const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^([/\\])+/, ''));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404), res.end('Not found');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  } catch (e) {
    send(res, 500, { error: 'Internal error' });
  }
});

if (require.main === module) server.listen(PORT, '127.0.0.1', () => console.log('Shop on http://127.0.0.1:' + PORT));
module.exports = { server };
