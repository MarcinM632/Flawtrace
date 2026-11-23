# Skille agentów, walidatory i ustawienia kosztu

Każdy agent ma skille: krótkie, sprawdzalne metody pracy oparte na ISTQB, OWASP i zasadach produktu. Agent z narzędziem Skill ładuje je sam w kroku, który wskazuje jego `CLAUDE.md`. Agentom bez tego narzędzia aplikacja wkleja treść skilli w prompt, tylko dla ich trybu.

## Skille według agenta

| Agent | Skille | Jak dostaje |
|---|---|---|
| Static | `requirement-testability`, `cross-source-consistency`, `scenario-dry-run` | narzędzie Skill |
| Planning | `risk-assessment`, `entry-exit-criteria`, `verdict-gate` | narzędzie Skill |
| Analysis | `technique-selection`, `coverage-matrix`, `impact-radius` | narzędzie Skill |
| Test Design | `business-case-design`, `expected-result-oracle`, `spec-checks`, `whitebox-handoff` | narzędzie Skill |
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
