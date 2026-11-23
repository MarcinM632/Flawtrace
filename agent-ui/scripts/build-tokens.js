#!/usr/bin/env node
// Generator tokenów kolorów: public/tokens.css. Uruchom: node scripts/build-tokens.js
// Skale 12-stopniowe (model Radix / palety tonalne Material 3) w OKLCH; stopnie z rolą kontrastową (obramowania
// interaktywne, pierścień fokusu, tła pełne pod tekst, tekst) nie są zgadywane — fitL szuka najbliższej wartości
// spełniającej WCAG 2.2 wobec teł, na których ten stopień faktycznie leży. Akcent wyprowadzony z koloru marki
// (motyw „light, airy blue”: #0e82bd jasny, #2f9fd8 ciemny). Narzędzie deweloperskie; nie trafia do aplikacji.
const fs = require('fs');
const path = require('path');
const { oklch, fitL } = require('./color-lib');

const BRAND_H = 240;          // odcień #0e82bd w OKLCH
const AA = 4.5, UI = 3;

// ---------------- jasny ----------------
function lightScales() {
  const N = {}, A = {};
  const nh = 240, nc = (i) => [0, 0.004, 0.008, 0.011, 0.013, 0.015, 0.018, 0.022, 0.025, 0.03, 0.036, 0.042, 0.046][i];
  // 0 = powierzchnia (biel), 1-2 tła aplikacji, 3-5 tła komponentów, 6-7 obramowania nieinteraktywne
  N[0] = '#ffffff';
  [[1, 0.990], [2, 0.977], [3, 0.959], [4, 0.942], [5, 0.922], [6, 0.902], [7, 0.86]].forEach(([i, L]) => { N[i] = oklch(L, nc(i), nh); });
  const surfaces = [N[0], N[1], N[2], N[3]];
  N[8] = fitL(0.70, nc(8), nh, surfaces, UI);             // obramowanie interaktywne (>= 3:1)
  N[9] = oklch(0.56, nc(9), nh);                           // neutralne tło pełne
  A[3] = oklch(0.955, 0.034, BRAND_H);
  const textBgs = [N[0], N[1], N[2], N[3], N[4], N[5], A[3]];
  N[10] = fitL(0.62, nc(10), nh, textBgs, AA);             // tekst trzeciorzędny
  N[11] = fitL(0.55, nc(11), nh, textBgs, 6.0);            // tekst drugorzędny
  N[12] = oklch(0.25, nc(12), nh);                          // tekst główny
  [[1, 0.99, 0.01], [2, 0.975, 0.02], [4, 0.93, 0.05], [5, 0.905, 0.065], [6, 0.87, 0.08], [7, 0.8, 0.11]].forEach(([i, L, C]) => { A[i] = oklch(L, C, BRAND_H); });
  A[8] = fitL(0.70, 0.13, BRAND_H, surfaces, UI);           // mocne obramowanie + pierścień fokusu (>= 3:1)
  A[9] = fitL(0.578, 0.128, BRAND_H, ['#ffffff'], 4.6);     // tło pełne akcentu pod białym tekstem
  A[10] = fitL(0.52, 0.12, BRAND_H, ['#ffffff'], 5.6);     // akcent pod kursorem (ciemniejszy)
  A[11] = fitL(0.55, 0.12, BRAND_H, [...textBgs, A[4]], AA); // tekst w kolorze akcentu
  A[12] = oklch(0.32, 0.08, BRAND_H);
  return { N, A, textBgs };
}
function lightStatus(h, C, N, textBgs) {
  const S = {};
  [[1, 0.99, C * 0.08], [2, 0.977, C * 0.15], [3, 0.955, C * 0.27], [4, 0.935, C * 0.38], [5, 0.91, C * 0.48], [6, 0.875, C * 0.58], [7, 0.82, C * 0.72], [8, 0.74, C * 0.85], [12, 0.3, C * 0.6]].forEach(([i, L, c]) => { S[i] = oklch(L, c, h); });
  S[9] = fitL(0.58, C, h, ['#ffffff'], 4.6);
  S[10] = fitL(0.52, C, h, ['#ffffff'], 5.6);
  S[11] = fitL(0.52, C, h, [...textBgs, S[3], S[4], '#ffffff'], AA); // tekst i ikona statusu (też tło pod białym tekstem)
  return S;
}

