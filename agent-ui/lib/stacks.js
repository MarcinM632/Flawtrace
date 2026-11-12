// Stosy autotestów: język + narzędzie, w którym agent pisze testy. Python (pytest / Playwright) to dotychczasowy, w pełni
// zautomatyzowany przepływ (uruchomienie na środowisku, pętla poprawek, "Save to repo" po dwóch zielonych przebiegach).
// Pozostałe stosy dostają samodzielny projekt w osobnym folderze autotests/<folder>/, zbudowany wg warstw gTAA z sylabusa
// ISTQB TAE: definicja testów, adaptacja do SUT (klienty API / page objecty), konfiguracja i dane, wykonanie i raport.
// Aplikacja ich sama nie uruchamia (każdy stos ma własny runner), więc w raporcie podaje gotową komendę.
const STACKS = {
  python: { key: 'python', label: 'Python', tool: 'pytest / Playwright', layer: null, folder: null },
  'ts-playwright': {
    key: 'ts-playwright', label: 'TypeScript', tool: 'Playwright', layer: 'ui', folder: 'ts-playwright',
    run: 'npm install && npx playwright install && npx playwright test',
    files: 'package.json, tsconfig.json, playwright.config.ts, tests/*.spec.ts, pages/*.ts (page objecty), fixtures/*.ts, utils/*.ts, README.md',
    rules: 'Używaj @playwright/test. Selektory wyłącznie w page objectach (pages/), preferuj getByRole/getByLabel/getByTestId. Zero sleepów: tylko auto-wait i web-first assertions (expect(locator)). Adres aplikacji z process.env.BASE_URL w playwright.config.ts.',
  },
  'java-restassured': {
    key: 'java-restassured', label: 'Java', tool: 'REST Assured', layer: 'api', folder: 'java-restassured',
    run: 'mvn test',
    files: 'pom.xml (JUnit 5, REST Assured, AssertJ), src/test/java/.../tests/*Test.java, src/test/java/.../client/*Client.java (warstwa adaptacji), src/test/java/.../model/*.java, src/test/resources/config.properties, README.md',
    rules: 'JUnit 5 + REST Assured + AssertJ. Wywołania HTTP wyłącznie w klasach *Client (warstwa adaptacji), test zawiera scenariusz i asercje. Specyfikacja żądania (RequestSpecification) w jednym miejscu. Adres bazowy z System.getProperty/ zmiennej środowiskowej BASE_URL.',
  },
  'java-selenium': {
    key: 'java-selenium', label: 'Java', tool: 'Selenium', layer: 'ui', folder: 'java-selenium',
    run: 'mvn test',
    files: 'pom.xml (JUnit 5, Selenium, AssertJ), src/test/java/.../tests/*Test.java, src/test/java/.../pages/*Page.java (page objecty), src/test/java/.../support/DriverFactory.java, src/test/resources/config.properties, README.md',
    rules: 'JUnit 5 + Selenium 4 + AssertJ. Selektory i interakcje wyłącznie w klasach *Page. Tylko jawne oczekiwania (WebDriverWait + ExpectedConditions), nigdy Thread.sleep. Tworzenie i zamykanie drivera w jednym miejscu (DriverFactory). Adres aplikacji z BASE_URL.',
  },
  'js-cypress': {
    key: 'js-cypress', label: 'JavaScript', tool: 'Cypress', layer: 'ui', folder: 'js-cypress',
    run: 'npm install && npx cypress run',
    files: 'package.json, cypress.config.js, cypress/e2e/*.cy.js, cypress/support/commands.js, cypress/support/pages/*.js (page objecty), cypress/fixtures/*.json, README.md',
    rules: 'Cypress. Selektory wyłącznie w page objectach, preferuj atrybuty data-cy/data-testid. Zero cy.wait(liczba): czekaj na żądania przez cy.intercept + alias albo na stan elementu. Adres aplikacji z Cypress.env / baseUrl w cypress.config.js.',
  },
};

const stackOf = (key) => (STACKS[key] && key !== 'python' ? STACKS[key] : STACKS.python);
const isProject = (key) => stackOf(key).key !== 'python';

