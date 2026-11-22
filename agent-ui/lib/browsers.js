// Wybór przeglądarek dla uruchomienia wygenerowanego projektu Playwright. Dotąd UI Tests odpalały tylko Chromium;
// wzorem frameworka e2e (silnik web: Chromium + Firefox + WebKit przez Playwright) pozwalamy odpalić ten sam test
// na kilku silnikach, sterowane zmienną UITEST_BROWSERS (np. "chromium,firefox,webkit"). Domyślnie chromium —
// zero zmiany zachowania, dopóki ktoś świadomie nie włączy reszty. Czysty helper, bez efektów ubocznych.
const DEVICES = { chromium: 'Desktop Chrome', firefox: 'Desktop Firefox', webkit: 'Desktop Safari' };

// Mobile: emulacja urządzeń Playwright (viewport, touch, user-agent, DPR) — testujemy aplikację webową tak, jak
// renderuje i zachowuje się na telefonie/tablecie, w tym samym deterministycznym pipelinie (bez Appium/symulatorów).
// Klucz presetu -> { device: nazwa urządzenia Playwright, browser: silnik, który trzeba zainstalować }.
// To NIE jest testowanie natywnych aplikacji (binarki iOS/Android) — to osobny silnik (zob. komentarz w ui-run).
const DEVICE_PRESETS = {
  iphone: { device: 'iPhone 13', browser: 'webkit' },
  'iphone-se': { device: 'iPhone SE', browser: 'webkit' },
  'iphone-15': { device: 'iPhone 15', browser: 'webkit' },
  ipad: { device: 'iPad (gen 7)', browser: 'webkit' },
  pixel: { device: 'Pixel 7', browser: 'chromium' },
  galaxy: { device: 'Galaxy S9+', browser: 'chromium' },
};

/** Lista przeglądarek z wejścia (zmienna/konfiguracja). Nieznane nazwy odpadają; pusta lista -> ['chromium']. */
function parse(input) {
  const list = String(input || '').split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
    .filter((b) => DEVICES[b]);
  return list.length ? [...new Set(list)] : ['chromium'];
}

/** Presety urządzeń mobilnych z wejścia. Nieznane odpadają; brak -> [] (nie domyślamy niczego mobilnego). */
function parseDevices(input) {
  const list = String(input || '').split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
    .filter((d) => DEVICE_PRESETS[d]);
  return [...new Set(list)];
}

const browserProject = (b) => `{ name: '${b}', use: { ...devices['${DEVICES[b]}'] } }`;
const deviceProject = (d) => `{ name: '${d}', use: { ...devices['${DEVICE_PRESETS[d].device}'] } }`;

/**
 * Plan uruchomienia: które projekty Playwright wygenerować i które silniki zainstalować.
 * @param browsers    wejście UITEST_BROWSERS (desktop).
 * @param devices     wejście UITEST_DEVICE (mobile, presety).
 * @param browsersSet czy UITEST_BROWSERS było jawnie ustawione (żeby przy samym UITEST_DEVICE nie dokładać desktopu).
 * @returns { projectsSnippet: string, install: string[], desktop: string[], mobile: string[] }
 */
function devicePlan({ browsers = '', devices = '', browsersSet = false } = {}) {
  const mobile = parseDevices(devices);
  if (mobile.length) {
    const desktop = browsersSet ? parse(browsers) : []; // same mobile, chyba że ktoś jawnie chce też desktop
    const projects = [...desktop.map(browserProject), ...mobile.map(deviceProject)];
    const install = [...new Set([...desktop, ...mobile.map((d) => DEVICE_PRESETS[d].browser)])];
    return { projectsSnippet: '[' + projects.join(', ') + ']', install, desktop, mobile };
  }
  const desktop = parse(browsers);
  return { projectsSnippet: '[' + desktop.map(browserProject).join(', ') + ']', install: desktop, desktop, mobile: [] };
}

/** Argumenty do `npx playwright install <browsers>` — instalujemy tylko to, co uruchamiamy. */
function installArgs(browsers) { return ['playwright', 'install', ...parse(browsers.join ? browsers : [browsers])]; }

/** Fragment `projects: [...]` do flawtrace.config.ts — jeden projekt na przeglądarkę, z urządzeniem desktop. */
function projectsSnippet(browsers) {
  const list = parse(browsers.join ? browsers : [browsers]);
  return '[' + list.map((b) => `{ name: '${b}', use: { ...devices['${DEVICES[b]}'] } }`).join(', ') + ']';
}

module.exports = { parse, parseDevices, installArgs, projectsSnippet, devicePlan, DEVICES, DEVICE_PRESETS };
