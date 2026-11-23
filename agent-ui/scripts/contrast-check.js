#!/usr/bin/env node
// Kontrola kontrastu WCAG 2.2 dla par tokenów, które interfejs faktycznie łączy (pierwszy plan / tło), w obu motywach.
// Tekst >= 4.5:1 (SC 1.4.3), obramowania kontrolek / fokus / wskaźniki zaznaczenia / grafika >= 3:1 (SC 1.4.11).
// Uruchom: node scripts/contrast-check.js [--md]   Kod wyjścia 1, gdy którakolwiek para nie spełnia progu.
const fs = require('fs');
const path = require('path');
const { contrast } = require('./color-lib');

function parseTheme(css, selector) {
  const i = css.indexOf(selector + '{');
  if (i < 0) throw new Error('Brak bloku ' + selector);
  const body = css.slice(i + selector.length + 1, css.indexOf('\n}', i));
  const vars = {};
  for (const m of body.matchAll(/--([\w-]+):([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}
function resolver(...layers) {
  const get = (name, depth = 0) => {
    if (depth > 20) throw new Error('Cykl: ' + name);
    let v; for (const l of layers) if (l[name] !== undefined) { v = l[name]; break; }
    if (v === undefined) throw new Error('Brak tokenu --' + name);
    const m = /^var\(--([\w-]+)\)$/.exec(v);
    return m ? get(m[1], depth + 1) : v;
  };
  return get;
}

const TEXT_BGS = ['bg-app', 'bg-surface', 'bg-subtle', 'bg-component', 'bg-hover', 'bg-active', 'bg-field', 'accent-bg'];
const SURFACES = ['bg-app', 'bg-surface', 'bg-subtle', 'bg-component', 'bg-field'];
// cyan: jasna kategoria z ciemnym tekstem; jej granicę wyznacza obrys --cat-cyan-border (sprawdzany niżej)
const CATS = ['blue', 'teal', 'purple', 'green', 'crimson', 'orange', 'indigo', 'magenta', 'wine'];
function pairs() {
  const P = [];
  const add = (fg, bg, min, kind) => P.push({ fg, bg, min, kind });
  for (const t of ['text-primary', 'text-secondary', 'text-tertiary']) for (const b of TEXT_BGS) add(t, b, 4.5, 'text');
  for (const b of ['bg-surface', 'bg-app', 'bg-subtle', 'bg-component', 'accent-bg', 'accent-bg-strong']) add('accent-text', b, 4.5, 'text');
  add('text-on-accent', 'accent', 4.5, 'text'); add('text-on-accent', 'accent-hover', 4.5, 'text');
  add('text-on-inverse', 'bg-inverse', 4.5, 'text');
  for (const s of ['success', 'warning', 'danger', 'info']) {
    for (const b of [s + '-bg', 'bg-surface', 'bg-app', 'bg-subtle']) add(s, b, 4.5, 'text');
    if (s !== 'info') add('text-on-status', s, 4.5, 'text');
  }
  for (const c of CATS) { add('text-on-cat', 'cat-' + c, 4.5, 'text'); add('cat-' + c, 'bg-surface', 3, 'graphic'); add('cat-' + c, 'bg-app', 3, 'graphic'); }
  for (const m of ['get', 'post', 'put', 'del']) add('m-' + m, 'bg-surface', 3, 'graphic');
  add('cat-whitebox-text', 'cat-whitebox', 4.5, 'text'); add('cat-blackbox-text', 'cat-blackbox', 4.5, 'text'); add('cat-greybox-text', 'cat-greybox', 4.5, 'text');
  add('cat-root-text', 'cat-root', 4.5, 'text');
  add('cat-cyan-text', 'cat-cyan', 4.5, 'text'); add('cat-cyan-border', 'bg-surface', 3, 'graphic');
  add('text-on-rail', 'bg-rail', 4.5, 'text'); add('text-on-rail-on', 'bg-rail-on', 4.5, 'text');
  for (const b of SURFACES) { add('border-interactive', b, 3, 'ui'); add('focus-ring', b, 3, 'ui'); add('accent', b, 3, 'ui'); }
  for (const s of ['success', 'warning', 'danger']) for (const b of SURFACES) add(s, b, 3, 'ui');
  return P;
}

function check(file = path.join(__dirname, '..', 'public', 'tokens.css')) {
  const css = fs.readFileSync(file, 'utf8');
  const light = parseTheme(css, ':root');
  const dark = parseTheme(css, ':root[data-theme="dark"]');
  const rows = [];
  for (const [theme, get] of [['light', resolver(light)], ['dark', resolver(dark, light)]]) {
    for (const p of pairs()) {
      const fg = get(p.fg), bg = get(p.bg);
      if (!/^#[0-9a-f]{6}$/i.test(fg) || !/^#[0-9a-f]{6}$/i.test(bg)) throw new Error(`Para ${p.fg}/${p.bg} nie rozwija się do koloru (${fg} / ${bg})`);
      const r = contrast(fg, bg);
      rows.push({ theme, ...p, fgHex: fg, bgHex: bg, ratio: Math.round(r * 100) / 100, pass: r >= p.min });
    }
  }
  return rows;
}

if (require.main === module) {
  const rows = check();
  const md = process.argv.includes('--md');
  if (md) {
    console.log('| motyw | pierwszy plan | tło | rodzaj | próg | kontrast | wynik |\n|---|---|---|---|---|---|---|');
    for (const r of rows) console.log(`| ${r.theme} | ${r.fg} ${r.fgHex} | ${r.bg} ${r.bgHex} | ${r.kind} | ${r.min}:1 | ${r.ratio.toFixed(2)}:1 | ${r.pass ? 'OK' : 'FAIL'} |`);
  }
  const bad = rows.filter((r) => !r.pass);
  for (const r of bad) console.log(`FAIL ${r.theme}: --${r.fg} ${r.fgHex} on --${r.bg} ${r.bgHex} = ${r.ratio}:1 (need ${r.min}:1)`);
  const min = (t, k) => Math.min(...rows.filter((r) => r.theme === t && r.kind === k).map((r) => r.ratio));
  console.log(`${rows.length} par; ${bad.length} błędów. Minimum — light: tekst ${min('light', 'text')}, UI ${min('light', 'ui')}; dark: tekst ${min('dark', 'text')}, UI ${min('dark', 'ui')}.`);
  process.exit(bad.length ? 1 : 0);
}
module.exports = { check, pairs };
