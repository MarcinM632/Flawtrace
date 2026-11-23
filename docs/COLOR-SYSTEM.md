# System kolorów

Kolory aplikacji pochodzą z jednego miejsca: `agent-ui/public/tokens.css`, generowanego przez `agent-ui/scripts/build-tokens.js`. Pliku nie edytuj ręcznie: zmień generator i uruchom go ponownie.

## Zasady

- **Role zamiast surowych kolorów.** Komponenty używają tokenów ról (`--bg-surface`, `--text-secondary`, `--accent`, `--danger`…), nigdy wartości hex, rgb ani hsl.
- **Skale 12-stopniowe** (model Radix i palety tonalne Material 3):
  - jedna skala neutralna, lekko zabarwiona odcieniem akcentu;
  - jedna skala akcentu;
  - skale statusów: success, warning, danger (info = akcent).
- **Stopnie pod kontrast.** Stopnie z wymaganiem kontrastu (obramowanie interaktywne, fokus, tło pełne pod tekstem, tekst) nie są zgadywane. Generator szuka w OKLCH najbliższej wartości spełniającej WCAG 2.2 wobec teł, na których dany stopień leży.
- **Akcent.** Wyprowadzony z koloru marki (`#0e82bd` w jasnym motywie, `#2f9fd8` w ciemnym). Pełny akcent pod białym tekstem lekko przyciemniono (`#057bb5`), bo `#0e82bd` daje tylko 4,25:1.
- **Statusy tylko do statusu.** Wykresy, diagramy, metody HTTP i fazy mają osobne kolory kategoryczne (`--cat-*`). Kategorie różnią się także jasnością (cyan jasny z ciemnym tekstem i obrysem).
- **Ciemny motyw to nie odwrócenie.** Tła są przyciemnione, pierwsze plany rozjaśnione, a tekst na pełnym akcencie jest ciemny.
- **Stany interakcji** (`public/states.css`) mają jedną definicję dla obu motywów:
  - zaznaczenie w nawigacji i przełącznikach: tło i tekst akcentu oraz wskaźnik (pasek lub obrys) o kontraście co najmniej 3:1;
  - najechanie na przycisk zwykły: neutralne;
  - pola formularzy: obramowanie interaktywne co najmniej 3:1;
  - fokus: obramowanie i poświata akcentu, z klawiatury obrys 2 px.
- **Promienie zaokrągleń:** `--r-2xs` 3px · `--r-xs` 6px · `--r-sm` 8px · `--r` 12px · `--r-pill`.
- **Cienie:** `--elev-1` (karty), `--elev-2` (uniesione), `--elev-3` (okna modalne).

## Kontrola

```
node agent-ui/scripts/build-tokens.js      # generuje public/tokens.css
node agent-ui/scripts/contrast-check.js    # kod 1 przy naruszeniu; --md wypisuje tabelę
```

## Tokeny

