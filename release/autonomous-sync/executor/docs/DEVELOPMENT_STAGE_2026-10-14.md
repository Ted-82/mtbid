# Rozwój REXBID — stan i kolejność prac, 14.10.2026

## Wykonany etap

- Produkcja: https://rexbid.pl, Worker `rexbid-production-preflight`, wersja **aaa709e1-24eb-4985-aa73-851c2baa0a05**. D1 `c8a30088-70af-43a6-9a7f-c4018279d37d`; brak powiązania z bazą mtbid lub stagingu.
- Staging: https://rexbid-auth-test.tedn828.workers.dev, wersja **0db16a3d-d7d9-4c05-95e4-1041f799cd1b**. Jego konta, portal, pliki i MFA zachowane; bez migracji i zapisów danych stagingu.
- Produkcyjne Auth, portal i załączniki nadal OFF. Katalog, karty, galerie, zapisane historie, V4, lokalne ulubione i kontakt działają. Jedynie produkcyjny harmonogram nowych odczytów został włączony; stary Sync/fallback i stagingowy Cron pozostają OFF.
- Kod i dane aktualizuje obecne zlecenie. Nie kupiono usługi, nie wykonano pusha ani zmian DNS, poczty, domeny, haseł lub MFA.

### Automatyczne odświeżanie i rzetelność danych

Dodano trwały mechanizm w `sync/automatic-refresh.cjs`, migrację `0008_automatic_refresh.sql`, generator konfiguracji, odseparowany handler Cron i regresje. Harmonogram Cloudflare odczytano z API po wdrożeniu: **co 15 minut**. Dokładny wynik pierwszego samoczynnego przebiegu i końcowe liczniki zapisuje sekcja końcowej kontroli poniżej; sam deploy nie był traktowany jako dowód wykonania Cron.

Limity: **8 prób/przebieg, 500/dzień, 12 000/miesiąc, 40 nowych ofert/dzień**, rezerwa dostawcy 500. Kontrola `/usage` co dobę; każda próba i ponowienie liczone przed transportem. Terminy 30 min/6 h/7 dni określają priorytet kolejki, nie gwarantowaną świeżość każdej oferty. Przeglądanie strony czyta D1/cache i nie wywołuje providera. Nie uruchomiono rzeczywistego licytowania.

Trzy kontrolowane uruchomienia tego samego mechanizmu przed Cron wykonały 24 próby: 18 odpowiedzi i 6 HTTP 404, bez ponowień. Dodały 39 ofert (19 Copart, 20 IAAI), odświeżyły 6 istniejących (1 Copart, 5 IAAI). Odrzucono jeden nowy rekord; 15 istniejących otrzymało stan błędu bez utraty wcześniejszych danych: 9 niezgodności LOT/platformy i 6 HTTP 404. To nie jest pusta historia ani potwierdzenie zakończenia aukcji.

Pierwsze partie ujawniły błędny priorytet dawnych nierozstrzygniętych rekordów: eksport publikacyjny nie zawierał ich dawnych metadanych błędu. Poprawiono kolejkę na korzyść przyszłych/trwających aukcji oraz wcześniej poprawnie pobranych szczegółów; błędne pozycje otrzymują siedmiodniową przerwę. Kontrola tożsamości nie została osłabiona. W trzeciej partii 6/8 szczegółów zapisano i odczytano poprawnie.

`null`, zero, oferta bieżąca, Kup teraz, kwota warunkowa i potwierdzona sprzedaż pozostają różnymi stanami. Nowy brak kwoty nie przejmuje starej ceny pod dzisiejszą datą. Istniejące 19 044 wydarzenia i 1638 potwierdzeń historii pozostają zachowane; ten harmonogram nie uzupełnia nowych wydarzeń historii. Katalog nadal jest częściowy. Nie ogłaszamy odświeżenia wszystkich 1817 wcześniejszych aut.

### Widoczne zmiany i wydajność

