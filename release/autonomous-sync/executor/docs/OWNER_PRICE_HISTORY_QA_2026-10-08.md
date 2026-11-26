# REXBID — ceny, historia i kolejność karty: QA 8.10.2026

**STAGING VERIFIED.** Kontynuacja a3af067e4bec348ac72f940f936004170600c234, bez resetu i cofania wcześniejszych zmian. Etap poczty, dokumentów i publikacji odłożony zgodnie z nowym poleceniem właściciela.

- Staging: **658c25a8-82c2-44c8-b55e-7cc9bc5012cc**, Worker **rexbid-auth-test**, D1 **rexbid-auth-test-db / acb3cb8e-69a2-459f-8a46-0f2f5b9004be**.
- Poprzedni staging, punkt rollbacku kodu: **69d632c2-4f53-4d08-9602-6cd60de43d8e**.
- Nie wdrażano mtbid ani preflight, nie zmieniano DNS, schematu, ról, MFA, sekretów, planów ani R2. Push = 0.

## 1. Diagnoza: dwa różne problemy

Warunki **Number(value) > 0** w renderowaniu Home, katalogu, ulubionych i karty odrzucały prawidłową ofertę równą zero. Adapter, canonical model i kolumny D1 dopuszczają zero. Zmieniono walidację wyłącznie bieżącej/zapisanej oferty na jawną liczbę lub niepusty tekst liczbowy >= 0. Null, undefined, pusty/biały tekst, boolean i liczby ujemne pozostają brakiem. Zero nie jest fallbackiem dla pustych danych. Aktywne Kup teraz wymaga nadal dodatniej kwoty; kosztów V4 nie zmieniono.

**Ta poprawka nie dowodzi jednak, że zgłoszona Tesla ma w Apibara aktualną ofertę 0.** Zapisane dane D1, nowe detail i surowe pola IAAI sprawdzono osobno. Obie poniższe odpowiedzi detail mają current_bid_usd=null, current_bid2_usd=null oraz buy_now_usd=null:

| Pojazd | Rzeczywisty odczyt Apibara UTC | Wynik |
| --- | --- | --- |
| IAAI Tesla 43806658 / 5YJ3E1EA4NF186754 | 2026-10-08T15:19:28.925Z | bieżąca oferta nieudostępniona |
| IAAI Leaf 44717626 / 1N4BZ0CP9HC305133 | 2026-10-08T15:19:29.105Z | bieżąca oferta nieudostępniona |

W surowych danych IAAI: myCurrent=null, displayHighPrebid=false, isPreBidVisible=false. Wartości buyNowAmount=0 i buyNowPrice=$0 występują przy buyNowInd=false — to nie bieżąca oferta. Tesla ma też previous_high_bid_usd=2900 w danych estymacji; nie wolno przenosić tej kwoty do aktualnej licytacji.

Zrzut BidCars jest dowodem prezentacji innego serwisu, nie potwierdzeniem pola Apibara. REXBID pozostawia brak ceny, objaśnia go na karcie i umożliwia własną cenę kalkulacji. Nie wpisano 0 ani cen z benchmarku. Nie zmieniono last_seen_at, summary_synced_at i pierwotnych snapshotów: karta Tesli/Leafa nadal pokazuje rzeczywisty zapis katalogu **08.10, 11:53 CEST**. Odczyt diagnostyczny 17:19 CEST jest osobnym dowodem.

## 2. Historia źródłowa, bez fabrykowania sprzedaży

Staging miał dotąd obserwacje discovery, lecz zero wydarzeń aukcyjnych. Automatyczny fallback historii jest wyłączony. Jeden celowany odczyt endpointu historii Apibara zwrócił cztery wydarzenia tej samej platformy, LOT-u i pełnego VIN, next_cursor=null. Odnotowano obserwację **2026-10-08T15:19:29.252Z**:

| Data wydarzenia | Kwota źródłowa USD | Status Apibara | Prezentacja REXBID |
| --- | ---: | --- | --- |
| 20.08.2026 | 2050 | Sold on Approval | Oczekuje na zatwierdzenie |
| 27.08.2026 | 3950 | Sold on Approval | Oczekuje na zatwierdzenie |
| 24.09.2026 | 2775 | Sold on Approval | Oczekuje na zatwierdzenie |
| 01.10.2026 | 2900 | Sold on Approval | Oczekuje na zatwierdzenie |

