# Historia aukcji — obie platformy, 8.10.2026

**STAGING VERIFIED — 40/40 zaplanowanych odczytów zakończonych.** Kontynuowano checkpoint ce92953f4b274216536cbc56a2b97287ac3f0f65 bez resetu. Staging pozostaje **21522ccb-b342-408f-a649-65d4b7720dc4**; metadane Cloudflare potwierdzone 19:41:38 UTC, 100% ruchu tej wersji. Nie zmieniono kodu aplikacji ani konfiguracji, więc **nie wykonywano deployu**. Produkcja, publikacyjna D1, DNS i delegacja bez zmian. To próbka 40 aut, nie historia całego katalogu.

## Kontrolowane zakończenie dwóch celów

Przed transportem direct D1 readback **19:22:30 UTC**: 60 wydarzeń / 38 receipts / duplicates 0; wszystkie chronione hash/count i non-history scopes zgodne. Resolver ponownie odczytał jednoznaczny LOT we właściwej platformie, porównał VIN i listing_id z zapisanymi, zweryfikowanymi celami. Oba cele nie miały jeszcze receipt.

| Cel | Identyfikacja i odpowiedź | Zapis / readback | Wynik |
| --- | --- | --- | --- |
| IAAI 45692906 — Toyota Prius | Detail po znanym VIN; parent VIN/platforma/LOT zgodne; HTTP 200 | 19:28:29.969 UTC; atomowy receipt complete, last_success_at i last_complete_at ustawione; cursor null | Rzeczywista history=[]; fetched_empty, 0 wydarzeń |
| Copart 70103156 — Mercedes-Benz EQS | Detail po znanym VIN; parent VIN/platforma/LOT zgodne; HTTP 200 | 19:28:30.938 UTC; 1 event + receipt complete; fingerprint i receipt zgodne; cursor null | 08.10.2026 — 19 900 USD — source Sold; final_price=19900 |

Poprzedni numeryczny LOT IAAI 45692906 wskazał inny pojazd Copart. Ta odpowiedź pozostała odrzucona i nie została nadpisana ani zaimportowana. Zabezpieczeń VIN/platforma/LOT nie wyłączono. Udokumentowany endpoint detail nie ma selektora platformy; użyto generycznej poprawki buildHistoryReadSpec, wdrożonej offline w poprzednim checkpointcie. Obecne dwa poprawne odczyty potwierdzają ją rzeczywistymi odpowiedziami.

Oficjalna zachowana OpenAPI Apibara 1.1.0: GET /api/v1/vehicle-auction/vehicles/{slugVin}?include=history; VIN/LOT/slug, retained history jako niepaginowana tablica. Oddzielne /history obsługuje cursor i per_page=20. Obie nowe tablice mają jawny koniec, excluded=0, więc dodatkowa paginacja nie była potrzebna. Brak historii oznacza tylko prawidłowo zakończony pusty odczyt udostępnionego źródła, nie dowód braku wszystkich wcześniejszych aukcji.

## Wynik całej próbki

| Platforma | Zaplanowane / zakończone | Z wydarzeniami | Prawidłowo puste | Partial | Nieuzupełnione | Wydarzenia D1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Copart | 20 / 20 | 20 | 0 | 0 | 0 | 30 |
| IAAI | 20 / 20 | 8 | 12 | 0 | 0 | 31 |
| Razem | 40 / 40 | 28 | 12 | 0 | 0 | 61 |

39 historii pobrano w etapie; jedna korzysta z wcześniejszej prawidłowej odpowiedzi Tesli IAAI 43806658, z rzeczywistym observedAt 15:19:29.252 UTC. Zachowano wszystkie wcześniejsze 38 receipts i 60 events bez zmiany żadnej ich kolumny. Events od początku etapu 4→61, czyli 57 nowych; receipts 0→40. Wszystkie 40 odczytów zakończone, last_success_at/last_complete_at i cursor zgodne z odpowiedziami; fingerprints porównano z zachowanymi odpowiedziami. Complete dotyczy udostępnionego odczytu, nie pełnej historii świata.