| Krok | Jasny | Ciemny | Rola |
|---|---|---|---|
| neutral-0 | `#ffffff` | `#0d151e` | powierzchnia (biel) — tylko jasny |
| neutral-1 | `#f9fcfe` | `#0d151e` | tło subtelne / pas boczny |
| neutral-2 | `#f3f8fc` | `#151e28` | tło aplikacji |
| neutral-3 | `#ebf3f8` | `#19242f` | tło komponentu |
| neutral-4 | `#e4edf4` | `#1e2a37` | najechanie |
| neutral-5 | `#dde7ee` | `#23303e` | aktywny |
| neutral-6 | `#d4e1ea` | `#2b3949` | obramowanie subtelne (nieinteraktywne) |
| neutral-7 | `#c5d3de` | `#39495b` | obramowanie domyślne |
| neutral-8 | `#7e8e9a` | `#637486` | obramowanie interaktywne (≥3:1) |
| neutral-9 | `#657785` | `#738292` | neutralne tło pełne |
| neutral-10 | `#546a7a` | `#8c9aa9` | tekst trzeciorzędny (≥4.5:1) |
| neutral-11 | `#3e5769` | `#b3c0ce` | tekst drugorzędny (≥6:1 jasny / ≥7:1 ciemny) |
| neutral-12 | `#092435` | `#e8eff8` | tekst główny |
| accent-3 | `#e4f3fe` | `#0d344b` | tło akcentu (zaznaczenie) |
| accent-4 | `#d3ecfe` | `#0b3c58` | tło akcentu mocne |
| accent-7 | `#78c7fd` | `#0e6a9b` | obramowanie akcentu |
| accent-8 | `#2a93d1` | `#017cb7` | pierścień fokusu, obramowanie akcentu (≥3:1) |
| accent-9 | `#057bb5` | `#3a9dda` | akcent — działania główne |
| accent-10 | `#036da1` | `#55aee8` | akcent pod kursorem |
| accent-11 | `#036da1` | `#6bbaf0` | tekst w kolorze akcentu (≥4.5:1) |
| success-3 | `#dff7e8` | `#122d1f` | tło |
| success-6 | `#b1e4c4` | `#1b5136` | obramowanie |
| success-11 | `#027646` | `#5cca93` | tekst/ikona/tło pełne |
| warning-3 | `#feeddd` | `#312410` | tło |
| warning-6 | `#f7cda6` | `#5a3f16` | obramowanie |
| warning-11 | `#965802` | `#dda552` | tekst/ikona/tło pełne |
| danger-3 | `#ffebe8` | `#3b1d1a` | tło |
| danger-6 | `#ffc6bd` | `#6b312d` | obramowanie |
| danger-11 | `#b63328` | `#ff8b81` | tekst/ikona/tło pełne |
| cat-cyan-strong | `#0c8fa7` | `#0a96af` | kategoria (wykresy, diagramy, metody HTTP, fazy) |
| cat-blue | `#3b76bf` | `#4c88d3` | kategoria (wykresy, diagramy, metody HTTP, fazy) |
| cat-teal | `#0a8287` | `#1c989e` | kategoria (wykresy, diagramy, metody HTTP, fazy) |
| cat-purple | `#8861c4` | `#956ed2` | kategoria (wykresy, diagramy, metody HTTP, fazy) |
| cat-green | `#32844a` | `#4a9a5e` | kategoria (wykresy, diagramy, metody HTTP, fazy) |
| cat-crimson | `#ba5561` | `#c8626d` | kategoria (wykresy, diagramy, metody HTTP, fazy) |
| cat-orange | `#b1601c` | `#c16e2d` | kategoria (wykresy, diagramy, metody HTTP, fazy) |
| cat-indigo | `#5f6cce` | `#6d7cdf` | kategoria (wykresy, diagramy, metody HTTP, fazy) |
| cat-cyan | `#70d5ed` | `#92dff2` | kategoria (wykresy, diagramy, metody HTTP, fazy) |
| cat-magenta | `#b2548d` | `#c06099` | kategoria (wykresy, diagramy, metody HTTP, fazy) |
| cat-wine | `#7d2e3f` | `#e78d9b` | kategoria (wykresy, diagramy, metody HTTP, fazy) |

## Raport kontrastu (wszystkie pary, oba motywy)

Progi: tekst co najmniej 4,5:1 (SC 1.4.3); obramowania kontrolek, fokus, wskaźniki zaznaczenia i grafika co najmniej 3:1 (SC 1.4.11).

