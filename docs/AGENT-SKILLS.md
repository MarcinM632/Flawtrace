# Skille agentów, walidatory i ustawienia kosztu

Każdy agent ma skille: krótkie, sprawdzalne metody pracy oparte na ISTQB, OWASP i zasadach produktu. Agent z narzędziem Skill ładuje je sam w kroku, który wskazuje jego `CLAUDE.md`. Agentom bez tego narzędzia aplikacja wkleja treść skilli w prompt, tylko dla ich trybu.

## Skille według agenta

| Agent | Skille | Jak dostaje |
|---|---|---|
| Static | `requirement-testability`, `cross-source-consistency`, `scenario-dry-run` | narzędzie Skill |
| Planning | `risk-assessment`, `entry-exit-criteria`, `verdict-gate` | narzędzie Skill |
| Analysis | `technique-selection`, `coverage-matrix`, `impact-radius` | narzędzie Skill |
| Test Design | `business-case-design`, `expected-result-oracle`, `technique-coverage`, `spec-checks`, `whitebox-handoff` | narzędzie Skill |
| Implementation | `procedure-merge`, `step-executability`, `priority-and-gates` | narzędzie Skill |
| Completion | `results-consolidation`, `defect-triage`, `lessons-check` | narzędzie Skill |
| Whitebox (CORE / SVC / mcp) | `edge-cases`, `mapping-check`, `missing-handling`, `impact-in-reality` | narzędzie Skill (wspólne źródło: `agents/_shared/whitebox-skills`) |
| Verifier | `finding-adversary`, `quote-vs-line-check`, `report-type-profiles` (tylko profil danego raportu) | w prompcie |
| QA MCP / Execution | `result-triage`, `endpoint-error-recovery`, `test-data-and-cleanup`, `evidence-from-calls` (+ `procedure-execution` w Execution) | w prompcie |
| Autotests | `test-from-design`, `independent-fast-tests`, `failure-triage-fix` | w prompcie |
| UI Tests | `ui-flow-verification`, `ui-api-parity`, `ui-evidence` | w prompcie |
| Pentest | `owasp-sweep`, `authz-boundary-tests`, `proof-and-retest` | w prompcie |

Po edycji skilli whitebox w `agents/_shared/whitebox-skills` uruchom `agents/_shared/sync-whitebox-skills.sh`. Test pilnuje, żeby trzy kopie były identyczne.

## Walidatory raportów

Agent uruchamia walidator przed oddaniem raportu i poprawia wskazane problemy. Aplikacja sprawdza raport po raz drugi (kontrola dowodów `plik:linia` i cytatów), a niezależny Verifier próbuje obalić każdy finding.

| Walidator | Najważniejsze reguły |
|---|---|
| `validate-static.sh` | `facts.md` w katalogu roboczym; każde wymaganie z `| varies: <rodzaj>`; każdy scenariusz z `covers: R<n>`; wymaganie z regułą biznesową, funkcjonalne albo dotyczące danych musi być pokryte scenariuszem albo mieć wpis `no scenario:` |
| `validate-plan.sh` | ryzyka z id `P<n>`/`J<n>`, ekspozycja = prawdopodobieństwo × wpływ, najwyżej 12 ryzyk; priorytet High przy ryzyku produktowym high/high; 2–8 kryteriów wejścia i wyjścia z `measure:` i `src:`, bez ogólników; werdykt zgodny z regułami i z sekcją Blockers |
| `validate-strategy.sh`, `validate-design.sh`, `validate-implementation.sh`, `validate-completion.sh`, `validate-report.sh` | format, śledzenie wymagań, arytmetyka szacunków, bramki, dowody |

## Ustawienia kosztu i pamięci

| Zmienna | Domyślnie | Działanie |
|---|---|---|
| `QA_MODEL` | `claude-sonnet-5-5` | model agentów |
| `QA_VERIFIER_MODEL` | jak `QA_MODEL` | model weryfikatora raportów; tańszy (np. `claude-haiku-5-5`) obniża koszt, ale jakość sprawdź najpierw na kilku raportach |
| `QA_VERIFIER_EARLY` | wyłączone | `1` = weryfikator przed korektą raportu (stare zachowanie). Domyślnie, gdy kontrola aplikacji wymaga korekty, weryfikator sprawdza dopiero poprawiony raport: jedna sesja zamiast dwóch |
| `QA_MAX_TURNS` | wyłączone | limit tur agenta (`--max-turns`); bez niego przebieg kończy limit czasu |
| `QA_KEEP_LOADED_RUNS` | 8 | ile zakończonych przebiegów trzyma zdarzenia w RAM; reszta jest czytana z dysku na żądanie |
| `QA_MAX_OUTPUT_CHARS` | 8 000 000 | limit bufora wyjścia procesów (pytest, lista testów); zostaje koniec wyjścia |