To różni się od trzech rekordów „Nie sprzedano” na zrzucie BidCars. Nie zmieniono statusu, żeby zgadzał się z benchmarkiem. Każda kwota jest **ofertą z wydarzenia; sprzedaż niepotwierdzona**, final_price=null. Źródło nie podało nazwy sprzedawcy w tych historycznych rekordach. Nie przenoszono obecnej nazwy ani tekstów BidCars do wcześniejszych aukcji. Daty YYYY-MM-DD zachowują dzień bez konwersji przez strefę czasową.

Nowy operatorowy scripts/targeted-history-import.cjs importuje wyłącznie zapisaną odpowiedź, nie wykonuje transportu. Weryfikuje platformę/LOT/VIN pojazdu i każdego eventu, istniejącą tożsamość D1, unikalne klucze, wymagane pola, limit strony oraz readback. Atomowy batch i idempotentny replay; konflikt tożsamości lub błędny zapis przerywa operację. Import dotyka jedynie auction_events. Przypadek **Not Sold** ma osobną regresję: ostatnia oferta nie staje się ceną sprzedaży.

Nie dodano masowego pobierania historii ani historii innych aut. Publiczna dokumentacja endpointów: https://apibara.tech/en/products/vehicle-auction-data-api/docs . Dostępność historii innych LOT-ów pozostaje zależna od źródła.

## 3. Widoczne poprawki

- **Przed:** cena → długi kalkulator → podstawowe informacje. **Po:** cena → platforma, LOT, VIN, termin, lokalizacja, uszkodzenie, przebieg, sprzedawca i akcje → jeden kalkulator. Poprawiono funkcję pozycjonowania panelu, nie tylko kolejność statycznego HTML. To samo na telefonie.
- Insurance / Insurance Company / Ubezpieczyciel z jawnego typu źródłowego daje zieloną etykietę **Typ sprzedającego: Ubezpieczyciel — Typ akceptowany przez REXBID**. Nazwa, jeśli istnieje, pozostaje osobno. Objaśnienie wyklucza indywidualną weryfikację firmy i gwarancję stanu. Sama nazwa zawierająca „Insurance” nie wystarcza.
- Przy nieznanej cenie nie włączamy obliczenia „dla tej ceny”. Przy potwierdzonym zero cena renderuje się; dodatnia oferta, Kup teraz i zapis historyczny zachowują oddzielne etykiety. Brakujące podatki, transport i opłaty nadal nie są zerem.
- Zachowano galerię, lightbox, kopiowanie VIN/linku, obserwowanie i nawigację do katalogu. Wersjonowane adresy CSS/JS zaktualizowano.

## 4. Bezpieczeństwo danych, backup i liczniki

Przed importem wykonano pełny eksport stagingowej D1: **8 245 274 B**, SHA-256 **017bf84083bbb801c02386ccb52754419a7e20e9397db389f5922a4ae8f0050d**. Kopia z ACL użytkownik/SYSTEM i DPAPI CurrentUser; kontrola odszyfrowania/checksum PASS, jawny plik eksportu usunięty. To kopia odtwarzalna na obecnym koncie Windows, nie nowy test drugiego urządzenia.

Ścieżka prywatna poza Git: C:/Users/nowic/Documents/Codex/private-backups/rexbid/owner-price-before-20261008. Nie dołączać kopii bazy do raportu przesyłanego dalej.

Końcowy SELECT **15:51:31 UTC / 17:51:31 CEST**:

| Wartość | Przed | Po |
| --- | ---: | ---: |
| sources / listings | 1638 / 1638 | 1638 / 1638 |
| snapshots | 1682 | 1682 |
| auction_events | 0 | 4 |
| duplikaty platforma–LOT | 0 | 0 |
| users / favorites / orders / messages / files | 2 / 2 / 2 / 4 / 3 | 2 / 2 / 2 / 4 / 3 |

Pełne count/hash **22 tabel poza auction_events** zgodne przed i po imporcie. Nie zapisano raw payloadów w D1 ani binarnych zdjęć. Odpowiedzi diagnostyczne zawierające wyłącznie publiczne dane aukcyjne pozostają lokalnie; fixture w repo obejmuje tylko cztery wydarzenia.