/** System prompt dla stosu innego niż Python (zastępuje blok pytest z OVERRIDE_AUTOTEST). */
function stackPrompt(key) {
  const s = stackOf(key);
  return `TRYB APLIKACJI — AUTOTESTS, STOS: ${s.label} / ${s.tool} (nadrzędny wobec wszystkiego innego w tej sesji):

ROLA
Dostajesz przypadek testowy opisany prozą albo przebieg testu. Zamieniasz go na PROSTE, profesjonalne testy w stosie ${s.label} / ${s.tool}
i zapisujesz jako pliki projektu w katalogu \`${s.folder}/\` (jesteś w katalogu głównym repozytorium autotestów, folder utwórz, jeśli go nie ma).
Jeśli \`${s.folder}/\` już istnieje, przeczytaj go w całości i dopisuj w jego stylu, niczego nie duplikując.

GRANICA — NAJWAŻNIEJSZA ZASADA
Piszesz WYŁĄCZNIE w \`${s.folder}/\`. Nie czytasz ani nie zapisujesz niczego poza tym katalogiem w repozytorium autotestów poza podglądem
README.md i istniejących testów dla stylu. Żadnych innych repozytoriów ani katalogów wyżej. Niczego nie uruchamiasz.

POŚWIADCZENIA
Nigdy nie wpisujesz do kodu haseł, tokenów, kluczy ani adresów produkcyjnych. Adres aplikacji, użytkownik i hasło testowe pochodzą ze zmiennych
środowiskowych (opisz je w README.md). Zasoby testowe to wyłącznie \`AUTOTEST\`; test niczego innego nie tworzy ani nie zmienia i po sobie sprząta.

ARCHITEKTURA (ogólna architektura automatyzacji testów, gTAA z sylabusa ISTQB TAE) — projekt ma wyraźne warstwy:
- DEFINICJA TESTÓW: same testy, krótkie, czytelne, bez szczegółów technicznych.
- ADAPTACJA DO SUT: wszystko, co dotyka aplikacji (klienty API / page objecty / wywołania HTTP / selektory) w osobnych klasach lub plikach.
- KONFIGURACJA I DANE: adresy, użytkownicy i dane testowe poza kodem testów (zmienne środowiskowe, plik konfiguracyjny, fixtures).
- WYKONANIE I RAPORT: skonfigurowany runner z raportem (czytelne nazwy testów, zrzuty ekranu lub logi żądań przy awarii).
Zastosuj wzorce, gdzie mają sens: Page Object (UI), klient API (API), Builder dla danych testowych.

ZASADY JAKOŚCI
- JEDEN TEST SPRAWDZA JEDNĄ RZECZ i jest niezależny od pozostałych (sam przygotowuje stan i po sobie sprząta). Najwyżej 6 testów na zlecenie.
- Nazwa testu to zwykłe zdanie: co jest sprawdzane i jaki ma być skutek, najwyżej ~9 słów.
- Każdy test ma komentarz z scenariuszem GIVEN / WHEN / THEN, każda linia jedno krótkie zdanie.
- Bez sleepów i sztywnych czasów oczekiwania, bez magicznych wartości w ciele testu, bez duplikacji.
- Komunikat asercji tłumaczy problem słowami ("Item count is 5, expected 1").
- ${s.rules}

STRUKTURA PROJEKTU
Zapisz komplet plików potrzebnych do uruchomienia: ${s.files}.
README.md zawiera: do czego służy projekt, wymagane zmienne środowiskowe, komendę uruchomienia (\`${s.run}\`) i krótki opis warstw.

RAPORT
Na końcu podaj po polsku, w sekcjach: CO ZOSTAŁO NAPISANE (lista plików i testów), JAK URUCHOMIĆ (\`cd ${s.folder} && ${s.run}\`),
UWAGI (czego nie dało się ustalić i co tester ma uzupełnić, np. zmienna środowiskowa). Nie twierdź, że testy przeszły: ich nie uruchamiałeś.`;
}

/** Wszystkie pliki projektu stosu w katalogu roboczym (poczekalnia), względne ścieżki. */
function projectFiles(root, key) {
  const fs = require('fs');
  const path = require('path');
  const s = stackOf(key);
  const base = path.join(root, s.folder);
  const out = [];
  const SKIP = new Set(['node_modules', 'target', '.git', 'test-results', 'playwright-report', '.idea']);
  const walk = (dir) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      if (SKIP.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (out.length < 200) out.push({ path: path.relative(root, p).split(path.sep).join('/'), status: 'new' });
    }
  };
  walk(base);
  return out;
}

module.exports = { STACKS, isProject, projectFiles, stackOf, stackPrompt };
