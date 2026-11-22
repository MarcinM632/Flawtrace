// Wybór przeglądarek dla uruchomienia wygenerowanego projektu Playwright. Dotąd UI Tests odpalały tylko Chromium;
// wzorem frameworka e2e (silnik web: Chromium + Firefox + WebKit przez Playwright) pozwalamy odpalić ten sam test
// na kilku silnikach, sterowane zmienną UITEST_BROWSERS (np. "chromium,firefox,webkit"). Domyślnie chromium —
// zero zmiany zachowania, dopóki ktoś świadomie nie włączy reszty. Czysty helper, bez efektów ubocznych.
const DEVICES = { chromium: 'Desktop Chrome', firefox: 'Desktop Firefox', webkit: 'Desktop Safari' };

/** Lista przeglądarek z wejścia (zmienna/konfiguracja). Nieznane nazwy odpadają; pusta lista -> ['chromium']. */
function parse(input) {
  const list = String(input || '').split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
    .filter((b) => DEVICES[b]);
  return list.length ? [...new Set(list)] : ['chromium'];
}

/** Argumenty do `npx playwright install <browsers>` — instalujemy tylko to, co uruchamiamy. */
function installArgs(browsers) { return ['playwright', 'install', ...parse(browsers.join ? browsers : [browsers])]; }

/** Fragment `projects: [...]` do flawtrace.config.ts — jeden projekt na przeglądarkę, z urządzeniem desktop. */
function projectsSnippet(browsers) {
  const list = parse(browsers.join ? browsers : [browsers]);
  return '[' + list.map((b) => `{ name: '${b}', use: { ...devices['${DEVICES[b]}'] } }`).join(', ') + ']';
}

module.exports = { parse, installArgs, projectsSnippet, DEVICES };
