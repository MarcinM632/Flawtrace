# Flawtrace Cloud: co zrobić, żeby wystartować (krok po kroku)

Kod, strona, konta, płatności, izolacja klientów i pliki wdrożeniowe są gotowe w repozytorium. Tu jest to, czego **nie da się zrobić z poziomu kodu**: konta u firm trzecich, serwer, domena, sprawy prawne, pierwsze uruchomienie i test na żywo.

Kolejność ma znaczenie. Przy każdym kroku jest orientacyjny czas i koszt (ceny usług zmieniają się, sprawdź aktualne).

## Co jest sprawdzone, a co nie (czytaj najpierw)

| Sprawdzone testami (167 przechodzi) | NIE sprawdzone, zrób w kroku 8 |
| --- | --- |
| Pętla agenta na kluczu API z atrapą dostawcy (Anthropic, OpenAI, Gemini), narzędzia, limity | Prawdziwy klucz API z prawdziwym modelem: jakość raportów na modelu innym niż Claude |
| Konta, sesje, reset hasła, zaproszenia, limity prób, izolacja dwóch workspace'ów | Budowa obrazu Dockera (na komputerze, na którym pracowałem, Docker nie działał; sprawdzi to CI na GitHubie) |
| Stripe z atrapą Stripe: checkout, webhook z podpisem, aktywacja, nieudana płatność, anulowanie | Prawdziwy Stripe i prawdziwe maile (Resend) |
| Blokada adresów wewnętrznych (SSRF), szyfrowanie kluczy, eksport i usunięcie danych | Zachowanie pod obciążeniem wielu klientów naraz, Chromium w kontenerze |

Strony prawne (`/privacy`, `/terms`, `/dpa`, `/security`) to **szkice** napisane tak, żeby zgadzały się z tym, co kod faktycznie robi. Nie zastępują prawnika (krok 6).

---

## Krok 1. Decyzje (30 minut, 0 zł)

1. **Nazwa i domena.** "Flawtrace" jest nazwą roboczą. Sprawdź, czy nazwa jest wolna (wyszukiwarka, rejestr znaków towarowych EUIPO/UPRP, wolna domena `.com` lub `.io`). Jeśli zmieniasz nazwę, zmień ją w `agent-ui/cloud/site/` (wyszukaj "Flawtrace") i w `logo.svg`.
2. **Kto sprzedaje.** Do pobierania opłat od firm potrzebujesz działalności (jednoosobowej lub spółki) z NIP. Faktury i VAT: porozmawiaj z księgowym o sprzedaży usługi cyfrowej do firm w UE (VAT OSS, odwrotne obciążenie dla firm z numerem VAT UE).
3. **Cena.** Na start wpisz jedną cenę za workspace (do 5 osób). Jeśli nie wiesz, zacznij od bety za darmo (krok 9) i cenę ustal po rozmowach z pilotami.
4. **Model biznesowy w jednym zdaniu**, żeby nie zgubić się później: klient płaci Tobie abonament za workspace, a za tokeny płaci swojemu dostawcy AI własnym kluczem.

## Krok 2. Domena (15 minut, ok. 50 zł rocznie)

1. Kup domenę u dowolnego rejestratora (np. OVH, Cloudflare, nazwa.pl, Namecheap).
2. Zaloguj się do panelu DNS. Później (krok 3) dodasz tam rekordy wskazujące na serwer.
3. Włącz blokadę transferu i autoodnawianie, żeby domeny nie stracić.

## Krok 3. Serwer (1-2 godziny, kilkanaście euro miesięcznie)

Zalecane: VPS w UE (np. Hetzner Cloud, OVH, Scaleway), Ubuntu 24.04, **min. 8 GB RAM i 4 vCPU**. Każdy aktywny klient to osobny proces (do ok. 770 MB), a test UI dodaje przeglądarkę. Zacznij od `MAX_RUNNING_TENANTS=8` i zwiększaj, gdy zobaczysz zużycie.