// ---------------- ciemny (nie odwrócenie: przyciemnione tła, rozjaśnione pierwsze plany) ----------------
function darkScales() {
  const N = {}, A = {};
  const nh = 250, nc = (i) => [0, 0.022, 0.024, 0.027, 0.029, 0.031, 0.033, 0.036, 0.034, 0.03, 0.028, 0.024, 0.014][i];
  [[1, 0.192], [2, 0.232], [3, 0.255], [4, 0.28], [5, 0.305], [6, 0.34], [7, 0.4]].forEach(([i, L]) => { N[i] = oklch(L, nc(i), nh); });
  const surfaces = [N[1], N[2], N[3], N[4]];
  N[8] = fitL(0.48, nc(8), nh, surfaces, UI, +1);
  N[9] = oklch(0.6, nc(9), nh);
  A[3] = oklch(0.31, 0.06, BRAND_H);
  const textBgs = [N[1], N[2], N[3], N[4], N[5], A[3]];
  N[10] = fitL(0.62, nc(10), nh, textBgs, AA, +1);
  N[11] = fitL(0.72, nc(11), nh, textBgs, 7.0, +1);
  N[12] = oklch(0.95, nc(12), nh);
  N[0] = N[1];
  [[1, 0.215, 0.03], [2, 0.24, 0.045], [4, 0.34, 0.07], [5, 0.37, 0.08], [6, 0.42, 0.09], [7, 0.5, 0.11]].forEach(([i, L, C]) => { A[i] = oklch(L, C, BRAND_H); });
  A[8] = fitL(0.56, 0.13, BRAND_H, surfaces, UI, +1);
  A[9] = fitL(0.667, 0.128, BRAND_H, [N[1]], 6.0, +1);     // #2f9fd8 z ciemnym tekstem na wierzchu
  A[10] = fitL(0.72, 0.12, BRAND_H, [N[1]], 7.0, +1);
  A[11] = fitL(0.76, 0.11, BRAND_H, [...textBgs, A[4]], AA, +1);
  A[12] = oklch(0.92, 0.05, BRAND_H);
  return { N, A, textBgs };
}
function darkStatus(h, C, N, textBgs) {
  const S = {};
  [[1, 0.2, C * 0.15], [2, 0.23, C * 0.22], [3, 0.27, C * 0.32], [4, 0.3, C * 0.4], [5, 0.335, C * 0.48], [6, 0.39, C * 0.56], [7, 0.47, C * 0.7], [8, 0.56, C * 0.82], [12, 0.93, C * 0.4]].forEach(([i, L, c]) => { S[i] = oklch(L, c, h); });
  S[9] = fitL(0.72, C, h, [N[1]], 6.0, +1);
  S[10] = fitL(0.76, C, h, [N[1]], 7.0, +1);
  S[11] = fitL(0.76, C, h, [...textBgs, S[3], S[4]], AA, +1);
  return S;
}

// ---------------- kategorie (wykresy, diagramy, metody HTTP, fazy) — tylko dataviz, nigdy status ----------------
// [odcień, chroma, start L jasny, start L ciemny] — wine ciemniejsze (jasny) / jaśniejsze (ciemny) od crimson, żeby się odróżniały
const CATS = { blue: [255, 0.13], teal: [200, 0.1], purple: [300, 0.15], green: [150, 0.12], crimson: [15, 0.13], orange: [55, 0.13], indigo: [275, 0.15], cyan: [215, 0.11], magenta: [345, 0.14], wine: [10, 0.11, 0.42, 0.74] };
function cats(theme, N) {
  const out = {};
  // cyan to kategoria „jasna” (ciemny tekst): odróżnia się od teal jasnością, nie tylko odcieniem; obrys >= 3:1
  out['cyan-strong'] = theme === 'light' ? fitL(0.6, 0.11, 215, ['#ffffff'], 3.2) : fitL(0.62, 0.11, 215, [N[1], N[2], N[3]], 3.2, +1);
  for (const [k, [h, C, l0 = 0.6, d0 = 0.62]] of Object.entries(CATS)) {
    if (k === 'cyan') { out[k] = theme === 'light' ? oklch(0.82, 0.1, 215) : oklch(0.86, 0.08, 215); continue; }
    out[k] = theme === 'light'
      ? fitL(l0, C, h, ['#ffffff'], 4.6)                       // pełne tło pod białym tekstem; na bieli >= 3:1
      : fitL(d0, C, h, [N[1], N[2], N[3]], 3.2, +1);           // na ciemnym tle >= 3:1; tekst na wierzchu ciemny
  }
  return out;
}

let PREVIEW = {};
const steps = (prefix, S, from = 1) => Object.keys(S).map(Number).filter((i) => i >= from).sort((a, b) => a - b).map((i) => `--${prefix}-${i}:${S[i]};`).join(' ');