**Nowe próby Apibara: 3/20 — 2 detail + 1 history, IAAI; retry 0. Razem z poprzednimi: 59/1000.** Żądania zarezerwowano w trwałym ledgerze przed transportem. Oryginalne campaign-stop.json i ledger pozostały niezmienione: pierwotna kampania nadal STOP **56/1000**, bez wznowienia. Osobny targeted-stop.json zamyka trzy odczyty. UI/HTTP QA: **0** requestów Apibara, staging fallback disabled. Nie potrzeba pozostałych 17 prób.

Początkowy pomocniczy SELECT ORDER BY rowid trafił na tabelę WITHOUT ROWID; poprawiono sortowanie audytu. Ten błąd wystąpił przed zapisami i nie wywołał kolejnego odczytu providera.

## 5. Rzeczywiste QA na wdrożonym stagingu

Desktop **1280 × 900**, mobile **390 × 844**, rzeczywista przeglądarka:

- Tesla IAAI: render, 17 miniatur, lightbox i zmiana zdjęcia, cztery daty historii, zielony typ, prawidłowa kolejność, brak horizontal overflow i przechwyconych wyjątków JS.
- Copart 57660876: render, 12 zdjęć/lightbox, Geico plus źródłowy typ Insurance, obserwacja z 11:52, termin minął / wynik do potwierdzenia, bez countdownu udającego przyszłą aukcję; V4 częściowo **5000 + 1055 = 6055 USD**.
- Honda IAAI 44593083: odrębna oferta **25 USD** i Kup teraz **2000 USD**, nazwa Progressive Casualty Insurance plus zielony typ; kliknięcie właściwej ceny ustawia 2000 w kalkulatorze. Niepotwierdzona klasa transportowa pozostawia transport nieznany.
- Home: Tesla/Leaf bez ceny pozostają do potwierdzenia; dodatnie oferty 2050 i 25 są widoczne. Ceny Honda Buy Now zgodne z kartą. Sprawdzono załadowane miniatury. Jeden materiał Hondy był niedostępny i pokazywał istniejący czytelny stan „Miniatura niedostępna”. Nie pobierano zamiennych zdjęć.
- Katalog: dokładny LOT43806658 i VIN5YJ3E1EA4NF186754 prowadzą do tego samego auta; powrót zachowuje wyszukiwanie. Ulubione lokalne: dodanie Tesli, odświeżenie i zgodny brak ceny; usunięto tylko dodany wpis testowy, zachowując dwa wcześniejsze.
- Tesla V4: standard **220 land + 150 BEV + 1175 sea = 1545 USD**; ostrożny **220 + 150 + 1515 = 1885 USD**. Własna cena 1000 daje częściowe 2545 / 2885 USD. Braki poza sumą, route IDs niewidoczne. Stawki niezmienione.
- /health, /ready, cars, filters, dwa wyszukiwania, cztery detail i historia: **11/11 HTTP200**. API read_source=d1, fallback_reason=null. Orientacyjne pojedyncze odczyty: catalog357ms, filters159ms, detail108–126ms, history165ms; bez benchmarku/statystycznej gwarancji.

**Ważne ograniczenie:** staging ma 0 rekordów z aktualną ofertą liczbowo równą zero, 374 bez niej i 1264 dodatnie. Zero i Not Sold sprawdzono automatycznie na rzeczywistych funkcjach renderowania i fixture/syntetycznych danych; nie nazywamy tego rzeczywistą licytacją 0 USD. History API pozwala pokazać wyłącznie rzeczywisty Sold on Approval. Nie wykonywano ponownie logowania, recovery, MFA, wysyłki wiadomości ani dwukontowego portalu; dane i wcześniejsze wyniki zachowane.

## 6. Automatyczne kontrole