- Na kartach list widoczna rzeczywista data odczytu, także dla zapisanych starszych ofert.
- Zmiana marki uruchamia zgodne filtrowanie, a spóźniona odpowiedź listy modeli nie nadpisuje nowego wyboru.
- Usunięto z karty dwa nieużywane skrypty V2. Liczba zewnętrznych skryptów 15 → 13; suma rozkodowanego JS **993 583 → 427 249 B (−57%)**. Pliki dawnych stawek nie zostały usunięte; V4 zachowuje 610 lokalizacji, 24 stawki morskie i fingerprint `rex-partner-v4-f0a67460b203286f`.
- Obrazy otrzymały asynchroniczne dekodowanie. Zachowano galerię, lightbox, polskie etykiety, zielony typ ubezpieczyciela i kolejność ceny → szczegóły/akcje → kalkulator.
- Końcowe QA świeżego Jaguara ujawniło tekst `[object Object]` zamiast lokalizacji w rozwijanym ścisłym kalkulatorze. Naprawiono wyłącznie prezentację obiektów lokalizacji (jawna nazwa albo miasto/stan), bez zmiany obliczeń. Regresje tekst/obiekt/null/nieznany obiekt i fallback: 43/43 testy celowane PASS; w końcowej produkcji przeglądarka pokazuje `FL - WEST PALM BEACH` i zachowane15/1000USD. Nie tłumaczono niepotwierdzonych kodów paliwa z domysłu.
- Dla tych samych 6 URL-i i drugiej próby z tej samej maszyny mediana HTTP TTFB **91,5 → 72,5 ms**. To mała próba, wpływ sieci/CDN; nie jest pomiarem Core Web Vitals ani gwarancją poprawy o taki procent na każdym telefonie.

### Materiały wspólnika i kalkulator

Arkusz ma **74/98 niepustych odpowiedzi**, w tym 50 nowych. Źródło, komórki, hash i niejasności: [osobny raport](PARTNER_AUTH_READINESS_2026-10-14.md). Nie skopiowano do Git prywatnych numerów kontaktowych ani rachunków.

W kalkulatorze działa rozwijana sekcja dalszych kosztów: Rotterdam/Holandia, 180 USD obsługi i opcjonalne oględziny 250 USD z wyraźnym oznaczeniem **poza obecną sumą**. Dopłata BEV 150 USD już uwzględniona nie jest liczona drugi raz; nowe HEV/PHEV pozostają informacją do uzgodnienia zakresu. Sprzeczne podatki, niejasne ubezpieczenie i kwoty 2500 bez waluty nie zostały wdrożone jako pewne koszty. Przykładowy stagingowy transport Tesli Copart nadal 1055 USD, Hondy po wyborze sedana 870 USD; częściowy wynik jest oznaczony.

### Konta, poczta i koszt

Po zatwierdzonym Resume projekt produkcyjny Supabase `kkwbqzndildovbblbkcx` jest Healthy, Ireland/Nano; staging `ydfsuncohsntqwmtmnhe` Healthy, Frankfurt/Nano. Odczytano Site URL, callback, włączone SMTP Resend i polskie wzorce confirmation/recovery. Sekrety nie były ujawniane. Maskowane przez narzędzie wartości nadawcy/użytkownika SMTP nie są nowym potwierdzeniem ich treści.

**Supabase Pro nie jest wymagane teraz. Właściciel odłożył zakup; pozostajemy przy Free, nowy abonament 0 USD.** Możliwe uśpienie nieaktywnego projektu nie zatrzymuje publicznego katalogu. Produkcyjne e-mail E2E, potwierdzenie tożsamości właściciela i jego osobne TOTP pozostają przed uruchomieniem kont. Nie testowano hasła właściciela. Historyczny rzeczywisty recovery dotyczył testowego klienta stagingu i został potwierdzony przez właściciela.