function build() {
  const L = lightScales(), D = darkScales();
  const st = {
    light: { success: lightStatus(157, 0.12, L.N, L.textBgs), warning: lightStatus(65, 0.12, L.N, L.textBgs), danger: lightStatus(29, 0.17, L.N, L.textBgs) },
    dark: { success: darkStatus(159, 0.13, D.N, D.textBgs), warning: darkStatus(75, 0.12, D.N, D.textBgs), danger: darkStatus(26, 0.15, D.N, D.textBgs) },
  };
  const cl = cats('light', L.N), cd = cats('dark', D.N);
  PREVIEW = { l1: L.N[2], l2: L.N[0], d1: D.N[1], d2: D.N[2] };
  const catVars = (c) => Object.entries(c).map(([k, v]) => `--cat-${k}:${v};`).join(' ');

  const roles = (t) => `
  /* powierzchnie (app < surface < subtle/component < overlay) */
  --bg-app:var(--neutral-2); --bg-surface:var(--neutral-${t === 'light' ? 0 : 2}); --bg-subtle:var(--neutral-${t === 'light' ? 1 : 3});
  --bg-component:var(--neutral-${t === 'light' ? 3 : 4}); --bg-hover:var(--neutral-${t === 'light' ? 4 : 4}); --bg-active:var(--neutral-5);
  --bg-field:var(--neutral-${t === 'light' ? 0 : 1}); --bg-overlay:var(--neutral-${t === 'light' ? 0 : 3});
  --bg-inverse:var(--neutral-12); --text-on-inverse:var(--neutral-${t === 'light' ? 0 : 1});
  /* obramowania */
  --border-subtle:var(--neutral-6); --border-default:var(--neutral-7); --border-interactive:var(--neutral-8);
  /* tekst */
  --text-primary:var(--neutral-12); --text-secondary:var(--neutral-11); --text-tertiary:var(--neutral-10);
  /* akcent: działania główne, zaznaczenie, linki */
  --accent:var(--accent-9); --accent-hover:var(--accent-10); --accent-bg:var(--accent-3); --accent-bg-strong:var(--accent-4);
  --accent-border:var(--accent-7); --accent-text:var(--accent-11); --text-on-accent:${t === 'light' ? '#ffffff' : 'var(--neutral-1)'};
  --focus-ring:var(--accent-8); --border-accent:var(--accent-8); --accent-fill:var(--accent);
  /* tekst i nakładki na pełnych, ciemnych wypełnieniach (biel w obu motywach) */
  --on-solid:#ffffff;
  /* szyna kreatora konfiguracji (ciemny pas po lewej w obu motywach) */
  --bg-rail:${t === 'light' ? 'var(--neutral-12)' : 'var(--neutral-1)'}; --text-on-rail:#ffffff; --bg-rail-on:${t === 'light' ? '#ffffff' : 'var(--neutral-4)'}; --text-on-rail-on:${t === 'light' ? 'var(--neutral-12)' : 'var(--neutral-12)'};
  /* podglądy motywów w Ustawieniach — zawsze pokazują swój motyw */
  --preview-light-1:${PREVIEW.l1}; --preview-light-2:${PREVIEW.l2}; --preview-dark-1:${PREVIEW.d1}; --preview-dark-2:${PREVIEW.d2};
  /* statusy — tylko do statusu */
  --success:var(--success-11); --success-bg:var(--success-3); --success-border:var(--success-6);
  --warning:var(--warning-11); --warning-bg:var(--warning-3); --warning-border:var(--warning-6);
  --danger:var(--danger-11); --danger-bg:var(--danger-3); --danger-border:var(--danger-6);
  --info:var(--accent-11); --info-bg:var(--accent-3); --info-border:var(--accent-6);
  --text-on-status:${t === 'light' ? '#ffffff' : 'var(--neutral-1)'};
  /* kategorie (dataviz): pełne tło + tekst na nim */
  --text-on-cat:${t === 'light' ? '#ffffff' : 'var(--neutral-1)'};
  --cat-whitebox:#f6f8fb; --cat-whitebox-text:#141a21; --cat-whitebox-border:#7b8794;
  --cat-blackbox:#131a22; --cat-blackbox-text:#ffffff; --cat-blackbox-border:#7b8794;
  --cat-greybox:#98a4b1; --cat-greybox-text:#10161d;
  --cat-cyan-text:var(--neutral-${t === 'light' ? 12 : 1}); --cat-cyan-border:var(--cat-cyan-strong);
  --cat-root:var(--neutral-12); --cat-root-text:var(--text-on-inverse);
  /* role zależne (aplikacje, fazy, metody HTTP, wykresy) */
  --app-1:var(--cat-indigo); --app-2:var(--cat-purple); --app-3:var(--accent-text); --app-3-soft:var(--accent-bg);
  --ph-planning:var(--accent-text); --ph-tfmonitor:var(--accent-text); --ph-analysis:var(--cat-indigo); --ph-design:var(--cat-green);
  --ph-implementation:var(--cat-orange); --ph-execution:var(--cat-purple); --ph-completion:var(--cat-teal); --ph-runsummary:var(--accent-text);
  --m-get:var(--cat-blue); --m-post:var(--cat-green); --m-put:var(--cat-orange); --m-del:var(--cat-crimson);
  --m-get-soft:color-mix(in srgb,var(--cat-blue) 14%,var(--bg-surface)); --m-post-soft:color-mix(in srgb,var(--cat-green) 14%,var(--bg-surface));
  --m-put-soft:color-mix(in srgb,var(--cat-orange) 14%,var(--bg-surface)); --m-del-soft:color-mix(in srgb,var(--cat-crimson) 14%,var(--bg-surface));
  --viz-grid:var(--neutral-6); --viz-axis:var(--neutral-7); --viz-muted:var(--text-tertiary);
  --viz-seq-1:var(--accent-11); --viz-seq-2:var(--accent-9); --viz-seq-3:var(--accent-7);
  --diff-add-bg:var(--success-bg); --diff-add:var(--success); --diff-del-bg:var(--danger-bg); --diff-del:var(--danger);
  /* nakładki i cienie */
  --scrim:color-mix(in srgb,var(--neutral-${t === 'light' ? 12 : 1}) ${t === 'light' ? 42 : 70}%,transparent);
  --shadow-color:${t === 'light' ? 'var(--neutral-12)' : '#000000'};
  --sheen:color-mix(in srgb,#ffffff ${t === 'light' ? 22 : 10}%,transparent);
  --translucent-surface:color-mix(in srgb,var(--bg-surface) 92%,transparent);
  --elev-1:0 1px 2px color-mix(in srgb,var(--shadow-color) ${t === 'light' ? 5 : 40}%,transparent),0 8px 20px -12px color-mix(in srgb,var(--shadow-color) ${t === 'light' ? 14 : 60}%,transparent);
  --elev-2:0 2px 4px color-mix(in srgb,var(--shadow-color) ${t === 'light' ? 6 : 40}%,transparent),0 18px 40px -18px color-mix(in srgb,var(--shadow-color) ${t === 'light' ? 26 : 70}%,transparent);
  --elev-3:0 24px 60px -20px color-mix(in srgb,var(--shadow-color) ${t === 'light' ? 25 : 70}%,transparent);
  --focus-shadow:0 0 0 3px color-mix(in srgb,var(--focus-ring) ${t === 'light' ? 28 : 35}%,transparent);
  --app-glow:radial-gradient(1200px 420px at 70% -120px,var(--accent-${t === 'light' ? 2 : 2}) 0,transparent 70%);`;

  const css = `/* TOKENY KOLORÓW — wygenerowane przez scripts/build-tokens.js; nie edytuj ręcznie, zmień generator i uruchom go.
   Ładowany jako ostatni arkusz: jedyne źródło kolorów aplikacji. Skale 12-stopniowe (Radix / Material 3), role semantyczne
   (Apple HIG / Material 3), kontrast sprawdzany przez scripts/contrast-check.js (WCAG 2.2: tekst >= 4.5:1, UI >= 3:1). */
:root{
  color-scheme:light;
  ${steps('neutral', L.N, 0)}
  ${steps('accent', L.A)}
  ${steps('success', st.light.success)}
  ${steps('warning', st.light.warning)}
  ${steps('danger', st.light.danger)}
  ${catVars(cl)}
  --r-2xs:3px; --r-xs:6px; --r-sm:8px; --r:12px; --r-pill:999px; /* jedna skala promieni */
  --shadow:var(--elev-1); --shadow-lift:var(--elev-2); --shadow-lg:var(--elev-3); --glow:none;${roles('light')}
}
:root[data-theme="dark"]{
  color-scheme:dark;
  ${steps('neutral', D.N, 0)}
  ${steps('accent', D.A)}
  ${steps('success', st.dark.success)}
  ${steps('warning', st.dark.warning)}
  ${steps('danger', st.dark.danger)}
  ${catVars(cd)}${roles('dark')}
}
`;
  return { css, L, D, st, cl, cd };
}

if (require.main === module) {
  const out = path.join(__dirname, '..', 'public', 'tokens.css');
  fs.writeFileSync(out, build().css);
  console.log('wrote', out);
}
module.exports = { build };