- **node --test: 832/832 PASS**, fail/skipped/cancelled = 0; poprzednio824.
- Pakiet partnera: **14/14 PASS**.
- Oba generatory --check PASS, rate sets niezmienione: rex-partner-v4-f0a67460b203286f / partner-rates-d8167ad4ef8bce56, 610 lokalizacji /24 stawek morskich /16 klas /1 dopłata BEV.
- Trzy config validators PASS; syntax **154 JS + 5 niepustych inline script w public HTML** PASS; git diff --check PASS; staging dry-run PASS.
- Regresje: zero/unknown/positive/buyNow na czterech powierzchniach, data starej obserwacji, importer historii i replay, identity/duplikaty/atomic failure, canonical zero, Not Sold i approval bez final sale, dzień wydarzenia, kolejność DOM oraz źródłowy badge z zachowaniem nazwy.

## 7. Linki i dowody

- [Zgłoszona Tesla](https://rexbid-auth-test.tedn828.workers.dev/car.html?vin=5YJ3E1EA4NF186754&lot=43806658&platform=iaai)
- [Honda: 25 USD / Kup teraz 2000 USD](https://rexbid-auth-test.tedn828.workers.dev/car.html?vin=SHHFK7H51JU428898&lot=44593083&platform=iaai)
- [Copart](https://rexbid-auth-test.tedn828.workers.dev/car.html?vin=5YJ3E1EA3PF683202&lot=57660876&platform=copart)
- [Home](https://rexbid-auth-test.tedn828.workers.dev/), [katalog Tesli](https://rexbid-auth-test.tedn828.workers.dev/?catalog=1&s=43806658#results).

Dowody poza Git: **C:/Users/nowic/Documents/Codex/REXBID_OWNER_PRICE_QA_20261008** — final-smoke.json, suite-final.log, targeted-transport-ledger.ndjson, targeted-stop.json, d1-before.json, history-import-before/after.json, deploy.log; screeny **tesla-desktop-details.jpg**, **tesla-history-desktop.jpg**, **tesla-mobile-details.png**, **buy-now-mobile.png**, **home-mobile.png**, **copart-mobile.jpg**. Zrzuty z nazwą .png są starszym zapisem tego samego formatu obrazu zwróconego przez przeglądarkę. Część pełnostronicowych screenshotów przy dużej wysokości była niedostępna w narzędziu — zachowano widoki mobilne i celowane wycinki desktop, bez inscenizowania danych.

## 8. Rollback / dalsze braki

Jeżeli kod stagingu wymaga wycofania: wrangler rollback **69d632c2-4f53-4d08-9602-6cd60de43d8e** --config wrangler.staging.jsonc. Bez migracji i destrukcyjnego cofania bazy. Cztery kanoniczne wydarzenia są zgodne ze starym schematem i mogą pozostać; ewentualne odtworzenie prywatnej kopii tylko do osobnej testowej bazy według BACKUP_RECOVERY.md, nie nadpisywać kont/plików.

Do dalszej decyzji nie potrzeba nowych ręcznych testów technicznych ani kolejnego backfillu. Ograniczenie źródłowe pozostaje: aktualna oferta Tesli/Leafa nieudostępniona, rozbieżny status historii względem BidCars. Ewentualne wyjaśnienie z Apibara powinno użyć opisanych pól i dat, bez sztucznego dopasowania. Właściciel może przeglądać poprawki na stagingu. Publikacja i poczta pozostają odłożone; ten raport nie stanowi zgody na DNS/produkcję.

## 9. Zmienione pliki checkpointu

- public/car.html, public/index.html, public/ulubione.html — ceny, historia, sprzedawca, kolejność.
- public/rexbid-car-navigation.js, public/rexbid-vehicle.css — pozycjonowanie i etykieta.
- scripts/targeted-history-import.cjs — kontrolowany import zapisanej historii.
- tests/owner-price-regression.test.cjs, tests/fixtures/owner-tesla-history.json — nowe regresje i publiczna fixture.
- tests/car-navigation.test.cjs, tests/history.test.cjs, tests/product-feedback.test.cjs, tests/vehicle-experience.test.cjs — regresje istniejących funkcji.
- PROJECT_HANDOFF.md, ROADMAP.md, docs/PRODUCTION_CUTOVER_RUNBOOK.md, ten raport — rzeczywisty stan i odłożenie publikacji.

SHA checkpointu należy odczytać przez git log -1; znajduje się także w odpowiedzi końcowej. Nie dodawano lokalnych backupów, logów, screenshotów ani sekretów do Git.