1. Utwórz serwer i dodaj swój klucz SSH (nie używaj hasła).
2. Zaloguj się: `ssh root@ADRES_IP`. Utwórz zwykłego użytkownika z sudo i wyłącz logowanie root przez SSH.
3. Zapora: `ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw allow 443/udp && ufw enable`.
4. Automatyczne łatki bezpieczeństwa: `apt install unattended-upgrades`.
5. Zainstaluj Dockera: <https://docs.docker.com/engine/install/ubuntu/> (oficjalny skrypt lub repozytorium), potem `docker compose version`, żeby sprawdzić.
6. **Zablokuj dostęp kontenerów do usługi metadanych chmury** (adres 169.254.169.254). Kod już blokuje takie wywołania, to jest drugi pas bezpieczeństwa:
   `iptables -I DOCKER-USER -d 169.254.169.254 -j DROP` (i zapisz regułę, np. pakiet `iptables-persistent`).
7. **Szyfrowanie dysku.** Strona `/security` mówi, że dyski są szyfrowane. Zrób jedno z dwóch: (a) włącz szyfrowanie wolumenu u dostawcy lub LUKS na wolumenie z danymi Dockera, albo (b) usuń to zdanie z `security.html` i `dpa.html`. Nie zostawiaj nieprawdziwego zdania.
8. W panelu DNS dodaj rekordy **A**: `@` (strona) i `app` (produkt) wskazujące na adres IP serwera, oraz `www` jako CNAME do `@`. Propagacja trwa od minut do godzin.

## Krok 4. Poczta: Resend (30 minut, 0 zł na start)

Bez tego nikt nie dostanie maila potwierdzającego ani resetu hasła.

1. Załóż konto na <https://resend.com>.
2. Dodaj swoją domenę w "Domains" i dodaj w DNS rekordy, które pokaże (SPF, DKIM). Poczekaj na status "Verified".
3. Utwórz klucz API ("API Keys", uprawnienie do wysyłania). Zapisz go, zobaczysz go raz.
4. W `.env` (krok 7): `RESEND_API_KEY=...` i `MAIL_FROM=Flawtrace <no-reply@twojadomena>`.
5. Dodaj też rekord DMARC (np. `v=DMARC1; p=none; rua=mailto:ty@twojadomena`), żeby maile nie lądowały w spamie.

## Krok 5. Płatności: Stripe (1-3 dni przez weryfikację firmy, 0 zł miesięcznie, prowizja od płatności)

Możesz to zrobić **po** starcie bety (krok 9). Bez kluczy Stripe cała chmura działa jako darmowa beta.

1. Załóż konto na <https://stripe.com>, uzupełnij dane firmy i konto bankowe (Stripe weryfikuje to kilka dni).
2. **Najpierw tryb testowy** (przełącznik "Test mode"). Wszystko poniżej zrób w teście, potem powtórz na żywo.
3. "Product catalog" → dodaj produkt "Flawtrace Team workspace" z **trzema cenami cyklicznymi** w USD i skopiuj ich identyfikatory (`price_...`):
   - $15 co miesiąc → `STRIPE_PRICE_MONTHLY`;
   - $78 co 6 miesięcy (Billing period: Custom, 6 months) → `STRIPE_PRICE_SEMIANNUAL`;
   - $144 co rok → `STRIPE_PRICE_ANNUAL`.
   Kwoty muszą się zgadzać z cennikiem w `.env` (`PRICE_MONTHLY/SEMIANNUAL/ANNUAL`, `PRICE_CURRENCY`). Gdy coś się nie zgadza, gateway zapisze ostrzeżenie w logu i nie sprzeda tego okresu (checkout zwróci 503), żeby klient nie zapłacił innej kwoty niż na stronie.