Źródłowe statusy: Sold 17 / Not Sold 12 / Sold on Approval 32. Oferty warunkowe nadal final_price=null, w UI „Oferta warunkowa”; Not Sold to oferta, nie cena sprzedaży. Dates DD.MM.RRRR, bez przesunięcia dnia. Obserwacje pozostają oddzielnie zwinięte. Nie przepisano historycznej kwoty pod świeżą datę aktualnej oferty.

## Budżet i audyt wznowienia

- W tej kontynuacji **3 nowe próby / 3 HTTP 200**: po jednym detail+history dla IAAI i Copart oraz **jeden GET /usage**. Retry 0. Nie wykorzystano pozostałych 7 dozwolonych prób.
- Cały etap historii: **42 próby / 42 HTTP 200**, 40 detail+history (39 poprawnych + 1 odrzucona tożsamość) oraz 2 usage. Razem **101/1000** = pierwotne 56 + wcześniejsze 3 diagnostyczne + 42 etapu historii. Limit etapu 100 i zatwierdzonej kontynuacji 10 zachowane. Pierwotna kampania nadal **STOP 56**; nie uruchamiano discovery/backfill, Cron ani Sync.
- Nie zerowano ani nie edytowano starego ledgeru / identity STOP. Osobna, jawnie zatwierdzona kontynuacja jest związana SHA256 starego ledgeru, STOP, kontrolnego readbacku i odrzuconej odpowiedzi. Nie dopisano fikcyjnego commit dla niezgodnego transportu. Projekcja 39 wcześniejszych attempt rows służy tylko do policzenia wspólnej bazy 98; manifest wiąże ją z niezmienionym oryginałem. Nowy ledger rezerwuje każdą próbę trwale przed transportem, checkpointuje dopiero po atomowym zapisie/readback i kończy latch FINAL_TWO_CONTROLLED_READS_COMPLETED przy 3/101.
- Oficjalny odczyt zużycia **19:28:31.993 UTC**: **4234/30000 used, 25766 remaining, today 111**. Poprzedni odczyt 17:47:15 UTC: 4190 used / today 67. Przyrost **44** jest licznikiem całego konta między pomiarami; **nie przypisujemy go jako rozliczenia 42 prób tego operatora**. Odpowiedź /usage nie zawiera rozliczenia przypisanego do naszej operacji. Po końcowym usage nie wykonano żadnego requestu Apibara.
- Publiczne API/browser QA: **0 provider**, source=d1, reload/cache; nowy ledger pozostaje 3, stary 39; provider_request_reservations **291→291**. Nie dodano endpointu automatycznego enrichmentu.

## Końcowy audyt D1 i ochrona danych

Target **rexbid-auth-test-db / acb3cb8e-69a2-459f-8a46-0f2f5b9004be**, konto Tedn828 7ff5a57444667c4eda2a6a7f0fc4120d, potwierdzone przez bridge metadanych. Nie używano mtbid, rexbid-db ani publikacyjnej D1.

Direct readback **19:36:00.721 UTC**, fingerprint/receipt/identity/FK audit **19:37:22.767 UTC**:

- 61 events, 40 receipts; duplicates **0**, foreign_key_check **0**, event→listing VIN/platforma/LOT/source mismatches **0**.
- Wszystkie chronione tabele zgodne hash/count z początkiem etapu; wszystkie non-history scopes identyczne. Sources/listings/snapshots **1638/1638/1682**, entities 0; users/favorites/orders/messages/files **2/2/2/4/3**. Brak zmian cen, clocków listingu, zdjęć, kont, MFA, R2, poczty i budżetowych tabel D1.
- Wszystkie wcześniejsze 60 events / 38 receipts identyczne przed/po. Zmieniono tylko dwa nowe receipts i jeden rzeczywisty event. Initial snapshots nie tworzyły wydarzeń. Nie zapisywano raw detail ani binarnych mediów.

