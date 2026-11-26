# REXBID — czytelność cen i historii, QA 8.10.2026

**STAGING VERIFIED — GOTOWE DO PRZEGLĄDU WŁAŚCICIELA.** Kontynuacja checkpointu `46b8cfcc4a5ce57df822355c89e61ed18be3fa1e`; zachowano wcześniejsze poprawki oraz dane. Publikacja, DNS i etap prawny pozostają odłożone.

- Worker: **rexbid-auth-test**, konto **Tedn828 / 7ff5a57444667c4eda2a6a7f0fc4120d**.
- Końcowy Version ID: **5e6f2c25-3738-4c95-9c81-8d09a8cbdf61**.
- D1: **rexbid-auth-test-db / acb3cb8e-69a2-459f-8a46-0f2f5b9004be**.
- Punkt rollbacku sprzed etapu: **658c25a8-82c2-44c8-b55e-7cc9bc5012cc**. Brak migracji lub zapisów biznesowych D1, więc rollback kodu nie wymaga cofania schematu.
- **0 nowych requestów Apibara**. Razem **59/1000**; pierwotna kampania nadal **STOP 56**, osobny wcześniejszy ledger ma 3 odczyty. Nie wznawiano runnera ani discovery. Automatyczny fallback stagingu pozostaje disabled.

## 1. Historia aukcji

Dotychczasowy przekład historycznego `Sold on Approval` jako „Oczekuje na zatwierdzenie” sugerował trwającą obecnie czynność. Zapisane odpowiedzi nie potwierdzają finalizacji: `final_price=null`. Zmieniono wyłącznie prezentację na **Oferta warunkowa** z objaśnieniem **Sprzedaż wymagała zatwierdzenia; końcowy wynik niepotwierdzony**. Oryginalny status można rozwinąć w „Status źródłowy”. Nie dokonano automatycznej klasyfikacji jako sprzedaż lub brak sprzedaży.