4. "Developers" → "API keys" → skopiuj klucz tajny (`sk_test_...`) do `STRIPE_SECRET_KEY`.
5. "Developers" → "Webhooks" → "Add endpoint":
   - adres: `https://app.TWOJADOMENA/_gw/stripe/webhook`
   - zdarzenia: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.paid`
   - skopiuj "Signing secret" (`whsec_...`) do `STRIPE_WEBHOOK_SECRET`.
6. "Settings" → "Billing" → "Customer portal": włącz anulowanie subskrypcji, zmianę karty, historię faktur i **zmianę planu** (dodaj trzy ceny z punktu 3, żeby klient mógł przejść np. z miesięcznego na roczny; nowy okres trafia do gatewaya webhookiem `customer.subscription.updated`). Bez tego przycisk "Manage billing" zwróci błąd.
7. VAT: włącz Stripe Tax (Settings → Tax), potem ustaw `STRIPE_TAX=1`. Ustal z księgowym stawki i numer VAT UE klientów.
8. Wybierz model triala w `.env`:
   - `TRIAL_REQUIRES_CARD=0` (domyślnie): trial bez karty, checkout dostępny w trakcie i wymagany po końcu triala. Kto zasubskrybuje w trakcie triala, nie traci pozostałych dni: Stripe dostaje dokładną datę końca triala i pobiera pierwszą płatność dopiero wtedy (checkout pokazuje „Due today $0.00” i datę pierwszej płatności);
   - `TRIAL_REQUIRES_CARD=1`: klasyczny „karta od razu” — po rejestracji klient trafia na checkout, trial liczy Stripe, pierwsza opłata po trialu;
   - `TRIAL_DAYS=0`: płatność od razu, bez triala.
9. Co klient widzi po kolei (sprawdź wizualnie na komputerze i telefonie):
   1. Cennik na stronie → przycisk przy wybranym okresie → rejestracja z ramką „Selected plan: …”.
   2. Potwierdzenie e-maila → przy `TRIAL_REQUIRES_CARD=0` aplikacja (trial), przy `=1` od razu checkout.
   3. Checkout: wybór okresu (zaznaczony ten z cennika), podsumowanie z kwotą „Due today” (przy trialu $0.00 i data pierwszej płatności), zgoda na regulamin z okresem odnowienia, przycisk do Stripe. Na telefonie kwota jest też tuż nad przyciskiem.
   4. Strona Stripe → „You are all set” (przy trialu z datą pierwszej płatności) → po 5 s aplikacja.
   5. Ponowne wejście na `/_gw/checkout` przy aktywnej subskrypcji: tylko „You are subscribed” z planem, bez podsumowania i kwoty.
   6. Anulowanie na stronie Stripe: powrót z komunikatem „Payment was cancelled. Nothing was charged.”
10. Test całego flow (kartą testową `4242 4242 4242 4242`, dowolna data w przyszłości, dowolny CVC): rejestracja → potwierdzenie e-maila → `/_gw/checkout` (dane do faktury, zgoda) → płatność w Stripe → strona „You are all set” → aplikacja. Sprawdź, że workspace ma status "Active". Potem anuluj w portalu i sprawdź, że dostęp się kończy, a właściciel trafia z powrotem na checkout. Płatność odroczoną (np. polecenie zapłaty SEPA) sprawdzisz testowym numerem IBAN z dokumentacji Stripe: dostęp ma się włączyć dopiero po jej zaksięgowaniu.
11. Dopiero gdy test działa: przełącz Stripe na tryb żywy, wklej klucze żywe (`sk_live_...`, nowy webhook z nowym `whsec_...`) i żywe identyfikatory trzech cen.
12. Klient Enterprise (faktura, przelew): po podpisaniu umowy i opłaceniu faktury uruchom na serwerze `node cloud/admin.js enterprise <email-właściciela> <liczba-miejsc> <miesiące>`, np. `... enterprise anna@firma.pl 20 12`. Ustawia plan Enterprise, limit osób i opłacony okres (kolejne wywołanie przedłuża od obecnego końca). Po końcu okresu dostęp wygasa; `node cloud/admin.js show <email>` pokazuje plan, miejsca i datę końca.

## Krok 6. Sprawy prawne (kilka dni, koszt zależy od prawnika)

1. **Prawnik od IT/RODO** powinien przejrzeć: `privacy.html`, `terms.html`, `dpa.html`, `security.html`, `subprocessors.html`, `cookies.html` w `agent-ui/cloud/site/legal/`. Daj mu też `docs/RELEASE-CHECKLIST.md` i `docs/CLOUD.md`, żeby widział, co system faktycznie robi. Szczególnie: odpowiedzialność (pkt 11 regulaminu), prawo właściwe, okresy przechowywania, rola procesora/administratora, transfery poza EOG.
2. Uzupełnij w `.env`: `COMPANY_NAME`, `COMPANY_ADDRESS`, `COMPANY_ID` (NIP/KRS), `CONTACT_EMAIL`, `GOVERNING_LAW`, `HOSTING_PROVIDER`, `HOSTING_REGION`. **Serwer odmówi startu w trybie publicznym, dopóki te pola mają wartości zastępcze.**
3. **Rejestr czynności przetwarzania (art. 30 RODO)**: jako firma musisz go prowadzić. To dokument wewnętrzny (prosty arkusz): jakie dane, po co, komu przekazujesz, jak długo.
4. **Umowy powierzenia z Twoimi podprocesorami**: dostawca serwera, Stripe, Resend. U wszystkich trzech akceptuje się je online w panelu (szukaj "Data Processing Addendum"). Zapisz daty akceptacji.
5. **Regulaminy dostawców modeli.** Klient używa własnego klucza API, co jest standardowym scenariuszem, ale przeczytaj aktualne warunki Anthropic, OpenAI i Google dotyczące aplikacji pośredniczących i upewnij się, że nic nie zabrania takiego użycia. Jeśli masz wątpliwości, zapytaj ich pomoc handlową.
6. **Strona `/subprocessors`** musi odpowiadać prawdzie. Jeśli dodasz nową usługę przetwarzającą dane klientów, zaktualizuj ją i wyślij klientom ogłoszenie 14 dni wcześniej (tak obiecuje dokument).
7. Jeśli sprzedajesz też konsumentom (nie firmom), dojdą przepisy o prawie odstąpienia od umowy. Ten produkt jest pisany pod firmy.

## Krok 7. Pierwsze uruchomienie na serwerze (1 godzina)

```bash
# na serwerze
git clone https://github.com/MarcinM632/Flawtrace.git && cd Flawtrace
cp .env.example .env
nano .env          # wypełnij: SITE_HOST, APP_HOST, ACME_EMAIL, dane firmy, RESEND_*, BETA_CODE
```

Sekrety wygeneruj poleceniem `openssl rand -hex 32` i wklej do:
- `CLOUD_MASTER_SECRET`: **skopiuj go od razu do menedżera haseł**. Bez niego zapisane tokeny i klucze AI klientów są nie do odczytania. Nie trzymaj go w tym samym miejscu co kopie zapasowe danych.

Uruchom:

```bash
docker compose up -d --build     # pierwsza budowa trwa kilka minut (przeglądarka Chromium ma ok. 1 GB)
docker compose ps                # oba kontenery mają działać
docker compose logs -f gateway   # ostrzeżenia na starcie mówią, czego brakuje
```

Po minucie otwórz `https://TWOJADOMENA` (strona) i `https://app.TWOJADOMENA` (logowanie). Certyfikaty HTTPS Caddy pobiera sam, gdy DNS już wskazuje na serwer (porty 80 i 443 muszą być otwarte).