Backup całego etapu: Documents/Codex/private-backups/rexbid/history-before-20261008, **17:37:04.884 UTC**, poza Git, ACL owner/SYSTEM + DPAPI CurrentUser. SHA/roundtrip PASS; pełny restore SQLite w pamięci **17:42:41 UTC**, integrity=ok/FK 0. To obecny komputer, nie drugi. Przed kontynuacją zabezpieczono również 60 publicznych wydarzeń i 38 receipts; po niej zachowano readback 61/40 oraz reduced responses. Przy odtwarzaniu replay z rzeczywistymi observedAt; nie zmieniać dat obserwacji ani nie restore na działającą bazę bez zgody.

## Sprawdzenia

- **CODE / AUTOMATED VERIFIED:** istniejące zabezpieczenia generycznego VIN/spec, kolizji LOT, exact parent, event identity, atomic commit, cursor/partial/empty, fsync budget/no retry i replay. Celowane regresje **14/14 PASS**. Pełne repo **855/855 PASS**, fail/skipped/cancelled 0; pakiet partnera osobno **14/14 PASS**. Nie zmniejszano pokrycia.
- Dwa generatory --check, trzy walidatory konfiguracji, składnia **156 JS + 5 inline**, git diff --check PASS. Stawki V4: **610 lokalizacji / 24 sea rates**, rex-partner-v4-f0a67460b203286f bez zmiany. Walidatory produkcji są statyczne; nie wykonano deployu ani runtime testu produkcji.
- **STAGING HTTP VERIFIED: 8/8 PASS**,19:31:32 UTC: detail, history po LOT, history po VIN, ponowny history dla każdej nowej karty. Wszystkie source=d1; LOT/VIN/reload parity i complete/fetched_empty/stored zgodne. History MISS 168–256 ms, HIT 58–88 ms; detail 126–348 ms. Orientacyjnie, nie SLA.
- **REAL BROWSER DESKTOP / MOBILE VERIFIED:** obie karty, 1280×900 / 390×844; historia/komunikat pustego odczytu, daty, kwota Sold jako cena końcowa, obserwacje osobno, V4 wyrenderowane. Copart reload zachowuje wynik; captured JS errors 0 obu kart. DOM width 1265/375 bez poziomego scrolla. Screenshot desktop IAB ma ograniczenie szerokości uchwyconego obrazu; mobile obejmuje pełny viewport. Galerie dostępne w DOM (Prius 19 / EQS 12); dwóch niedostępnych miniatur Prius nie przedstawiamy jako poprawnie pobranych zdjęć. W tej kontynuacji nie powtarzano całego wcześniejszego E2E lightbox/favorites/panelu.
- Ceny listingu są wcześniejszymi obserwacjami, np. Copart 70103156 ma zapisane 350 USD, a późniejsza historia potwierdza Sold 19900; daty wyraźnie osobne. Nie odświeżano listingów na podstawie samych historii. V4 zachowuje partial i brakujące koszty; nie nazywa subtotal pełną ceną pod dom.
- **NOT VERIFIED:** pełna historia całego katalogu, finalizacja 32 ofert warunkowych, live partial w tej próbce (regresje syntetyczne PASS), ponowny E2E panelu/MFA, drugi komputer restore. Poczta, publikacja i etap prawny pozostają odłożone.

## Powtarzające się logowanie Wrangler — diagnoza bez sekretów

Operator używa zachowanej wersji **4.147.0**, logi dwóch rzeczywistych logowań właściciela **4.149.0**. Oba korzystają z **tego samego** profilu Windows: C:/Users/nowic/AppData/Roaming/xdg.config/.wrangler/config/default.toml; legacy C:/Users/nowic/.wrangler nie istnieje, jawne XDG_CONFIG_HOME operatora odpowiada domyślnej ścieżce Windows.