[Słownik Copart](https://www.copart.com/content/us/en/landing-page/copart-glossary) opisuje On Approval jako sytuację wymagającą akceptacji sprzedawcy. Status IAAI w tym etapie pochodzi z zachowanej odpowiedzi Apibara; brak potwierdzenia końcowego rozstrzygnięcia tego pojazdu. Nie zastąpiono go wynikiem z benchmarku BidCars.

Na [Tesli IAAI 43806658](https://rexbid-auth-test.tedn828.workers.dev/car.html?vin=5YJ3E1EA4NF186754&lot=43806658&platform=iaai) zachowano:

| Data wydarzenia | Oferta USD | Status źródłowy | Cena transakcji |
| --- | ---: | --- | --- |
| 20.08.2026 | 2050 | Sold on Approval | niepotwierdzona |
| 27.08.2026 | 3950 | Sold on Approval | niepotwierdzona |
| 24.09.2026 | 2775 | Sold on Approval | niepotwierdzona |
| 01.10.2026 | 2900 | Sold on Approval | niepotwierdzona |

Nagłówek to **Historia aukcji**. Wydarzenia są pierwsze, od najnowszego. „Zapisane obserwacje” są osobną, domyślnie zwiniętą sekcją. Data wydarzenia jest formatowana z kalendarzowego dnia źródła do DD.MM.RRRR; testy obejmują offsety +14 i −12 bez przesunięcia dnia. Timestamp odczytu nadal opisuje rzeczywisty czas obserwacji, a nie dzień aukcji.

Na telefonie wydarzenia mają układ czytelnych bloków: platforma, data, LOT, kwota, status, sprzedawca. Wynik nie wymaga przewijania w bok. Na komputerze pozostaje tabela. Oryginalny status i obserwacje nadal można rozwinąć klawiaturą.

## 2. Cztery stany dostępności historii

Publiczny envelope zachowano; dodano `meta.history_availability`:

| Stan | Znaczenie | Komunikat / wynik |
| --- | --- | --- |
| stored | istnieją zapisane wydarzenia | pokazane wydarzenia i rzeczywisty czas odczytu |
| fetched_empty | istnieje dowód poprawnego pobrania pustego wyniku | źródło nie zwróciło wydarzeń; przy częściowej stronie bez twierdzenia o całej historii |
| not_fetched | brak wydarzeń i dowodu pobrania | historia nie została jeszcze pobrana; obserwacje nie dowodzą jej braku u źródła |
| read_failed | błąd endpointu/envelope lub odczytu | czytelny błąd; zachowane wydarzenia pozostają widoczne, jeżeli istnieją |

Mechanizm identyfikuje listing przez dokładny LOT i platformę; VIN jest fallbackiem identyfikatora. Nie ma wyjątku wpisanego dla Tesli. Importer już zapisanej odpowiedzi weryfikuje platformę/LOT/VIN, zapisuje wydarzenia i potwierdzenie udanego pobrania w jednym atomowym batchu. Potwierdzenie używa istniejącej tabeli scopes, operacji `history_refresh` i klucza `history-import:<listing_id>`, oddzielnego od discovery. Pusty poprawny wynik również może mieć receipt; malformed lub nieudana transakcja go nie tworzy. Brak jawnego końca paginacji nie oznacza complete. Nie ma transportu providera w importerze.

**W tym etapie nie uruchomiono importera na zdalnej bazie.** Tesla ma cztery starsze eventy i ich datę odczytu `2026-10-08T15:19:29.252Z`, ale nie posiada nowego receipt potwierdzającego kompletność; API konserwatywnie pokazuje `complete=false`. Honda i Copart mają `not_fetched`. Nie pobierano ich historii i nie twierdzimy, że u źródła nie istnieje. `fetched_empty` i błędy sprawdzono automatycznie na lokalnej bazie/fixture, nie poprzez nowy live request.

Zachowano dotychczasowy cache i zasady fallbacku. Data świeżości projekcji D1 nie jest dowodem pobrania historii. Wejście lub reload nie uruchamia nowego odczytu Apibara w tym stagingu.

## 3. Cena i tłumaczenia

- Null na Home, w katalogu, ulubionych i karcie: **Brak danych o ofercie**. Na karcie: **Źródło nie przekazało kwoty oferty.** Usunięto ogólne „Do potwierdzenia” z miejsca ceny pojazdu.
- Potwierdzone 0 i dodatnia kwota są nadal liczbami. Pusta wartość, whitespace, boolean i ujemna kwota nie stają się zerem. Zapisana oferta zachowuje datę odczytu. Kup teraz ma oddzielną semantykę i wymaga potwierdzonej dodatniej ceny.
- Tesla i Leaf nadal mają rzeczywiste `current_bid_usd=null`; nie wpisano 0 z benchmarku. Data katalogowego odczytu Tesli pozostała **08.10.2026, 11:53 CEST**.
- `Left rear` → **Lewy tył**; `Front end` → **Przód**; `Fresh water` → **Zalanie wodą słodką**. Słownik exact wartości jest wspólny dla katalogu i karty. Nieznany opis pozostaje oryginalny; tooltip katalogu zachowuje źródło.
- Rzeczywisty kod Tesli **STATIONARY / NO INFORMATION** ma ostrożną etykietę **Uruchomienie niepotwierdzone**. Nie nazywamy silnika uszkodzonym ani sprawnym. [IAA Settlement Assistant](https://www.iaai.com/selling-services/settlement-assistant-com) potwierdza klasy start codes Run & Drive / Starts / Stationary przy przyjęciu pojazdu, lecz dostępny materiał nie daje pełnej diagnozy dla każdego aliasu Apibara. Ta granica pozostaje jawna; oryginał jest w tooltipie.
- Honda **ENGINE START PROGRAM** / alias **Vehicle Starts** → **Odnotowano uruchomienie silnika**. Jest to opis obserwacji, nie gwarancja jazdy ani przyszłego uruchomienia. Copart glossary opisuje Engine Start Program jako stan odnotowany przy przyjęciu.
- Zachowano zieloną etykietę źródłowego ubezpieczyciela, nazwę jeśli dostępna i kolejność **ceny → szczegóły i akcje → kalkulator**.

## 4. Własna weryfikacja rzeczywistych widoków

Przeglądarka Codex, desktop **1280×900**, mobile **390×844**:

| Sprawdzenie | Wynik |
| --- | --- |
| Tesla IAAI 43806658 | PASS: null z właściwym tekstem, cztery oferty warunkowe, polskie daty, raw status, oddzielne obserwacje |
| Honda IAAI 44593083 | PASS: oferta 25 USD, Kup teraz 2000 USD, Lewy tył, uruchomienie odnotowane, niepobrana historia |
| Copart 57660876 | PASS: oferta 5000 USD, źródłowy insurer, niepobrana historia, kolejność bloków |
| Galerie/lightbox | PASS na trzech kartach; obraz w dialogu miał dodatni naturalWidth |
| Tesla: zdjęcie 17 | źródłowe media niedostępne; istniejący czytelny fallback, pozostała galeria działa |
| Home | PASS: dodatnia oferta i null z właściwą etykietą; leniwe sekcje kończą ładowanie po wejściu w widok |
| Elektryczne na Home | po minięciu zapisanych terminów prawdziwy pusty stan, bez udawania aktualnych ofert |
| Katalog: LOT 43806658 | PASS: dokładna tożsamość, null, polskie uszkodzenie; przejście do karty i powrót zachowują zapytanie |
| Lokalne ulubione | PASS: testowo dodana Tesla ma właściwy brak ceny; usunięto tylko testowy wpis, wcześniejsze 2 zachowane |
| Mobilny layout | brak poziomego scrolla dokumentu; 375 px scrollWidth przy viewport 390 px na trzech kartach, katalogu i Home |
| JS | brak przechwyconych error/warn w celowanym QA |

W trakcie QA minął zapisany termin Tesli 19:00: strona pokazała **Termin minął · wynik do potwierdzenia**, bez fabrykowania sprzedaży. Nie jest to nowa obserwacja wyniku u providera.

### Kalkulator V4 — kontrola regresji

| Wariant Tesli / własna cena 5000 USD | Ląd | BEV | Morze | Transport | Zakup + znany transport |
| --- | ---: | ---: | ---: | ---: | ---: |
| Standard · 4 auta | 220 | 150 | 1175 | 1545 | 6545 |
| Ostrożny · 3 auta | 220 | 150 | 1515 | 1885 | 6885 |

Potwierdzono w rzeczywistym UI zmianę wariantu, terminal Los Angeles, brak technicznych route IDs oraz subtotal opisany jako niepełny. Nie zmieniono engine ani stawek V4. Copart: zakup 5000 + znany transport 1055 = subtotal 6055 USD. Honda po kliknięciu Kup teraz przenosi 2000 USD; nie zgaduje klasy transportowej hatchbacka. Brakujące podatki/opłaty/port/PL pozostają „Do potwierdzenia”.

## 5. Testy i integralność danych

- **840/840 repo PASS**, fail/skipped/cancelled = 0; osiem nowych testów względem 832, bez usunięcia wcześniejszego pokrycia.
- Pakiet partnera **14/14 PASS**; oba generatory `--check` PASS: 610 lokalizacji, 24 stawek morskich, 16 klas, BEV 150 USD. Wersje bez zmian: `rex-partner-v4-f0a67460b203286f` / `partner-rates-d8167ad4ef8bce56`.
- Trzy walidatory konfiguracji PASS; składnia **154 JS + 5 inline** PASS; `git diff --check` PASS; stagingowy Wrangler dry-run PASS.
- Końcowa kontrola HTTP **10/10 PASS**, `2026-10-08T17:11:17.710Z`: health/ready 200; cars/filters/detail/history trzech kart 200, `read_source=d1`. API latencje orientacyjne 106–380 ms, pojedyncze odczyty, bez masowego benchmarku.
- D1 przed **16:47:56 UTC**, po **17:11:15 UTC**: users/favorites/orders/messages/files **2/2/2/4/3**, listings/snapshots/events **1638/1682/4**, wszystkie te liczniki i źródłowe kwoty/daty zgodne.
- Copart 840 (676 dodatnich / 164 null); IAAI 798 (588 dodatnich / 210 null). **W tej rzeczywistej próbce brak bid=0**, dlatego zero i pobrana pusta historia są pokryte regresjami automatycznymi, nie zmyślonym przykładem live.
- `provider_request_reservations` przed/po: **291/291**. Ledger kampanii 56 linii, SHA-256 `c989ea94de75c77480d55823b02c564eb0a4823b102132a542ccfbca21d79194` bez zmian; osobny ledger 3 linii. STOP zachowany.
- Nie wykonywano migracji, zapisów źródłowych danych, operacji R2/MFA, loginów, wysyłki maili, rotacji sekretów, zmian DNS, produkcji ani pusha. Nie powtarzano pełnego dwukontowego portal E2E; wcześniejsze potwierdzenia właściciela pozostają zachowane.

## 6. Dowody i zmienione pliki

Dowody poza Git: `C:/Users/nowic/Documents/Codex/REXBID_READABILITY_QA_20261008/`:

- `tesla-history-desktop.jpg`, `tesla-history-mobile.jpg`;
- `tesla-calculator-desktop.jpg`, `tesla-calculator-mobile.jpg`;
- `honda-prices-desktop.jpg`, `honda-prices-mobile.jpg`, `copart-desktop.jpg`, `copart-mobile.jpg`;
- `catalog-tesla-desktop.jpg`, `home-prices-mobile.jpg`, `favorites-missing-mobile.jpg`;
- `full-tests.log`, `syntax.json`, `http-smoke.json`, `d1-before.json`, `d1-after.json`, logi dry-run/deploy.

Zmiany: `public/car.html`, `public/index.html`, `public/ulubione.html`, `public/rexbid-market.js`, `public/rexbid-vehicle.css`; `sync/d1-read-repository.js`, `staging/d1-primary-reads.cjs`, `scripts/targeted-history-import.cjs`; metadata history w lokalnych `worker.js`, `worker.preview.js`, `worker.production.js` (tylko staging został wdrożony); pięć plików regresji; bieżący raport, handoff, roadmap i krótka aktualizacja odłożonego runbooka.

## Ograniczenia i następny krok

Końcowy wynik historycznych ofert warunkowych nie jest potwierdzony. Historii pozostałych aut nie pobierano. Start code nie zastępuje diagnozy mechanicznej. Częściowy katalog i niepełny kalkulator zachowują ograniczenia. Gotowe do przeglądu konkretnych kart przez właściciela; brak potrzeby nowych odczytów providera dla tego etapu.
