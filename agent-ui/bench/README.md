# Benchmark silnika pentestowego

Mierzy, ile znanych podatności silnik faktycznie wykrywa (recall) i ile zgłasza fałszywie. Uruchamia PEŁNY silnik —
Recon i wszystkie moduły — przeciw celowi z zadeklarowaną prawdą, a potem dopasowuje zweryfikowane findingi do tej
prawdy. To jedyny uczciwy sposób na liczby: testy jednostkowe sprawdzają logikę na atrapach, benchmark sprawdza, czy
silnik łapie realne błędy na działającej aplikacji.

## Cel domyślny: lokalna podatna aplikacja

`bench/vuln-app.js` to celowo podatna aplikacja (renderowana po stronie serwera, z linkami i formularzami, żeby Recon
odkrył powierzchnię jak w produkcji). Każda klasa ma wariant podatny i bezpieczny, więc liczymy zarazem wykrywalność i
fałszywe alarmy. Działa bez sieci i bez Dockera.

```
node bench/pentest-bench.js            # pełny przebieg (z DOM XSS i SSRF; wymaga Playwrighta i Chrome)
BENCH_BROWSER=0 BENCH_OOB=0 node bench/pentest-bench.js   # szybko, same klasy sieciowe
BENCH_JSON=1 node bench/pentest-bench.js                  # wynik jako JSON
```

Ostatni zmierzony wynik na komplecie 18 klas: **18/18 wykrytych, 0 fałszywych alarmów** (1 finding słusznie
wstrzymany jako niezweryfikowany). Regresję pilnuje `test/pentest-bench.test.js` (próg recall ≥ 90%, zero fałszywych),
w przebiegu bez przeglądarki i serwera zwrotnego, żeby był szybki i deterministyczny.

## Cel zewnętrzny (np. OWASP Juice Shop)

```
docker run --rm -p 3000:3000 bkimminich/juice-shop
BENCH_TARGET=http://localhost:3000 node bench/pentest-bench.js
```

Przeciw zewnętrznemu celowi dopasowanie do prawdy nie zadziała (prawda opisuje lokalną aplikację), więc benchmark
pokaże listę zweryfikowanych findingów do ręcznej oceny. Dla twardych liczb recall na Juice Shopie trzeba dodać jego
mapę prawdy — to naturalny kolejny krok.

## Czego benchmark NIE mierzy (świadomie)

- Celem jest aplikacja renderowana po stronie serwera. Prawdziwy SPA (trasy i API budowane dynamicznie w JS) obnażyłby
  ograniczenia crawlera — Recon czyta linki, formularze i skrypty (też inline), ale nie wykonuje JS. To znany dług.
- Brak pomiaru głębokości (blind/time-based SQLi, drugiego rzędu) — tego silnik i tak jeszcze nie ma.

---

# Benchmark testów funkcjonalnych (techniki ISTQB)

Mierzy, czy elementy pokrycia policzone przez silnik technik (`lib/test-techniques.js`: klasy równoważności,
wartości brzegowe, tablice decyzyjne, przejścia stanów, pairwise) i wykonane przez `lib/technique-exec.js` wykrywają
**znane** błędy funkcjonalne, i czy na poprawnej aplikacji nie dają fałszywych alarmów.

```
node bench/functional-bench.js
```

Cel: `bench/shop-app.js` — sklep (zamówienia, rabaty, wycena wysyłki, cykl życia zamówienia) ze specyfikacją OpenAPI
i 13 wszczepionymi błędami typowymi dla testów funkcjonalnych: przesunięte granice, brak wymaganego pola, wartość
spoza listy, ułamek zamiast liczby całkowitej, zła reguła rabatu, granica warunku (`>` zamiast `>=`), niedozwolone
przejście stanu, zły stan po przejściu, awaria na kombinacji dwóch opcji, wartość zapisana inaczej niż przyjęta,
rekord zapisany mimo odrzucenia. Wejściem silnika są specyfikacja i modele reguł, które agent wypisałby z ticketów
(`MODELS` w `shop-app.js`) — nie odpowiedzi.

Metoda jak w testach mutacyjnych: przebieg na poprawnej aplikacji (każda porażka = fałszywy alarm), potem osobny
przebieg dla każdego błędu z tylko tym jednym błędem (bo jeden defekt potrafi zamaskować drugi), i to samo w trybie
„tylko kod statusu”, żeby zmierzyć, co wnoszą asercje na stanie.

Ostatni wynik (98 elementów pokrycia: EP 52, BVA 12, DT 4, ST 20, PW 10):

| | Wynik |
|---|---|
| Wykryte błędy (DDP) | **13/13 = 100%** |
| Fałszywe alarmy na poprawnej aplikacji | **0** |
| Same kody statusu, bez asercji na stanie | 10/13 = 76,9% (gubi B7, B11, B13) |
| Kontrola negatywna B14 (cena, której nie podaje żadne źródło) | niewykryta — tak musi być |

Regresję pilnuje `test/functional-bench.test.js`.

## Uczciwie: czego ten wynik NIE dowodzi

- **Benchmark jest „przyjazny”.** Błędy i silnik powstały w tym samym zespole, więc 100% mówi, że silnik poprawnie
  realizuje techniki i wyrocznię, a nie, że znajdzie 100% błędów w obcej aplikacji. Następny krok: cel z błędami
  zaprojektowanymi przez kogoś, kto nie zna silnika, albo zewnętrzny zbiór błędów.
- **Mierzy warstwę deterministyczną, nie agenta.** Wiązania DT/ST/PW (jak ustawić warunek, jak odczytać wynik) są w
  benchmarku stałe. W prawdziwym przebiegu robi to agent w krokach testu — jego trafność mierzy audyt wyroczni
  (`lib/design-oracle.js`), nie ten benchmark.
- **Silnik nie wie więcej niż źródła.** Błąd w wartości, której nie podaje żaden ticket ani specyfikacja (B14), jest
  niewykrywalny dla wyroczni — i dobrze, bo inaczej silnik by zgadywał. Takie miejsca muszą trafić do „To confirm”.
- **Modele reguł są poprawne z założenia.** Gdy agent źle przepisze regułę z ticketu do modelu, silnik policzy
  poprawne elementy dla złej reguły. Dlatego każdy model ma `src`, a weryfikator sprawdza go ze źródłem.