Automat używa posiadanego Apibara Basic i Workers Paid (dotychczasowa baza 5 USD/miesiąc plus wykorzystanie). Nie aktywowano dodatków. Limit 12 000 prób kontroluje aplikację, nie całą fakturę Cloudflare ani inne narzędzia na wspólnym koncie Apibara. R2 nie jest podłączone do publicznego profilu, więc nie uruchomiono nowych publicznych załączników.

### Backup, audyt i rollback

Przed migracją wykonano świeży export publikacyjnej D1, szyfrowanie DPAPI i roundtrip. Pełny SQL 30 194 905 B, SHA-256 `098e4d0b00d8bd9d8182cd7825c42e897a155b8f2d3c0afebc53f7008972bee1`. Odtworzenie w pamięci SQLite: integrity `ok`, FK 0; dwukrotna migracja lokalna zachowała wszystkie wiersze 23 dotychczasowych tabel. Zdalnie zastosowano 8 instrukcji addytywnych, 5 nowych tabel; 17 zapisanych wierszy. Nie wykonywano migracji Accounts ani zapisów prywatnych danych.

Kopia: `C:/Users/nowic/Documents/Codex/private-backups/rexbid/automatic-refresh-before-20261014`. Test na obecnym koncie Windows; nie jest to dowód odtworzenia na drugim komputerze. Sekrety i prywatne backupy poza Git.

[Dokładny runbook](AUTOMATIC_REFRESH_RUNBOOK.md): STOP unieważniający dzierżawę → wyłączenie Cron i sprawdzenie schedules → rollback kodu w razie potrzeby. Punkt sprzed etapu: produkcja `1cd69740-fda8-495a-a895-587f135cf077`, staging `85a44ee5-5b9d-4a6d-ac35-1b7456535a12`. Nowe tabele są zgodne ze starszym kodem, nie usuwać ich. Przy problemie danych odtworzenie do osobnej bazy i kontrolowana różnica, bez nadpisywania działającej bazy starym dumpem. DNS i stary mtbid pozostają nietknięte.

### Wykonane kontrole

- Pełny suite **956/956 PASS**, celowane 69/69 PASS, konfiguracja, generator publikacji, V4, składnia i `git diff --check` PASS; oba dry-run i oba deploye zakończone. Testy plików wymagały wykonania poza piaskownicą: jej EPERM przy rename nie był błędem logowania Wrangler. Po odnowieniu autoryzacji przypięty Wrangler 4.149.0 i właściwe XDG działały.
- HTTP/API: **produkcja 89/89 PASS**, staging **80/80 PASS**; 4 próbki mediów HTTP 200 image/jpeg. www zwraca 308 z zachowaniem ścieżki i parametrów. Auth/portal są wyłączone zgodnie z profilem publikacyjnym.
- Przeglądarka desktop 1280 i mobile 390: Home, marka Polestar, dokładny VIN/LOT, karta Hondy IAAI i Tesli Copart, historie, galeria/lightbox, kalkulator, ulubione z odświeżeniem oraz karta → kontakt → karta → katalog. Produkcyjny Rolls-Royce IAAI 46064284 pokazuje bieżącą kwotę ze źródła i datę. Brak poziomego overflow; menu produkcyjne nie oferuje kont.
- Zapytanie przygotowano lokalnie na danych QA, bez wysyłania e-maila. Produkcyjne lokalne ulubione sprawdzono add/reload/remove, przywracając stan początkowy. Konta, MFA i realizacje nie były modyfikowane.
- Zero/null i awarie providera, retry, wyczerpanie budżetu, blokada równoległości oraz STOP sprawdzone w regresjach syntetycznych. Nie przedstawiać ich jako rzeczywistych odpowiedzi dostawcy z tego dnia.
- Końcowy `/ready`: HTTP 200, katalog/zasoby OK, provider `scheduled_only`; zawiera tylko bezpieczny stan harmonogramu. Odczyt nie uruchamia Apibara.