Po dwóch poprawnych zapisach sesja wygasła. Wrangler zgłosił „expired and could not be refreshed”; log wskazuje lokalne **EPERM / open / default.toml** podczas odświeżania konfiguracji. Nie ma w zachowanym błędzie invalid_grant, HTTP400 ani Invalid refresh token; nie przypisujemy awarii odrzuceniu przez Cloudflare lub samej różnicy wersji. Przyczyną widoczną w logu jest lokalny dostęp do pliku auth w ograniczonym uruchomieniu. Po ponownym logowaniu właściciela 19:34:55 UTC nowy profil z expirationTime 20:34:55 UTC został odczytany przez operatora, a audyt i metadane Workera przeszły.

Nie usuwano cache, nie zmieniano ACL/uprawnień, nie rotowano sekretów ani nie ujawniano tokenów. Dla kolejnych operacji przypinać tę samą wersję CLI i profil; w przypadku odświeżania zapewnić zatwierdzony kontekst wykonania mogący zapisać istniejący plik auth, zamiast kasować konfigurację lub powtarzać transport. **Nie twierdzimy, że długoterminowe odświeżanie sesji zostało naprawione** — w tym etapie ustalono błąd i odzyskano dostęp.

## Karty i dowody

- [IAAI 45692906 — prawidłowo pusta historia](https://rexbid-auth-test.tedn828.workers.dev/car?lot=45692906&platform=iaai#auctionHistoryPanel).
- [Copart 70103156 — 08.10.2026 / 19 900 USD / Sprzedano](https://rexbid-auth-test.tedn828.workers.dev/car?lot=70103156&platform=copart#auctionHistoryPanel).
- Zachowane wcześniejsze przykłady: [Honda IAAI 44593083](https://rexbid-auth-test.tedn828.workers.dev/car?lot=44593083&platform=iaai#auctionHistoryPanel), 3 oferty warunkowe; [Tesla Copart 57660876](https://rexbid-auth-test.tedn828.workers.dev/car?lot=57660876&platform=copart#auctionHistoryPanel), Sold 9100; [IAAI 45018423](https://rexbid-auth-test.tedn828.workers.dev/car?lot=45018423&platform=iaai#auctionHistoryPanel), fetched_empty; [Copart 57496506](https://rexbid-auth-test.tedn828.workers.dev/car?lot=57496506&platform=copart#auctionHistoryPanel), 01.10/6600 oferta Not Sold, 08.10/30000 Sold.

Dowody poza Git: C:/Users/nowic/Documents/Codex/REXBID_HISTORY_QA_20261008/final-two — immutable manifest / continuation ledger / identity preflight / outcomes / reduced responses / usage-after / final-audit / http-qa / staging-version / auth-diagnostic / test log / cztery screenshoty *-desktop.png i *-mobile.png. Kontrolne readback-before/after-final-two.json w katalogu nadrzędnym. Oba stare ledgery i identity latch pozostały nietknięte.

**Rollback:** obecny Worker nie był zmieniany; pozostaje 21522ccb. Poprzedni punkt kodu 5e6f2c25 nie usuwa danych. Zachować 61 prawdziwych wydarzeń i 40 receipts; ewentualny data restore do osobnej bazy i reconciliation, po osobnej zgodzie. Lokalny checkpoint obejmuje dokumentację aktualnego stanu, bez cache, backupów, payloadów, sekretów i danych klientów; SHA: git log -1. Produkcja / DNS / delegacja / push / płatne usługi bez zmian.


## Późniejszy etap całego katalogu

Próbka40/40 i jej61wydarzeń zostały zachowane. Wyniki późniejszej kampanii1638pozycji, odrębny licznik oraz aktualny staging: [raport całego katalogu](CATALOG_HISTORY_REFRESH_QA_2026-10-08.md). Nie zastępuje historycznegoSTOP56 ani wcześniejszych liczników.