Zostaw `STRIPE_SECRET_KEY` puste. Wtedy nikt nie jest proszony o kartę, a plan pokazuje "Free during the beta".

## Krok 8. Test na żywo, zanim ktokolwiek poza Tobą wejdzie (2-3 godziny)

Przejdź to **jako zwykły klient, z innej przeglądarki lub okna prywatnego**. Zapisuj, co nie działa.

- [ ] Strona główna ładuje się po HTTPS, bez ostrzeżeń, wygląda dobrze na telefonie.
- [ ] Rejestracja z prawdziwym mailem: przychodzi mail potwierdzający (sprawdź też spam). Link działa.
- [ ] Logowanie, wylogowanie, "Forgot password" (mail z resetem, hasło się zmienia, stare sesje wylogowane).
- [ ] W aplikacji: Settings → AI provider → Anthropic → model `claude-sonnet-5-5` → wklej **swój** klucz → Test. Powinno odpowiedzieć OK.
- [ ] Sources: dodaj publiczną specyfikację (np. Petstore z `https://petstore3.swagger.io/api/v3/openapi.json`) i adres API. Dodaj publiczne repozytorium `https://` (np. `https://github.com/swagger-api/swagger-petstore.git`).
- [ ] Spróbuj wpisać adres wewnętrzny (`http://127.0.0.1`, `http://169.254.169.254`): ma zostać odrzucony.
- [ ] Onboarding → "Scan only (free)" → potem pełny przebieg z poziomem Quick.
- [ ] Uruchom **QA MCP** na API testowym, **Static**, **Test design** i **UI test** na publicznej stronie. Zobacz, czy raporty mają sensowną jakość i czy weryfikator działa.
- [ ] Konto: zaproś drugą osobę (drugi adres), przyjmij zaproszenie.
- [ ] Konto: pobierz "Account data" i "All workspace data". Rozpakuj `.tar.gz` i sprawdź, że nie ma w nim kluczy AI.
- [ ] Konto: usuń workspace. Sprawdź, że nie da się zalogować i że folder zniknął (`docker compose exec gateway ls /data/orgs`).
- [ ] Zatrzymaj na chwilę kontener (`docker compose restart gateway`) i sprawdź, że po minucie wszystko wraca, a dane klienta są na miejscu.
- [ ] Drugi workspace nie widzi danych pierwszego (zrób dwa konta, w jednym wpisz źródła).

