// Kolor: konwersje sRGB <-> OKLCH i kontrast WCAG 2.2. Wspólne dla generatora tokenów i kontroli kontrastu.
// Tylko narzędzia deweloperskie (scripts/), nie trafia do aplikacji.
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

function hexToRgb(hex) {
  let h = String(hex).trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 };
}
const rgbToHex = ({ r, g, b }) => '#' + [r, g, b].map((x) => Math.round(clamp(x) * 255).toString(16).padStart(2, '0')).join('');
const lin = (x) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
const gam = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);

function oklchToRgb(L, C, h) {
  const a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: gam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}
const inGamut = (c) => [c.r, c.g, c.b].every((x) => x >= -1e-4 && x <= 1 + 1e-4);
/** OKLCH -> hex; chroma zmniejszana, aż kolor zmieści się w sRGB. */
function oklch(L, C, h) {
  let c = C, rgb = oklchToRgb(L, c, h);
  while (!inGamut(rgb) && c > 0) { c = Math.max(0, c - 0.002); rgb = oklchToRgb(L, c, h); }
  return rgbToHex(rgb);
}
function rgbToOklch(hex) {
  const { r, g, b } = hexToRgb(hex);
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(a, bb), h: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360 };
}
function luminance(hex) { const { r, g, b } = hexToRgb(hex); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); }
function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

/**
 * Najjaśniejsza (dir=-1: schodzimy w dół od L0) albo najciemniejsza (dir=+1) wartość L dla danego odcienia,
 * przy której kolor ma kontrast >= min z KAŻDYM z kolorów `against`. Krok 0.002.
 */
function fitL(L0, C, h, against, min, dir = -1) {
  for (let L = L0; L > 0.02 && L < 0.995; L += dir * 0.002) {
    const hex = oklch(L, C, h);
    if (against.every((x) => contrast(hex, x) >= min)) return hex;
  }
  throw new Error(`fitL: brak L dla h=${h} C=${C} >= ${min}`);
}

module.exports = { oklch, rgbToOklch, contrast, luminance, fitL, hexToRgb, rgbToHex };