Raport kosztów: `GET /api/costs?days=N` pokazuje koszt, tokeny, tury, minuty i udział cache dla każdego agenta i każdego ticketu. Zaglądaj tam przed optymalizacjami: niski udział cache oznacza, że prompt nie trafia w cache.


## Techniki ISTQB liczone przez aplikację i wyrocznia Test design

Test design nie zgaduje wartości do testu ani oczekiwanych wyników. Liczy je aplikacja, a agent tylko decyduje, gdzie technika pasuje do reguły biznesowej.

- **Silnik technik** (`agent-ui/lib/test-techniques.js`, narzędzie `mcp__sources__test_design_items`):
  - klasy równoważności i wartości brzegowe (2- i 3-punktowe) z ograniczeń specyfikacji OpenAPI: `minimum`, `maximum`, `exclusive*`, `multipleOf`, długości, `enum`, `required`, `format`, typ;
  - kolumny tablicy decyzyjnej z modelu reguł. Warunek progowy dostaje wartość dokładnie na progu i tuż obok, więc tablica łapie też pomyłkę `>` / `>=`;
  - przejścia stanów: poprawne są wymagane, niepoprawne zalecane, z najkrótszą ścieżką dojścia do stanu;
  - pairwise: deterministyczny generator, który pokrywa każdą parę wartości.

  Każdy element ma stały identyfikator (`BVA:post-orders:quantity:max+1`), oczekiwany wynik i wyrocznię. Luki w regułach to defekty wymagania i trafiają do „To confirm”: kolumna bez reguły, sprzeczne reguły, stan nieosiągalny.
- **Modele reguł** agent zapisuje do `WORK_DIR/technique-models.json`, każdy ze `src`. Walidator sprawdza ich format.
- **Audyt wyroczni** (`agent-ui/lib/design-oracle.js`) po każdym projekcie, bez modelu:
  - Każde `(src: ...)` jest rozwiązywane w źródłach: klucz ticketu, endpoint ze specyfikacji, bug z rejestru, wpis `kb:<serwis>#<sekcja>` w bazie wiedzy, `plik:linia` w pobranym kodzie.
  - Pokrycie techniki jest mierzone z `ci: <id>` w checkach. Brakujący wymagany element musi być przetestowany albo wpisany do `Not covered:` z powodem.
  - Oczekiwany wynik nie może przeczyć wyroczni elementu, np. sukces dla wartości poza zakresem albo zły rabat.

  Problemy wracają do agenta w jednej turze korekty. Wynik trafia do UI jako pokrycie per technika i macierz śledzalności: przypadek biznesowy → punkt → check → źródła ze statusem → elementy pokrycia. Macierz da się pobrać jako CSV.
- **Benchmark** (`agent-ui/bench/functional-bench.js`, opis w `agent-ui/bench/README.md`) mierzy wykrywalność znanych błędów funkcjonalnych i fałszywe alarmy, razem z uczciwym opisem, czego wynik nie dowodzi.

## Mutation testing autotestów

Wygenerowane autotesty mogą przechodzić, niczego nie sprawdzając. `agent-ui/lib/mutation-proxy.js` mierzy, czy suita wykrywa zmiany danych. Skrypt jest samodzielny, bez zależności: do pobrania z `/api/tools/mutation-test.js` jako `flawtrace-mutation.js`, a eksport CI ma gotowy job `mutation`.

Jak działa:
1. Proxy staje między suitą a aplikacją: suita dostaje `BASE_URL` wskazujący na proxy.
2. Przebieg bazowy, dwa razy. Suita musi przejść za każdym razem. Suita zależna od stanu danych z poprzedniego przebiegu nie dostaje wyniku, bo porażki wynikałyby z danych, a nie z mutacji.
3. Z zapisanych odpowiedzi powstają mutanty. Każdy zmienia jedną rzecz w jednym endpoincie: liczbę o 1, tekst, wartość logiczną, usunięte pole, krótszą listę albo odpowiedź błędu zamienioną na 200. Pola identyfikatorów, dat i linków są pomijane, bo ich zmiana psuje kolejne wywołania i zawyżałaby wynik.
4. Suita biegnie raz dla każdego mutanta. Wynik = zabite / (zabite + przeżyłe). Raport wypisuje przeżyłe mutanty per endpoint, czyli konkretne pola, których żaden test nie sprawdza.

Mutacje dotyczą odpowiedzi API, więc metoda działa z każdym stosem (Playwright, Cypress, pytest, REST Assured) i nie wymaga przebudowy aplikacji. Testy UI też: mutowane są odpowiedzi JSON, które frontend pobiera z tego samego adresu.

Ograniczenie: mutacja odpowiedzi nie zastąpi mutowania logiki serwera. Nie zmierzy, czy testy wykryją błąd w obliczeniu, którego wynik nie wraca w odpowiedzi.