Jeśli UI test nie startuje przeglądarki w kontenerze: `docker compose logs gateway` i plik `server.log` w folderze workspace'u (`docker compose exec gateway sh -c 'tail -50 /data/orgs/*/server.log'`). Typowa przyczyna to brak uprawnień Chromium. Obraz używa `--no-sandbox`, więc granicą bezpieczeństwa jest kontener (ograniczony, bez uprawnień, nieuprzywilejowany użytkownik).

## Krok 9. Kopie zapasowe i monitoring (1-2 godziny)

**Kopie zapasowe.** Dane klientów to folder `/data` w wolumenie `flawtrace-data`. Użyj narzędzia, które szyfruje kopie (np. `restic`) i wysyłaj je poza serwer (Backblaze B2, Hetzner Storage Box, dowolny S3).

1. Zainstaluj restic na hoście, utwórz repozytorium (`restic init`), zapisz hasło repozytorium w menedżerze haseł.
2. Skrypt wykonywany co noc z crona:
   ```bash
   docker compose exec -T gateway node agent-ui/cloud/backup.js     # spójna migawka bazy kont
   restic backup /var/lib/docker/volumes/flawtrace_flawtrace-data/_data --exclude '*/repos' --exclude '*/home' --exclude '*.log'
   restic forget --keep-daily 35 --prune
   ```
   Liczba dni (35) musi zgadzać się z `BACKUP_DAYS` w `.env`, bo ta liczba jest na stronach prawnych.
3. **Przetestuj odtworzenie** na drugim, pustym serwerze lub folderze. Kopia, której nie próbowano odtworzyć, nie jest kopią.
4. Pamiętaj: do odczytu tokenów po odtworzeniu potrzebny jest `CLOUD_MASTER_SECRET`.

**Monitoring.**
1. Darmowy UptimeRobot (lub Better Stack): sprawdzaj `https://app.TWOJADOMENA/healthz` i `https://TWOJADOMENA/` co 5 minut, alert mailem/SMS.
2. Alert na zapełnienie dysku (np. skrypt cron z `df`, albo alerty dostawcy serwera).
3. Raz na tydzień: `docker compose exec gateway node agent-ui/cloud/admin.js stats`.

