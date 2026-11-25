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
