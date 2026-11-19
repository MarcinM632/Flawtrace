// A tiny tar.gz writer (ustar) so a customer can download all of their workspace data without any dependency.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const pad = (n) => (512 - (n % 512)) % 512;
const octal = (n, len) => Buffer.from(n.toString(8).padStart(len - 1, '0') + '\0', 'ascii');

function header(name, size, mtime, type) {
  const b = Buffer.alloc(512);
  let prefix = '';
  if (Buffer.byteLength(name) > 100) {
    const i = name.lastIndexOf('/', 155);
    if (i < 1 || Buffer.byteLength(name.slice(i + 1)) > 100) return null;
    prefix = name.slice(0, i); name = name.slice(i + 1);
  }
  b.write(name, 0, 100); octal(type === '5' ? 0o755 : 0o644, 8).copy(b, 100); octal(0, 8).copy(b, 108); octal(0, 8).copy(b, 116);
  octal(size, 12).copy(b, 124); octal(Math.floor(mtime / 1000), 12).copy(b, 136); b.fill(0x20, 148, 156); b.write(type, 156);
  b.write('ustar\0', 257); b.write('00', 263); b.write(prefix, 345, 155);
  let sum = 0; for (let i = 0; i < 512; i++) sum += b[i];
  b.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return b;
}

/** Lists the files to pack: [{ abs, rel, size, mtime }] under `root`, skipping what `skip(rel)` says. */
function listFiles(root, skip) {
  const out = [];
  const walk = (d) => {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      const abs = path.join(d, e.name), rel = path.relative(root, abs).split(path.sep).join('/');
      if (e.isSymbolicLink() || skip(rel, e.isDirectory())) continue;
      if (e.isDirectory()) walk(abs); else if (e.isFile()) { try { const st = fs.statSync(abs); out.push({ abs, rel, size: st.size, mtime: st.mtimeMs }); } catch (_) { /* gone */ } }
    }
  };
  walk(root);
  return out;
}

/** Streams a gzip'd tar of the files into `out` (a writable). Resolves when finished. */
async function pack(files, out, prefix = '') {
  const gz = zlib.createGzip();
  gz.pipe(out);
  const write = (buf) => new Promise((res, rej) => { gz.write(buf, (e) => (e ? rej(e) : res())); });
  for (const f of files) {
    const name = prefix + f.rel;
    let data; try { data = fs.readFileSync(f.abs); } catch (_) { continue; }
    const h = header(name, data.length, f.mtime, '0');
    if (!h) continue;
    await write(h); await write(data); if (pad(data.length)) await write(Buffer.alloc(pad(data.length)));
  }
  await write(Buffer.alloc(1024));
  await new Promise((res) => { out.on('finish', res); gz.end(); });
}

module.exports = { listFiles, pack };