## Krok 10. Zamknięta beta (2-4 tygodnie)

1. W `.env` ustaw `BETA_CODE=jakieśhasło` i `docker compose up -d`. Teraz zarejestruje się tylko ten, komu podasz kod.
2. Zaproś 3-5 osób z QA (znajomi, była praca). Powiedz uczciwie, że to beta. Poproś o: pierwszy dzień (gdzie utknęli), jeden prawdziwy task, ocenę raportu (ile prawdy, ile zmyślenia).
3. Zbieraj: czy podpięli źródła, czy mają klucz API (częsty zgrzyt: subskrypcja Claude.ai to nie klucz API), czy zapłaciliby i ile.
4. Narzędzie dla Ciebie:
   ```bash
   docker compose exec gateway node agent-ui/cloud/admin.js list
   docker compose exec gateway node agent-ui/cloud/admin.js show jan@firma.pl
   docker compose exec gateway node agent-ui/cloud/admin.js extend-trial jan@firma.pl 30
   docker compose exec gateway node agent-ui/cloud/admin.js suspend jan@firma.pl      # nadużycie
   ```
5. Co tydzień aktualizuj: `git pull && docker compose up -d --build`.

## Krok 11. Włączenie płatności i start publiczny

Warunki, żeby to zrobić:
- [ ] Beta pokazała, że ktoś by zapłacił (to jest ważniejsze niż kod).
- [ ] Krok 5 (Stripe) przeszedł w trybie testowym i na żywo (jedna prawdziwa płatność, potem zwrot).
- [ ] Prawnik przejrzał dokumenty (krok 6) i pola `COMPANY_*` są wypełnione.
- [ ] Zdania na stronie `/security` są prawdziwe: dyski zaszyfrowane, kopie zaszyfrowane i trzymane `BACKUP_DAYS` dni, dostęp do serwerów ograniczony i zapisywany, region i dostawca zgodni z `HOSTING_*`.
- [ ] Zdanie "Our staff do not open workspace content unless you ask us for support" jest regułą, której będziesz przestrzegać.

Potem w `.env`: klucze Stripe żywe i trzy żywe ceny (`STRIPE_PRICE_MONTHLY/SEMIANNUAL/ANNUAL`), usuń `BETA_CODE`, `docker compose up -d`. Dopisz do strony głównej, jak się z Tobą skontaktować, i opublikuj (LinkedIn, grupy QA, Reddit r/QualityAssurance, Product Hunt).

---

## Czego jeszcze nie ma (zaplanowane, nie blokuje bety)

| Brak | Skutek dla klienta | Jak to obejść / kiedy |
| --- | --- | --- |
| Kontener na każdego klienta (dziś proces na klienta) | Silna, ale słabsza izolacja; szczegóły w `docs/CLOUD.md` | Przed pierwszymi dużymi klientami lub gdy ktoś zażąda |
| Środowiska testowe za VPN | Chmura nie dosięgnie takiego środowiska | Wersja samodzielnie hostowana (ta sama aplikacja, `npm start`) |
| Prywatne repozytoria | Tylko publiczne `https://` | Konektory GitHub/GitLab z tokenem (następny duży krok) |
| Autotesty pytest w chmurze | Wyłączone, bo oznaczałoby wykonywanie cudzego kodu na Twoim serwerze | Dopiero z piaskownicą (kontener na uruchomienie) |
| PostgreSQL | SQLite wystarcza na jeden serwer i pierwsze setki klientów | Przepisać tylko `cloud/db.js` |
| Strona statusu, formularz wsparcia | Wsparcie przez e-mail | Gdy będzie ruch |