| motyw | pierwszy plan | tło | rodzaj | próg | kontrast | wynik |
|---|---|---|---|---|---|---|
| light | text-primary #092435 | bg-app #f3f8fc | text | 4.5:1 | 14.93:1 | OK |
| light | text-primary #092435 | bg-surface #ffffff | text | 4.5:1 | 15.97:1 | OK |
| light | text-primary #092435 | bg-subtle #f9fcfe | text | 4.5:1 | 15.50:1 | OK |
| light | text-primary #092435 | bg-component #ebf3f8 | text | 4.5:1 | 14.22:1 | OK |
| light | text-primary #092435 | bg-hover #e4edf4 | text | 4.5:1 | 13.47:1 | OK |
| light | text-primary #092435 | bg-active #dde7ee | text | 4.5:1 | 12.73:1 | OK |
| light | text-primary #092435 | bg-field #ffffff | text | 4.5:1 | 15.97:1 | OK |
| light | text-primary #092435 | accent-bg #e4f3fe | text | 4.5:1 | 14.10:1 | OK |
| light | text-secondary #3e5769 | bg-app #f3f8fc | text | 4.5:1 | 7.09:1 | OK |
| light | text-secondary #3e5769 | bg-surface #ffffff | text | 4.5:1 | 7.58:1 | OK |
| light | text-secondary #3e5769 | bg-subtle #f9fcfe | text | 4.5:1 | 7.35:1 | OK |
| light | text-secondary #3e5769 | bg-component #ebf3f8 | text | 4.5:1 | 6.75:1 | OK |
| light | text-secondary #3e5769 | bg-hover #e4edf4 | text | 4.5:1 | 6.39:1 | OK |
| light | text-secondary #3e5769 | bg-active #dde7ee | text | 4.5:1 | 6.04:1 | OK |
| light | text-secondary #3e5769 | bg-field #ffffff | text | 4.5:1 | 7.58:1 | OK |
| light | text-secondary #3e5769 | accent-bg #e4f3fe | text | 4.5:1 | 6.69:1 | OK |
| light | text-tertiary #546a7a | bg-app #f3f8fc | text | 4.5:1 | 5.28:1 | OK |
| light | text-tertiary #546a7a | bg-surface #ffffff | text | 4.5:1 | 5.65:1 | OK |
| light | text-tertiary #546a7a | bg-subtle #f9fcfe | text | 4.5:1 | 5.48:1 | OK |
| light | text-tertiary #546a7a | bg-component #ebf3f8 | text | 4.5:1 | 5.03:1 | OK |
| light | text-tertiary #546a7a | bg-hover #e4edf4 | text | 4.5:1 | 4.76:1 | OK |
| light | text-tertiary #546a7a | bg-active #dde7ee | text | 4.5:1 | 4.50:1 | OK |
| light | text-tertiary #546a7a | bg-field #ffffff | text | 4.5:1 | 5.65:1 | OK |
| light | text-tertiary #546a7a | accent-bg #e4f3fe | text | 4.5:1 | 4.99:1 | OK |
| light | accent-text #036da1 | bg-surface #ffffff | text | 4.5:1 | 5.67:1 | OK |
| light | accent-text #036da1 | bg-app #f3f8fc | text | 4.5:1 | 5.30:1 | OK |
| light | accent-text #036da1 | bg-subtle #f9fcfe | text | 4.5:1 | 5.50:1 | OK |
| light | accent-text #036da1 | bg-component #ebf3f8 | text | 4.5:1 | 5.05:1 | OK |
| light | accent-text #036da1 | accent-bg #e4f3fe | text | 4.5:1 | 5.01:1 | OK |
| light | accent-text #036da1 | accent-bg-strong #d3ecfe | text | 4.5:1 | 4.64:1 | OK |
| light | text-on-accent #ffffff | accent #057bb5 | text | 4.5:1 | 4.66:1 | OK |
| light | text-on-accent #ffffff | accent-hover #036da1 | text | 4.5:1 | 5.67:1 | OK |
| light | text-on-inverse #ffffff | bg-inverse #092435 | text | 4.5:1 | 15.97:1 | OK |
| light | success #027646 | success-bg #dff7e8 | text | 4.5:1 | 5.05:1 | OK |
| light | success #027646 | bg-surface #ffffff | text | 4.5:1 | 5.70:1 | OK |
| light | success #027646 | bg-app #f3f8fc | text | 4.5:1 | 5.33:1 | OK |
| light | success #027646 | bg-subtle #f9fcfe | text | 4.5:1 | 5.54:1 | OK |
| light | text-on-status #ffffff | success #027646 | text | 4.5:1 | 5.70:1 | OK |
| light | warning #965802 | warning-bg #feeddd | text | 4.5:1 | 4.97:1 | OK |
| light | warning #965802 | bg-surface #ffffff | text | 4.5:1 | 5.69:1 | OK |
| light | warning #965802 | bg-app #f3f8fc | text | 4.5:1 | 5.32:1 | OK |
| light | warning #965802 | bg-subtle #f9fcfe | text | 4.5:1 | 5.52:1 | OK |
| light | text-on-status #ffffff | warning #965802 | text | 4.5:1 | 5.69:1 | OK |
| light | danger #b63328 | danger-bg #ffebe8 | text | 4.5:1 | 5.24:1 | OK |
| light | danger #b63328 | bg-surface #ffffff | text | 4.5:1 | 6.01:1 | OK |
| light | danger #b63328 | bg-app #f3f8fc | text | 4.5:1 | 5.62:1 | OK |
| light | danger #b63328 | bg-subtle #f9fcfe | text | 4.5:1 | 5.84:1 | OK |
| light | text-on-status #ffffff | danger #b63328 | text | 4.5:1 | 6.01:1 | OK |
| light | info #036da1 | info-bg #e4f3fe | text | 4.5:1 | 5.01:1 | OK |
| light | info #036da1 | bg-surface #ffffff | text | 4.5:1 | 5.67:1 | OK |
| light | info #036da1 | bg-app #f3f8fc | text | 4.5:1 | 5.30:1 | OK |
| light | info #036da1 | bg-subtle #f9fcfe | text | 4.5:1 | 5.50:1 | OK |
| light | text-on-cat #ffffff | cat-blue #3b76bf | text | 4.5:1 | 4.64:1 | OK |
| light | cat-blue #3b76bf | bg-surface #ffffff | graphic | 3:1 | 4.64:1 | OK |
| light | cat-blue #3b76bf | bg-app #f3f8fc | graphic | 3:1 | 4.34:1 | OK |
| light | text-on-cat #ffffff | cat-teal #0a8287 | text | 4.5:1 | 4.61:1 | OK |
| light | cat-teal #0a8287 | bg-surface #ffffff | graphic | 3:1 | 4.61:1 | OK |
| light | cat-teal #0a8287 | bg-app #f3f8fc | graphic | 3:1 | 4.31:1 | OK |
| light | text-on-cat #ffffff | cat-purple #8861c4 | text | 4.5:1 | 4.61:1 | OK |
| light | cat-purple #8861c4 | bg-surface #ffffff | graphic | 3:1 | 4.61:1 | OK |
| light | cat-purple #8861c4 | bg-app #f3f8fc | graphic | 3:1 | 4.31:1 | OK |
| light | text-on-cat #ffffff | cat-green #32844a | text | 4.5:1 | 4.63:1 | OK |
| light | cat-green #32844a | bg-surface #ffffff | graphic | 3:1 | 4.63:1 | OK |
| light | cat-green #32844a | bg-app #f3f8fc | graphic | 3:1 | 4.33:1 | OK |
| light | text-on-cat #ffffff | cat-crimson #ba5561 | text | 4.5:1 | 4.61:1 | OK |
| light | cat-crimson #ba5561 | bg-surface #ffffff | graphic | 3:1 | 4.61:1 | OK |
| light | cat-crimson #ba5561 | bg-app #f3f8fc | graphic | 3:1 | 4.31:1 | OK |
| light | text-on-cat #ffffff | cat-orange #b1601c | text | 4.5:1 | 4.61:1 | OK |
| light | cat-orange #b1601c | bg-surface #ffffff | graphic | 3:1 | 4.61:1 | OK |
| light | cat-orange #b1601c | bg-app #f3f8fc | graphic | 3:1 | 4.31:1 | OK |
| light | text-on-cat #ffffff | cat-indigo #5f6cce | text | 4.5:1 | 4.64:1 | OK |
| light | cat-indigo #5f6cce | bg-surface #ffffff | graphic | 3:1 | 4.64:1 | OK |
| light | cat-indigo #5f6cce | bg-app #f3f8fc | graphic | 3:1 | 4.34:1 | OK |
| light | text-on-cat #ffffff | cat-magenta #b2548d | text | 4.5:1 | 4.62:1 | OK |
| light | cat-magenta #b2548d | bg-surface #ffffff | graphic | 3:1 | 4.62:1 | OK |
| light | cat-magenta #b2548d | bg-app #f3f8fc | graphic | 3:1 | 4.32:1 | OK |
| light | text-on-cat #ffffff | cat-wine #7d2e3f | text | 4.5:1 | 9.00:1 | OK |
| light | cat-wine #7d2e3f | bg-surface #ffffff | graphic | 3:1 | 9.00:1 | OK |
| light | cat-wine #7d2e3f | bg-app #f3f8fc | graphic | 3:1 | 8.41:1 | OK |
| light | m-get #3b76bf | bg-surface #ffffff | graphic | 3:1 | 4.64:1 | OK |
| light | m-post #32844a | bg-surface #ffffff | graphic | 3:1 | 4.63:1 | OK |
| light | m-put #b1601c | bg-surface #ffffff | graphic | 3:1 | 4.61:1 | OK |
| light | m-del #ba5561 | bg-surface #ffffff | graphic | 3:1 | 4.61:1 | OK |
| light | cat-whitebox-text #141a21 | cat-whitebox #f6f8fb | text | 4.5:1 | 16.46:1 | OK |
| light | cat-blackbox-text #ffffff | cat-blackbox #131a22 | text | 4.5:1 | 17.52:1 | OK |
| light | cat-greybox-text #10161d | cat-greybox #98a4b1 | text | 4.5:1 | 7.17:1 | OK |
| light | cat-root-text #ffffff | cat-root #092435 | text | 4.5:1 | 15.97:1 | OK |
| light | cat-cyan-text #092435 | cat-cyan #70d5ed | text | 4.5:1 | 9.45:1 | OK |
| light | cat-cyan-border #0c8fa7 | bg-surface #ffffff | graphic | 3:1 | 3.82:1 | OK |
| light | text-on-rail #ffffff | bg-rail #092435 | text | 4.5:1 | 15.97:1 | OK |
| light | text-on-rail-on #092435 | bg-rail-on #ffffff | text | 4.5:1 | 15.97:1 | OK |
| light | border-interactive #7e8e9a | bg-app #f3f8fc | ui | 3:1 | 3.16:1 | OK |
| light | focus-ring #2a93d1 | bg-app #f3f8fc | ui | 3:1 | 3.17:1 | OK |
| light | accent #057bb5 | bg-app #f3f8fc | ui | 3:1 | 4.36:1 | OK |
| light | border-interactive #7e8e9a | bg-surface #ffffff | ui | 3:1 | 3.37:1 | OK |
| light | focus-ring #2a93d1 | bg-surface #ffffff | ui | 3:1 | 3.39:1 | OK |
| light | accent #057bb5 | bg-surface #ffffff | ui | 3:1 | 4.66:1 | OK |
| light | border-interactive #7e8e9a | bg-subtle #f9fcfe | ui | 3:1 | 3.28:1 | OK |
| light | focus-ring #2a93d1 | bg-subtle #f9fcfe | ui | 3:1 | 3.29:1 | OK |
| light | accent #057bb5 | bg-subtle #f9fcfe | ui | 3:1 | 4.52:1 | OK |
| light | border-interactive #7e8e9a | bg-component #ebf3f8 | ui | 3:1 | 3.01:1 | OK |
| light | focus-ring #2a93d1 | bg-component #ebf3f8 | ui | 3:1 | 3.02:1 | OK |
| light | accent #057bb5 | bg-component #ebf3f8 | ui | 3:1 | 4.15:1 | OK |
| light | border-interactive #7e8e9a | bg-field #ffffff | ui | 3:1 | 3.37:1 | OK |
| light | focus-ring #2a93d1 | bg-field #ffffff | ui | 3:1 | 3.39:1 | OK |
| light | accent #057bb5 | bg-field #ffffff | ui | 3:1 | 4.66:1 | OK |
| light | success #027646 | bg-app #f3f8fc | ui | 3:1 | 5.33:1 | OK |
| light | success #027646 | bg-surface #ffffff | ui | 3:1 | 5.70:1 | OK |
| light | success #027646 | bg-subtle #f9fcfe | ui | 3:1 | 5.54:1 | OK |
| light | success #027646 | bg-component #ebf3f8 | ui | 3:1 | 5.08:1 | OK |
| light | success #027646 | bg-field #ffffff | ui | 3:1 | 5.70:1 | OK |
| light | warning #965802 | bg-app #f3f8fc | ui | 3:1 | 5.32:1 | OK |
| light | warning #965802 | bg-surface #ffffff | ui | 3:1 | 5.69:1 | OK |
| light | warning #965802 | bg-subtle #f9fcfe | ui | 3:1 | 5.52:1 | OK |
| light | warning #965802 | bg-component #ebf3f8 | ui | 3:1 | 5.07:1 | OK |
| light | warning #965802 | bg-field #ffffff | ui | 3:1 | 5.69:1 | OK |
| light | danger #b63328 | bg-app #f3f8fc | ui | 3:1 | 5.62:1 | OK |
| light | danger #b63328 | bg-surface #ffffff | ui | 3:1 | 6.01:1 | OK |
| light | danger #b63328 | bg-subtle #f9fcfe | ui | 3:1 | 5.84:1 | OK |
| light | danger #b63328 | bg-component #ebf3f8 | ui | 3:1 | 5.36:1 | OK |
| light | danger #b63328 | bg-field #ffffff | ui | 3:1 | 6.01:1 | OK |
| dark | text-primary #e8eff8 | bg-app #151e28 | text | 4.5:1 | 14.53:1 | OK |
| dark | text-primary #e8eff8 | bg-surface #151e28 | text | 4.5:1 | 14.53:1 | OK |
| dark | text-primary #e8eff8 | bg-subtle #19242f | text | 4.5:1 | 13.59:1 | OK |
| dark | text-primary #e8eff8 | bg-component #1e2a37 | text | 4.5:1 | 12.58:1 | OK |
| dark | text-primary #e8eff8 | bg-hover #1e2a37 | text | 4.5:1 | 12.58:1 | OK |
| dark | text-primary #e8eff8 | bg-active #23303e | text | 4.5:1 | 11.60:1 | OK |
| dark | text-primary #e8eff8 | bg-field #0d151e | text | 4.5:1 | 15.86:1 | OK |
| dark | text-primary #e8eff8 | accent-bg #0d344b | text | 4.5:1 | 11.26:1 | OK |
| dark | text-secondary #b3c0ce | bg-app #151e28 | text | 4.5:1 | 9.09:1 | OK |
| dark | text-secondary #b3c0ce | bg-surface #151e28 | text | 4.5:1 | 9.09:1 | OK |
| dark | text-secondary #b3c0ce | bg-subtle #19242f | text | 4.5:1 | 8.50:1 | OK |
| dark | text-secondary #b3c0ce | bg-component #1e2a37 | text | 4.5:1 | 7.87:1 | OK |
| dark | text-secondary #b3c0ce | bg-hover #1e2a37 | text | 4.5:1 | 7.87:1 | OK |
| dark | text-secondary #b3c0ce | bg-active #23303e | text | 4.5:1 | 7.26:1 | OK |
| dark | text-secondary #b3c0ce | bg-field #0d151e | text | 4.5:1 | 9.93:1 | OK |
| dark | text-secondary #b3c0ce | accent-bg #0d344b | text | 4.5:1 | 7.05:1 | OK |
| dark | text-tertiary #8c9aa9 | bg-app #151e28 | text | 4.5:1 | 5.86:1 | OK |
| dark | text-tertiary #8c9aa9 | bg-surface #151e28 | text | 4.5:1 | 5.86:1 | OK |
| dark | text-tertiary #8c9aa9 | bg-subtle #19242f | text | 4.5:1 | 5.48:1 | OK |
| dark | text-tertiary #8c9aa9 | bg-component #1e2a37 | text | 4.5:1 | 5.07:1 | OK |
| dark | text-tertiary #8c9aa9 | bg-hover #1e2a37 | text | 4.5:1 | 5.07:1 | OK |
| dark | text-tertiary #8c9aa9 | bg-active #23303e | text | 4.5:1 | 4.67:1 | OK |
| dark | text-tertiary #8c9aa9 | bg-field #0d151e | text | 4.5:1 | 6.39:1 | OK |
| dark | text-tertiary #8c9aa9 | accent-bg #0d344b | text | 4.5:1 | 4.54:1 | OK |
| dark | accent-text #6bbaf0 | bg-surface #151e28 | text | 4.5:1 | 7.94:1 | OK |
| dark | accent-text #6bbaf0 | bg-app #151e28 | text | 4.5:1 | 7.94:1 | OK |
| dark | accent-text #6bbaf0 | bg-subtle #19242f | text | 4.5:1 | 7.42:1 | OK |
| dark | accent-text #6bbaf0 | bg-component #1e2a37 | text | 4.5:1 | 6.87:1 | OK |
| dark | accent-text #6bbaf0 | accent-bg #0d344b | text | 4.5:1 | 6.15:1 | OK |
| dark | accent-text #6bbaf0 | accent-bg-strong #0b3c58 | text | 4.5:1 | 5.50:1 | OK |
| dark | text-on-accent #0d151e | accent #3a9dda | text | 4.5:1 | 6.14:1 | OK |
| dark | text-on-accent #0d151e | accent-hover #55aee8 | text | 4.5:1 | 7.53:1 | OK |
| dark | text-on-inverse #0d151e | bg-inverse #e8eff8 | text | 4.5:1 | 15.86:1 | OK |
| dark | success #5cca93 | success-bg #122d1f | text | 4.5:1 | 7.27:1 | OK |
| dark | success #5cca93 | bg-surface #151e28 | text | 4.5:1 | 8.27:1 | OK |
| dark | success #5cca93 | bg-app #151e28 | text | 4.5:1 | 8.27:1 | OK |
| dark | success #5cca93 | bg-subtle #19242f | text | 4.5:1 | 7.74:1 | OK |
| dark | text-on-status #0d151e | success #5cca93 | text | 4.5:1 | 9.03:1 | OK |
| dark | warning #dda552 | warning-bg #312410 | text | 4.5:1 | 6.89:1 | OK |
| dark | warning #dda552 | bg-surface #151e28 | text | 4.5:1 | 7.67:1 | OK |
| dark | warning #dda552 | bg-app #151e28 | text | 4.5:1 | 7.67:1 | OK |
| dark | warning #dda552 | bg-subtle #19242f | text | 4.5:1 | 7.18:1 | OK |
| dark | text-on-status #0d151e | warning #dda552 | text | 4.5:1 | 8.38:1 | OK |
| dark | danger #ff8b81 | danger-bg #3b1d1a | text | 4.5:1 | 6.73:1 | OK |
| dark | danger #ff8b81 | bg-surface #151e28 | text | 4.5:1 | 7.42:1 | OK |
| dark | danger #ff8b81 | bg-app #151e28 | text | 4.5:1 | 7.42:1 | OK |
| dark | danger #ff8b81 | bg-subtle #19242f | text | 4.5:1 | 6.94:1 | OK |
| dark | text-on-status #0d151e | danger #ff8b81 | text | 4.5:1 | 8.10:1 | OK |
| dark | info #6bbaf0 | info-bg #0d344b | text | 4.5:1 | 6.15:1 | OK |
| dark | info #6bbaf0 | bg-surface #151e28 | text | 4.5:1 | 7.94:1 | OK |
| dark | info #6bbaf0 | bg-app #151e28 | text | 4.5:1 | 7.94:1 | OK |
| dark | info #6bbaf0 | bg-subtle #19242f | text | 4.5:1 | 7.42:1 | OK |
| dark | text-on-cat #0d151e | cat-blue #4c88d3 | text | 4.5:1 | 5.05:1 | OK |
| dark | cat-blue #4c88d3 | bg-surface #151e28 | graphic | 3:1 | 4.62:1 | OK |
| dark | cat-blue #4c88d3 | bg-app #151e28 | graphic | 3:1 | 4.62:1 | OK |
| dark | text-on-cat #0d151e | cat-teal #1c989e | text | 4.5:1 | 5.28:1 | OK |
| dark | cat-teal #1c989e | bg-surface #151e28 | graphic | 3:1 | 4.83:1 | OK |
| dark | cat-teal #1c989e | bg-app #151e28 | graphic | 3:1 | 4.83:1 | OK |
| dark | text-on-cat #0d151e | cat-purple #956ed2 | text | 4.5:1 | 4.76:1 | OK |
| dark | cat-purple #956ed2 | bg-surface #151e28 | graphic | 3:1 | 4.36:1 | OK |
| dark | cat-purple #956ed2 | bg-app #151e28 | graphic | 3:1 | 4.36:1 | OK |
| dark | text-on-cat #0d151e | cat-green #4a9a5e | text | 4.5:1 | 5.31:1 | OK |
| dark | cat-green #4a9a5e | bg-surface #151e28 | graphic | 3:1 | 4.87:1 | OK |
| dark | cat-green #4a9a5e | bg-app #151e28 | graphic | 3:1 | 4.87:1 | OK |
| dark | text-on-cat #0d151e | cat-crimson #c8626d | text | 4.5:1 | 4.74:1 | OK |
| dark | cat-crimson #c8626d | bg-surface #151e28 | graphic | 3:1 | 4.35:1 | OK |
| dark | cat-crimson #c8626d | bg-app #151e28 | graphic | 3:1 | 4.35:1 | OK |
| dark | text-on-cat #0d151e | cat-orange #c16e2d | text | 4.5:1 | 4.84:1 | OK |
| dark | cat-orange #c16e2d | bg-surface #151e28 | graphic | 3:1 | 4.43:1 | OK |
| dark | cat-orange #c16e2d | bg-app #151e28 | graphic | 3:1 | 4.43:1 | OK |
| dark | text-on-cat #0d151e | cat-indigo #6d7cdf | text | 4.5:1 | 4.90:1 | OK |
| dark | cat-indigo #6d7cdf | bg-surface #151e28 | graphic | 3:1 | 4.49:1 | OK |
| dark | cat-indigo #6d7cdf | bg-app #151e28 | graphic | 3:1 | 4.49:1 | OK |
| dark | text-on-cat #0d151e | cat-magenta #c06099 | text | 4.5:1 | 4.70:1 | OK |
| dark | cat-magenta #c06099 | bg-surface #151e28 | graphic | 3:1 | 4.31:1 | OK |
| dark | cat-magenta #c06099 | bg-app #151e28 | graphic | 3:1 | 4.31:1 | OK |
| dark | text-on-cat #0d151e | cat-wine #e78d9b | text | 4.5:1 | 7.59:1 | OK |
| dark | cat-wine #e78d9b | bg-surface #151e28 | graphic | 3:1 | 6.95:1 | OK |
| dark | cat-wine #e78d9b | bg-app #151e28 | graphic | 3:1 | 6.95:1 | OK |
| dark | m-get #4c88d3 | bg-surface #151e28 | graphic | 3:1 | 4.62:1 | OK |
| dark | m-post #4a9a5e | bg-surface #151e28 | graphic | 3:1 | 4.87:1 | OK |
| dark | m-put #c16e2d | bg-surface #151e28 | graphic | 3:1 | 4.43:1 | OK |
| dark | m-del #c8626d | bg-surface #151e28 | graphic | 3:1 | 4.35:1 | OK |
| dark | cat-whitebox-text #141a21 | cat-whitebox #f6f8fb | text | 4.5:1 | 16.46:1 | OK |
| dark | cat-blackbox-text #ffffff | cat-blackbox #131a22 | text | 4.5:1 | 17.52:1 | OK |
| dark | cat-greybox-text #10161d | cat-greybox #98a4b1 | text | 4.5:1 | 7.17:1 | OK |
| dark | cat-root-text #0d151e | cat-root #e8eff8 | text | 4.5:1 | 15.86:1 | OK |
| dark | cat-cyan-text #0d151e | cat-cyan #92dff2 | text | 4.5:1 | 12.30:1 | OK |
| dark | cat-cyan-border #0a96af | bg-surface #151e28 | graphic | 3:1 | 4.80:1 | OK |
| dark | text-on-rail #ffffff | bg-rail #0d151e | text | 4.5:1 | 18.37:1 | OK |
| dark | text-on-rail-on #e8eff8 | bg-rail-on #1e2a37 | text | 4.5:1 | 12.58:1 | OK |
| dark | border-interactive #637486 | bg-app #151e28 | ui | 3:1 | 3.50:1 | OK |
| dark | focus-ring #017cb7 | bg-app #151e28 | ui | 3:1 | 3.66:1 | OK |
| dark | accent #3a9dda | bg-app #151e28 | ui | 3:1 | 5.62:1 | OK |
| dark | border-interactive #637486 | bg-surface #151e28 | ui | 3:1 | 3.50:1 | OK |
| dark | focus-ring #017cb7 | bg-surface #151e28 | ui | 3:1 | 3.66:1 | OK |
| dark | accent #3a9dda | bg-surface #151e28 | ui | 3:1 | 5.62:1 | OK |
| dark | border-interactive #637486 | bg-subtle #19242f | ui | 3:1 | 3.28:1 | OK |
| dark | focus-ring #017cb7 | bg-subtle #19242f | ui | 3:1 | 3.42:1 | OK |
| dark | accent #3a9dda | bg-subtle #19242f | ui | 3:1 | 5.26:1 | OK |
| dark | border-interactive #637486 | bg-component #1e2a37 | ui | 3:1 | 3.03:1 | OK |
| dark | focus-ring #017cb7 | bg-component #1e2a37 | ui | 3:1 | 3.17:1 | OK |
| dark | accent #3a9dda | bg-component #1e2a37 | ui | 3:1 | 4.87:1 | OK |
| dark | border-interactive #637486 | bg-field #0d151e | ui | 3:1 | 3.83:1 | OK |
| dark | focus-ring #017cb7 | bg-field #0d151e | ui | 3:1 | 4.00:1 | OK |
| dark | accent #3a9dda | bg-field #0d151e | ui | 3:1 | 6.14:1 | OK |
| dark | success #5cca93 | bg-app #151e28 | ui | 3:1 | 8.27:1 | OK |
| dark | success #5cca93 | bg-surface #151e28 | ui | 3:1 | 8.27:1 | OK |
| dark | success #5cca93 | bg-subtle #19242f | ui | 3:1 | 7.74:1 | OK |
| dark | success #5cca93 | bg-component #1e2a37 | ui | 3:1 | 7.16:1 | OK |
| dark | success #5cca93 | bg-field #0d151e | ui | 3:1 | 9.03:1 | OK |
| dark | warning #dda552 | bg-app #151e28 | ui | 3:1 | 7.67:1 | OK |
| dark | warning #dda552 | bg-surface #151e28 | ui | 3:1 | 7.67:1 | OK |
| dark | warning #dda552 | bg-subtle #19242f | ui | 3:1 | 7.18:1 | OK |
| dark | warning #dda552 | bg-component #1e2a37 | ui | 3:1 | 6.64:1 | OK |
| dark | warning #dda552 | bg-field #0d151e | ui | 3:1 | 8.38:1 | OK |
| dark | danger #ff8b81 | bg-app #151e28 | ui | 3:1 | 7.42:1 | OK |
| dark | danger #ff8b81 | bg-surface #151e28 | ui | 3:1 | 7.42:1 | OK |
| dark | danger #ff8b81 | bg-subtle #19242f | ui | 3:1 | 6.94:1 | OK |
| dark | danger #ff8b81 | bg-component #1e2a37 | ui | 3:1 | 6.43:1 | OK |
| dark | danger #ff8b81 | bg-field #0d151e | ui | 3:1 | 8.10:1 | OK |