Dowody poza Git: `C:/Users/nowic/Documents/Codex/REXBID_DEVELOPMENT_20261014`, w tym raporty HTTP, porównanie wydajności, testy, statusy D1, logi deployu i zrzuty desktop/mobile. Testy przeglądarkowe nie potwierdzają prawnego zatwierdzenia dokumentów.

## Końcowa kontrola danych i pierwszego samoczynnego Cron

**14.10.2026, 16:30:07–16:30:35 UTC / 18:30 CEST:** rzeczywisty harmonogram Cloudflare zakończył przebieg, 8 prób/8 odpowiedzi, bez ponowień i błędów zapisu/tożsamości w tej partii. Dodał 1 ofertę Copart, odświeżył 7 istniejących Copart; 19 nowych rekordów pominął ze względu na wyczerpany limit nowych ofert. Dzienny licznik nowych doszedł do40/40, licznik prób32/500 i32/12000. Po końcu `lease=null`, `blocked=null`, `pause=null`, `last_success_at=2026-10-14T16:30:35.645Z`. Nie był to ręczny operator ani wywołanie podczas otwierania strony.

Odczyt D1 **16:31:09 UTC**:

| Zakres | Przed | Po |
| --- | ---: | ---: |
| Copart | 945 | 965 |
| IAAI | 872 | 892 |
| Wszystkie zapisane oferty | 1817 | 1857 |
| Snapshoty | 3253 | 3301 |
| Wydarzenia aukcyjne | 19 044 | 19 044 |
| Potwierdzenia odczytu historii | 1638 | 1638 |
| users / realizacje / wiadomości / pliki produkcji | 0/0/0/0 | 0/0/0/0 |
| Duplikaty platforma/LOT i błędy FK | 0 / 0 | 0 / 0 |

Łącznie bieżąca obserwacja dotyczy **53 ofert: 28 Copart i25 IAAI** — 40 nowych plus13 istniejących. Nie każda poprawna ponowna obserwacja tworzy nowy snapshot, jeśli fingerprint danych jest identyczny. Pozostałych1804pozycji nie przedstawiamy jako odświeżonych w tym etapie. 15 nierozstrzygniętych prób istniejących ofert zachowuje przyczynę (9tożsamość,6HTTP404) i starsze dane; automat kontynuuje niezależne auta. Pokrycie źródła/rynku pozostaje częściowe.

Licznik etapu do tego momentu: **34 próby** =32w trwałym liczniku automatu +2samodzielne odczyty usage. Łączny historyczny licznik **1774+34=1808**. HistoryczneSTOP56 nie zmieniono. Scheduler ma26odpowiedzi i6HTTP404; oba samodzielneusageHTTP200. Ponowienia0. Metadane samego konta Apibara o16:31:03UTC: **5861/30000**, pozostało24139; przed etapem5836, różnica25. To odrębny licznik dostawcy (może mieć własne naliczanie/aktualizację); nie dopasowywano go sztucznie do34naszych prób. Własne próby są liczone także przy błędzie, zanim nastąpi transport.

Automat pozostaje włączony, więc po tej godzinie liczby będą rosły. Obecny licznik to1774+2+COUNT(automatic_refresh_attempts), dopóki nie pojawi się nowa operacja ręczna. Zewnętrzny ledger zawiera historyczne/manualne próby, D1 jest źródłem prób Cron; nie dodawać ponownie24ręcznych prób automatu, bo są już w obu zapisach dowodowych.

Rzeczywiste przykłady:

- [Jaguar Copart48484506](https://rexbid.pl/car?lot=48484506&platform=copart), VINSAJWA0FSXFPU50496: aktualna oferta15USD iKup teraz1000USD, odczyt14.10o18:30CEST; poprzednie niesprzedane aukcje pozostają osobną historią zodczytu8.10. Przeglądarka potwierdziła obie ceny i galerię z12pozycjami; zrzut `production-cron-jaguar.png`. Nie sprawdzano osobno dostępności każdego z12plików.
- [Rolls-Royce IAAI46064284](https://rexbid.pl/car?lot=46064284&platform=iaai), VINSCA1S68456UX08262: źródłowa oferta18600USD z14.10o18:10CEST, niepotwierdzona wcześniej historia nie udaje pustej.

To obserwacje o podanym czasie, nie gwarancja dzisiejszej dostępności w chwili późniejszego oglądania ani wykonanie licytacji.

Po końcowym deployu poprawki lokalizacji: HTTP obu kart200 i zgodny nowy kod, `/ready`200, przeglądarka produkcyjna bez `[object Object]`. Kontrolne otwieranie i odświeżanie karty między cyklami nie zwiększyło32prób automatu. Dokładne metadane końcowych wersji i stan bazy: `status-final.json`; kontrola HTTP: `final-location-http.json`. Starsze pliki `deploy-production-final.log` i `deploy-staging.log` są dowodami pośrednich wydań; końcowe logi mają sufiks `-complete.log`.

## Dalsza kolejność

1. Konta produkcyjne na obecnym Free: istniejące bramki izolacji, prywatność/retencja dla kont, rzeczywiste confirmation/recovery na osobnym koncie QA, własne konto i TOTP właściciela. Bez przypisywania administratora z domysłu i bez kopiowania stagingowych kont.
2. Pełniejsza wycena po rozstrzygnięciu konkretnych rozbieżności arkusza; nie wymaga ponownego dostarczenia już potwierdzonych tabel transportu.
3. Portal i role współpracy, potem pliki z limitem ilości/miejsca/operacji. Rola polskiego podmiotu i wspólnika przed udostępnianiem danych klientów.
4. Dalsze pomiary wydajności i SEO oraz historia aukcji aktualizowana według osobnego budżetu. Nie dodawać automatycznej komunikacji marketingowej ani nowej analityki bez określonego celu i prywatności.

Poniższa mapa jest zachowanym zapisem rozpoczęcia etapu; stan wykonania opisano wyżej.

Koordynator: główny agent Codex. Punkt wyjścia kodu `3078bc4ef3e2bf45789607ab183edcfe251dc549`. Aktualne zlecenie właściciela obejmuje testy, aktualizacje danych, automatyczne odświeżanie i wdrożenia sprawdzonych poprawek. Dawne zakazy publikacji i Cron dotyczą zakończonych etapów. Nie upoważnia to do zakupu nowego pakietu bez przedstawienia jego kosztu. Bez pusha.

## Mapa stanu na rozpoczęciu

| Obszar | Stan / dowód | Najbliższy rezultat |
| --- | --- | --- |
| rexbid.pl | Domena uruchomiona 12.10; publiczny katalog, karty, galerie, historia, V4, lokalne ulubione, kontakt. Kod: worker.publication.js; profil wrangler.production-publication.jsonc; Worker rexbid-production-preflight; osobna D1 c8a30088-70af-43a6-9a7f-c4018279d37d. | Sprawdzić metadane wdrożenia i funkcje po zmianach. |
| Świeżość katalogu | Ostatni handoff: obserwacje głównie 8–9.10. Automatyczny odczyt OFF. Stan zapisany nie jest odczytem aukcji na żywo. | Trwały harmonogram, budżet, historia prób, widoczna data odczytu. |
| Konta i portal | Działają na stagingu; produkcyjny profil ma Auth/portal/files OFF. Produkcja ma osobny Supabase kkwbqzndildovbblbkcx. | Weryfikacja konfiguracji i osobne uruchomienie kont przed panelem operacyjnym. |
| Supabase staging | Własny odczyt dashboardu 14.10 ok.17:41 CEST: projekt ydfsuncohsntqwmtmnhe Healthy, Frankfurt/Nano. E-mail właściciela ostrzega o przyszłym uśpieniu. | Nie traktować powiadomienia jako potwierdzonego zatrzymania. Plan ciągłości Auth do decyzji o koszcie. |
| Kalkulator | V4 zachowuje potwierdzone stawki; brakujące opłaty pozostają nieustalone. | Zweryfikować zawartość dostarczonego arkusza, uzupełniać wyłącznie potwierdzone dane. |
| Kontakt | Lokalny szkic wiadomości; wysyłka przez program pocztowy. kontakt@rexbid.pl w Zimbra; stare przekierowanie do Gmaila usunięte za zgodą. | Nie udawać backendowego zapytania ani rozmowy w panelu. |

## Etapy i kryteria ukończenia

1. **Niezawodność i aktualne dane.** Kontrola planu i quota → świeży backup/restore → testowana migracja addytywna → harmonogram z trwałą blokadą równoległości, rezerwacją każdej próby, limitami i stanem awarii → kontrolowany pierwszy zapis/readback → wdrożenie i publiczne sprawdzenie. Ruch użytkownika nadal czyta D1/cache. Błąd lub 404 nie oznacza sprzedaży ani pustej historii. Stary STOP56 zachowany jako historia.
2. **Wydajność i wygoda.** Porównywalne pomiary zasobów i odpowiedzi przed/po; naprawa potwierdzonych problemów; desktop/mobile całej ścieżki. Pomiary HTTP oddzielić od laboratoryjnych wyników przeglądarki i rzeczywistych Core Web Vitals.
3. **Kalkulator.** Rejestr źródeł i rozbieżności; wdrożenie potwierdzonych stawek z regresjami. Braki blokują tylko zależne pozycje, bez zer zastępczych.
4. **Obsługa klienta.** Produkcyjny Auth/recovery po kontroli oddzielnego projektu, SMTP i ciągłości usługi; właściciel potwierdzony jednoznacznie oraz własne MFA. Nie kopiować kont testowych ani wybierać właściciela z kolejności kont. Portal/pliki dopiero po izolacji i testach danych testowych.
5. **Oferta i pozyskiwanie klientów.** Techniczne SEO, potwierdzone treści, kanał obsługi zapytań, pomiar zgodny z prywatnością. Nie dodawać analityki ani deklaracji usług bez oceny ich rzeczywistego zakresu.

## Dostępy, budżet i bezpieczeństwo

- Własny odczyt Apibara `/usage` 14.10: Basic, 20 rekordów/stronę, 5836/30000, pozostało24164. Nie jest to gwarancja przyszłego zużycia całego konta. Daty `to` w odpowiedzi nie zostały uznane za datę odnowienia abonamentu.
- Licznik lokalny przed etapem1774, odczyt quota jest próbą1775. Osobny trwały dziennik `Documents/Codex/REXBID_DEVELOPMENT_20261014/provider-attempts.ndjson`. Nie zerować starszych liczników.
- Nowy harmonogram przygotowywany do maks.500 prób/dzień i12000/miesiąc; kontrola rzeczywistej puli, zapas bezpieczeństwa i maks.8 prób/uruchomienie. To limity aplikacji, nie limit rachunku Cloudflare. Dokładne wartości wdrożenia i wynik QA zapisuje raport końcowy.
- Wrangler4.149.0, `XDG_CONFIG_HOME=C:/Users/nowic/AppData/Roaming/xdg.config`: rzeczywisty błąd `Not logged in`; brak EPERM. Właściciel otrzymał jedną instrukcję logowania. Przygotowanie kodu i analiza trwają niezależnie.
- Sekrety, dane prywatne i pełne kopie baz pozostają poza Git. Produkcyjny mtbid i jego stara D1 nie są celem tego etapu.

Powyższa mapa i założenia budżetu opisują rozpoczęcie etapu. Rzeczywiste wdrożenia i wyniki mają pierwszeństwo w sekcji wykonania.
