// Pomocnicze funkcje HTTP: odpowiedzi JSON z ETag, odczyt ciała żądania i pliki statyczne z public/.
const path = require('path');
const fs = require('fs');
const { APP_DIR } = require('./config');

function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }
// Lista runów jest odpytywana co kilka sekund; ETag zamienia niezmienioną odpowiedź (setki KB) na 304.
function jsonEtag(req, res, obj) {
  const text = JSON.stringify(obj);
  const etag = '"' + require('crypto').createHash('sha1').update(text).digest('base64') + '"';
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' }); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ETag: etag, 'Cache-Control': 'no-cache' });
  res.end(text);
}

/**
 * Ciało JSON żądania; ponad max bajtów treść jest odrzucana (domyślnie 100 KB, słowniki FIX i pliki danych
 * potrzebują więcej). Wcześniej przekroczenie limitu wołało req.destroy() — to w Node zrywa cały socket, więc
 * odpowiedź z błędem (np. 413) nigdy nie docierała do klienta, który widział gołe "Failed to fetch" zamiast
 * komunikatu. Teraz dane są tylko odrzucane (bez destroy), a wywołujący dostaje { __tooLarge: true } i może
 * odpowiedzieć normalnie.
 */
function body(req, max = 1e5) {
  return new Promise((ok) => {
    let s = '', done = false, tooLarge = false;
    const fin = (v) => { if (!done) { done = true; ok(v); } };
    req.setEncoding('utf8');
    req.on('data', (c) => {
      if (tooLarge) return;
      s += c;
      if (s.length > max) { tooLarge = true; s = ''; }
    });
    req.on('end', () => { if (tooLarge) return fin({ __tooLarge: true }); try { fin(JSON.parse(s || '{}')); } catch { fin({}); } });
    req.on('error', () => fin({}));
    req.on('close', () => fin({}));
  });
}

const PUBLIC_DIR = path.join(APP_DIR, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png' };
/** Plik z public/: ETag z rozmiaru i czasu modyfikacji, więc przeglądarka dostaje 304 zamiast ponownego pobrania. */
function serveStatic(req, res, urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath).replace(/^\/+/, ''); } catch (_) { return false; }
  const file = path.resolve(PUBLIC_DIR, rel);
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) return false; // ochrona przed ../
  const type = MIME[path.extname(file).toLowerCase()];
  if (!type) return false;
  let st; try { st = fs.statSync(file); } catch (_) { return false; }
  if (!st.isFile()) return false;
  const etag = '"' + st.size.toString(36) + '-' + Math.round(st.mtimeMs).toString(36) + '"';
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' }); res.end(); return true; }
  res.writeHead(200, { 'Content-Type': type, ETag: etag, 'Cache-Control': 'no-cache' });
  res.end(fs.readFileSync(file));
  return true;
}

module.exports = {
  body,
  json,
  jsonEtag,
  serveStatic,
};
