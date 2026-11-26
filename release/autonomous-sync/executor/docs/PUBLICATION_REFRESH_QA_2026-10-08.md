# REXBID — QA odświeżenia i przygotowania publikacji, 8 października 2026

**Raport końcowy etapu: staging i przygotowany katalog PASS w opisanym zakresie; kampania odświeżenia pozostaje STOP.** Katalog jest częściowy (`catalog_complete=false`), a publiczne podłączenie domen nie zostało wykonane. Upoważnienie: [PUBLICATION_REFRESH_APPROVAL.md](PUBLICATION_REFRESH_APPROVAL.md), globalnie maksymalnie 1000 prób Apibara, trwały licznik, retry 0. Checkpoint wejściowy `6457d52742ec80e96caa095767c0ea69be2d3aa0`, z zachowaniem późniejszych zmian.

Końcowy staging: [rexbid-auth-test.tedn828.workers.dev](https://rexbid-auth-test.tedn828.workers.dev), **Version ID `e4e54eaa-3438-4619-a4c4-aa6648262afb`**. Wyniki API, odczyty baz, lokalne odtworzenie kopii i rzeczywiste kontrole desktop/mobile mają oddzielne dowody. PASS jednej z tych kontroli nie zastępuje pozostałych.

## Kontrole przed odświeżeniem i bramka

| Kontrola | Wynik i zakres |
| --- | --- |
| Odseparowany target publikacyjny | **PASS**: rexbid-production-preflight-db / c8a30088-70af-43a6-9a7f-c4018279d37d, zgodny w preflight, gate i końcowym readback |
| Backup przed zmianą | **PASS**: 2026-10-08T09:33:54.620Z, osobne kopie stagingu i publikacyjnej D1, DPAPI CurrentUser + NTFS owner/SYSTEM, SHA-256 i roundtrip=true dla obu |
| Lokalna odtwarzalność kopii przed etapem | **PASS**: 2026-10-08T09:40:23.178Z, restore w pamięci; schema/counts i FK bez naruszeń dla obu baz |
| Atomowość rzeczywistego D1 batch | **PASS**: preflight batch_atomicity_verified=true; celowo błędny batch nie pozostawił guard rows |
| Pierwsza strona Copart | **PASS**: 1 próba, 1 strona, 20 active; zapis i direct readback |
| Pierwsza strona IAAI | **PASS**: 1 próba, 1 strona, 20 active; zapis i direct readback |
| Bramka obu platform | **PASS**: gate.json passed=true, 2026-10-08T09:41:20.654Z; **2 próby / 40 active / retry 0**, wliczone w końcowe 56 prób |
| Integralność po bramce | **PASS w sprawdzonym zakresie**: duplikaty platform/LOT=0, foreign_key_violations=0, prywatne tabele publikacyjnej D1 puste |
| Lokalna próba publicznego merge | **PASS, offline**: backup_hashes_verified=true, replay_idempotent=true, non_public_tables_unchanged=19, private_and_operational_hashes_unchanged=true, FK/duplicates=0, fresh_missing_price_clear=true; 0 provider requests i 0 remote writes |

Lokalne odtworzenie wykonano na tym samym profilu Windows. Nie potwierdza zdalnego restore ani odtwarzania na drugim komputerze.

## Budżet, zatrzymanie i recovery

Kampania **publication-20261008** użyła **56 z 1000 prób**: Copart **25**, IAAI **31**. Wszystkie 56 zapisów transport-ledger.ndjson mają HTTP 200; błędy transportu i timeouty w tym ledgerze wynoszą 0. Łączny trwały licznik D1 jest zgodny z ledgerem (`global_counter_matches_ledger=true`), rezerwacje są zakończone, `normal_reserved=0`, `retry_consumed=0` i `retry_reserved=0`. API QA i końcowy audit wykonały **0 dodatkowych requestów providera**. Bramka nie jest dodawana ponownie do zużycia.

Globalny limit 1000 obowiązuje także przy platformowych limitach 650; ich suma nie daje puli 1300. Rezerwacja poprzedza transport, rozpoczęta próba zużywa budżet, a restart nie zeruje ledgeru. `maxAttempts=1`, automatyczne retry **0**.

Kampania zatrzymała się przy **drugiej stronie IAAI Timed**: odpowiedź upstream miała HTTP 200, ale zapis tej strony w D1 nie został potwierdzony. Zachowano **55 commitów stron i 1100 zatwierdzonych obserwacji**: Copart 25 stron / 500 obserwacji, IAAI 30 stron / 600 obserwacji. Liczba obserwacji obejmuje powtórzenia pojazdów między zakresami; nie oznacza 1100 unikalnych nowych ofert.

Receipt STOP z 2026-10-08T09:56:07.711Z zawiera `REFRESH_STATE_RECOVERY_REQUIRED`. **Dokładny pierwotny błąd D1 nie został zachowany**, więc nie przypisuje się mu bardziej szczegółowej przyczyny. Po wygaśnięciu lease wykonano atomowe recovery stanu, potwierdzone 2026-10-08T10:18:12.069Z: run/scope=`failed`, `D1_STATE_WRITE_INTERRUPTED`, lease zwolniony, cursor i last_success zachowane, **0 requestów providera**. Jest to kod odtworzenia stanu, nie zachowany pierwotny wyjątek. Nie ponowiono strony ani kampanii; `campaign_remains_stopped=true` i końcowy audit potwierdza niezmienione receipts STOP/recovery.

Zakresy discovery pozostają partial/failed, z zachowanymi cursorami i bez `last_complete_at`. Scope wiąże platformę, operację i hash parametrów; cursorów nie przenosi się między filtrami. Partie miały najwyżej 4 strony i checkpoint każdej zatwierdzonej strony. `page_limit`, poprawne HTTP 200 ani niewykorzystane 944 próby nie dowodzą pełnego pokrycia i nie znoszą STOP.

## Końcowy katalog i odczyt obu D1

Read-only audit z **2026-10-08T10:41:57.205Z** potwierdza identyczne publiczne liczby w publikacyjnej D1 i stagingowej rexbid-auth-test-db / acb3cb8e-69a2-459f-8a46-0f2f5b9004be.

| Zakres | Copart | IAAI | Łącznie |
| --- | ---: | ---: | ---: |
| Oferty / sources | 840 | 798 | **1638** |
| Active / ended / unknown | 837 / 3 / 0 | 797 / 1 / 0 | **1634 / 4 / 0** |
| Oferty z mediami | 624 | 739 | **1363** |
| Active z mediami | 621 | 738 | **1359** |
| Świeże obserwowane 2026-10-08, wszystkie active i z mediami | 499 | 599 | **1098** |
| Kup teraz, wszystkie active | 551 | 133 | **684** |
| Świeże Kup teraz | 334 | 80 | **414** |
| Timed, wszystkie active | 0 | 40 | **40** |
| Świeże Timed, z przyszłym końcem aukcji | 0 | 20 | **20** |
| Elektryczne, wszystkie active | 99 | 100 | **199** |
| Świeże elektryczne | 80 | 80 | **160** |

Obie bazy mają **1682 snapshots**, **0 auction_events** i **0 vehicle_entities**. Historia w tym etapie jest historią obserwacji, bez dodawania zdarzeń aukcyjnych. 61 ofert ma częściowy VIN ze źródła; nie są traktowane jako pełny VIN. 275 ofert nie ma referencji mediów. Brak Copart Timed w zapisanym katalogu i niedokończony IAAI Timed pozostają ograniczeniami pokrycia. Część starszych ofert i zdjęć została zachowana z wcześniejszych obserwacji; data obserwacji ujawnia ich wiek.

| Kontrola końcowa | Wynik |
| --- | --- |
| Identity/title/make/model/year/VIN | **PASS w zakresie obecności**: missing=0; partial VIN=61 pozostaje jawne |
| Duplikaty i relacje | **PASS**: duplicate platform/LOT=0, FK=0, orphan sources/snapshots=0, duplicate snapshot observations=0 |
| Ceny i daty | **PASS**: negative/invalid price type=0, negative snapshot prices=0, invalid/future observation dates=0, source version after observation=0, first_seen after latest=0, invalid auction dates/timed values=0 |
| Referencje mediów | **PASS w zakresie walidacji**: invalid media JSON=0, unsafe references=0; nie oznacza dostępności każdego zewnętrznego zdjęcia |
| Zdalne PRAGMA integrity_check | **NOT AVAILABLE**: publikacyjne D1 API odrzuciło zapytanie HTTP 400; stagingowego zapytania nie wykonano po tej odmowie. Nie przypisano remote integrity PASS |
| Lokalna integralność SQLite kopii po zmianie | **PASS**: `integrity_check=ok`, FK=0, duplikaty platform/LOT=0 dla obu baz |

Active, ended i unknown są odrębne. Brakująca oferta zwraca 404 i nie staje się ended. Aktualna oferta oraz Kup teraz mają osobne pola, a świeży brak ceny nie dostaje starej kwoty z nową datą. Daty źródła, obserwacji i snapshots pozostają zachowane. Runtime sprawdzono na opisanych niżej konkretnych LOT-ach; audit nie dowodzi kompletnej weryfikacji każdej karty.

## Merge, zachowanie danych i kopie po zmianie

Zdalny merge publicznego katalogu do stagingu zakończył się **PASS** o 2026-10-08T10:21:11.979Z. Plan SHA-256: `2d22699d99a29d541c6da7620d691da02c2ca5855dbac87da56b0b6ed7b508bf`. **Wszystkie 19 chronionych tabel poza publicznym katalogiem zachowało identyczne counts i SHA-256** przed/po merge; końcowy audit potwierdza identyczność także względem stanu po merge (`changed_tables=[]`).

Staging zachował users=**2**, user_favorites=**2**, import_orders=**2**, import_order_messages=**4**, import_order_files=**3**, import_order_events=**3** i import_order_message_reads=**0**, razem z tabelami operacyjnymi i migracjami. Publikacyjna D1 ma **0** w każdej prywatnej tabeli kont, ulubionych, realizacji, wiadomości, plików, odczytów i profili. Publiczne tabele nie zawierają prywatnych/raw/blob kolumn. Dane klientów nie są źródłem publicznego katalogu. Zachowanie hashów kont nie zastępuje nowego E2E logowania/MFA ani testu unread.

Backup po zmianie obu baz powstał **2026-10-08T10:22:31.9727509Z**. Lokalny restore w pamięci z **2026-10-08T10:36:53.335Z** potwierdza ACL, checksum, schema/counts, integralność SQLite, FK i zachowanie prywatnego stanu względem kopii sprzed etapu. Nie utworzono plaintext SQL, nie wykonano zdalnych zapisów ani requestów providera. **Drugi komputer: NOT VERIFIED**; DPAPI CurrentUser sprawdzono na tym samym profilu Windows.

## Końcowe HTTP, desktop i mobile QA

Końcowy receipt API `REXBID_QA_REFRESH_20261008/http.json`: **22/22 PASS**, `provider_requests=0`. Health/ready=200; katalog, filtry, cztery sekcje home, obie platformy, detail/history i exact LOT/VIN=200; brakujący LOT=404; anonimowe account/portal=401. Odczyty katalogu używają D1, jawnie `partial=true` / `metadata_complete=false`, fallback providera=false. Cache katalogu MISS→HIT; prywatne odpowiedzi no-store; staging ma noindex/nofollow/noarchive. Probe API użył Copart 57660876 i IAAI 45018423; rzeczywiste browser QA IAAI użyło Hondy 44593083.

| Rzeczywista kontrola operatora | Wynik i dowód |
| --- | --- |
| Home desktop/mobile | **PASS**: Aktualne, Timed, Kup teraz i Elektryczne, po 4 świeże auta w każdej sekcji |
| Kategoria, filtry i wyszukiwanie | **PASS**: przejścia home→kategoria→karta→powrót, zgodność platformy i exact VIN/LOT, filtry i paginacja 20→40 |
| Copart 57660876 — 2023 Tesla Model 3 | **PASS**: 12 zdjęć, galeria/lightbox, historia obserwacji, current bid 5000 USD, bez Kup teraz |
| IAAI 44593083 — Honda | **PASS**: 17 referencji zdjęć, galeria/lightbox i historia; current bid 25 USD oraz Kup teraz 2000 USD wyraźnie rozdzielone |
| Lokalne ulubione | **PASS**: zmiana i trwałość po reloadzie w użytej przeglądarce |
| Kontakt z karty | **PASS**: przygotowana wiadomość/kontekst pojazdu; nie wysłano emaili |
| Mobile 390×844 | **PASS**: czytelny katalog, karta i kalkulator; poziomy overflow=0 w sprawdzonych widokach |
| Active/ended/unknown i świeżość | **PASS dla reguł automatycznych i audit**; aktywne karty sprawdzone w runtime. Nie oznacza osobnego browser E2E wszystkich trzech stanów |

Calculator V4 zachował potwierdzone stawki i ujawnia brakujące koszty. Sprawdzone wartości transportu i znanego subtotalu w USD:

| Przypadek runtime | Wybór i podstawa | Oczekiwany / konserwatywny transport | Znany subtotal |
| --- | --- | ---: | ---: |
| Copart Tesla 57660876 | Current bid 5000; BEV 150; preferowany Elizabeth, trasa z ZIP fallback | **1055 / 1130** | **6055 / 6130** |
| IAAI Honda 44593083 | Kup teraz 2000; exact Elizabeth; ręcznie Sedan, land 295 | **870 / 945** | **2870 / 2945** |

Te subtotale sumują wybraną cenę i potwierdzony transport; nie są pełnym kosztem importu. Brakujących opłat kalkulator nie przedstawia jako zerowego potwierdzonego kosztu.

W tym QA wykryto i naprawiono dwie regresje, a końcowy staging sprawdzono po poprawkach:

- **PASS — etykieta Kup teraz:** przy brakującej current bid lista nie powtarza już etykiety. IAAI Equinox LOT 45636304: brak bid, Kup teraz 650 USD, pojedyncze „Kup teraz”. Honda 44593083 nadal pokazuje odrębne 25 USD bid i 2000 USD Kup teraz.
- **PASS — niedostępne zdjęcia:** rzeczywiście niedostępne zdalne zdjęcie 17 Hondy daje „Miniatura niedostępna” oraz „Zdjęcie jest niedostępne” w widoku głównym i lightbox. Po przejściu do zdjęcia 1 zasób ładuje się, a fallback znika. Kontrola mobile nadal ma overflow=0.

Screeny w `C:/Users/nowic/Documents/Codex/REXBID_QA_REFRESH_20261008/`: home-desktop.jpg, home-mobile.jpg, catalog-filters-desktop.jpg, copart-lightbox-desktop.jpg, copart-calculator-desktop.jpg, copart-calculator-mobile.jpg, copart-calculator-result-mobile.jpg, iaai-calculator-desktop.jpg, iaai-calculator-mobile.jpg i iaai-unavailable-lightbox-mobile.jpg. Są dowodem opisanych widoków; nie zastępują receipts baz ani testu dwóch zalogowanych kont.

## Testy i przygotowany build

| Kontrola końcowa operatora | Wynik |
| --- | --- |
| Pełny suite po poprawkach | **812/812 PASS**, fail/cancelled/skipped/todo=0; REXBID_TEST_REFRESH_FINAL_20261008.log |
| Generatory | **2/2 PASS** |
| Kontrole konfiguracji | **3/3 PASS** |
| Składnia | **151 plików JS + 12 skryptów inline PASS** |
| Dry-run stagingu | **PASS**: REXBID_REFRESH_DRYRUN_FINAL_20261008.log |
| Dry-run przygotowanej publikacji | **PASS**: REXBID_PUBLICATION_DRYRUN_REFRESH_20261008.log; nie jest publikacją |
| Końcowy deploy stagingu | **PASS**: REXBID_REFRESH_DEPLOY_FINAL_20261008.log, Version ID `e4e54eaa-3438-4619-a4c4-aa6648262afb`; końcowe HTTP i kontrole browser po poprawkach |

Nie przypisano PASS na podstawie dawnych screenów. Katalog przygotowany do pierwszej publikacji jest częściowy; kampania nie została wznowiona. mtbid i jego produkcyjna D1 pozostają poza operacją.

## Unread dwóch istniejących kont

**Rzeczywisty E2E unread: NOT VERIFIED.** Nie było dwóch dostępnych zalogowanych kart/sesji istniejących kont testowych. Dawne potwierdzenia MFA, nadawców i plików oraz zachowane hashe nie zastępują tego testu. Nie utworzono kont ani nie resetowano MFA.

Pozostaje jeden ręczny test stagingu z [PUBLICATION_REFRESH_APPROVAL.md](PUBLICATION_REFRESH_APPROVAL.md#5-jeden-ręczny-test-nieprzeczytanych--tylko-staging): dwa istniejące konta w osobnych profilach, wiadomość właściciel→klient i klient→właściciel, wzrost licznika odbiorcy, oznaczenie wczytanych wiadomości, trwałość po reloadzie i niezależność obu audience. Właściciel wpisuje loginy/MFA. Raportować PASS/FAIL bez prywatnej treści i QR. Test cudzej realizacji, jeśli dostępna, odnotować osobno.

## DNS i przyszła publikacja

**Uzupełnienie po dostarczeniu rexbid.pl (2).txt:** eksport8.10, etykieta11:10:35, pełna zgodność12/12 z każdym OVH w odczycie13:12:49CEST. Pełny DKIM/MX/SPF i oba ResendCNAME DNS only PASS; bramka eksportu zamknięta dla tego snapshotu. DirectbDS0PASS, aUDP/TCPtimeout nadalNOTVERIFIED. Dokładny receipt REXBID_DNS_EXPORT2_CHECK_20261008.json. Nie wykonano zmian DNS/deployu/Apibara. Poniższy wcześniejszy odczyt zachowuje swoją datę.

[Końcowy raport DNS](DNS_READINESS_REFRESH_2026-10-08.md): pełny dostarczony eksport CF jest zgodny z oboma OVH 12/12; metadata API 200/pending/Free potwierdza dokładne NS blair/titan. Live CF dns_records 403/code10000 pozostawia bieżącą zawartość strefy **NOT VERIFIED**. Końcowy direct DS/NS z 2026-10-08T10:34:14.855Z: b-dns.pl DS=0 **PASS**, a-dns.pl UDP/TCP timeout **NOT VERIFIED**. Wcześniejsze IPv6 też timeout. Odczyt rekursywny nie zastępuje obu parentów. Przed przyszłym cutoverem potrzebny jest bieżący eksport/podgląd CF lub DNS read-only dostęp oraz poprawny direct odczyt obu parentów.

Przygotowana pierwsza publikacja obejmuje zapisany częściowy katalog, karty, historię obserwacji, Calculator V4, lokalne ulubione i kontakt. Produkcyjne Auth, portal, załączniki, Cron, publiczny Sync i automatyczny fallback do providera pozostają OFF. Przyszły zakres apex/www, zachowanie MX/SPF/DKIM/Resend i forwardingu OVH, TLS i rollback opisują raport DNS oraz [runbook](PRODUCTION_CUTOVER_RUNBOOK.md). Ten etap nie zmienił nameserverów, DNS, publicznych tras ani DNSSEC i nie aktywował płatnych usług. Przygotowany dry-run nie daje publicznego runtime/TLS PASS.

## Dowody operatorowe poza Git

W `C:/Users/nowic/Documents/Codex/`:

- `private-backups/rexbid/refresh-before-20261008/manifest.json` i `REXBID_REFRESH_BEFORE_RESTORE_20261008.json` — szyfrowane kopie przed etapem, roundtrip i restore w pamięci.
- `REXBID_REFRESH_20261008/preflight.json`, `gate.json`, `local-merge-rehearsal.json` — target, atomowość, bramka i offline merge.
- `REXBID_REFRESH_20261008/run-*.json`, `transport-ledger.ndjson`, `campaign-stop.json`, `failure-readback.json`, `run-state-recovery.json` — próby, STOP i recovery bez wznowienia.
- `REXBID_REFRESH_20261008/staging-merge-plan.json`, `staging-merge-result.json`, `staging-before-protected.json`, `staging-after-protected.json` — merge i porównanie 19 tabel.
- `REXBID_REFRESH_20261008/final-readonly-audit.json` — końcowe liczby obu D1, walidacja, zgodność budżetu i zachowanie chronionych tabel.
- `private-backups/rexbid/refresh-after-20261008/manifest.json` i `REXBID_REFRESH_20261008/after-backup-local-restore.json` — kopie po zmianie i lokalny restore/integralność; drugi komputer nieweryfikowany.
- `REXBID_TEST_REFRESH_FINAL_20261008.log`, `REXBID_REFRESH_DRYRUN_FINAL_20261008.log`, `REXBID_PUBLICATION_DRYRUN_REFRESH_20261008.log`, `REXBID_REFRESH_DEPLOY_FINAL_20261008.log` — suite, build i staging Version ID.
- `REXBID_QA_REFRESH_20261008/http.json`, `browser.json` i wymienione screeny — końcowe 22 HTTP kontrole oraz rzeczywiste desktop/mobile QA.
- `REXBID_DNS_READINESS_REFRESH_20261008.json`, `REXBID_CF_DNS_READINESS_REFRESH_20261008.json`, `REXBID_PARENT_DS_READINESS_ALTERNATIVE_20261008.json`, `REXBID_PARENT_DS_FINAL_20261008.json` i `REXBID_DNS_OPERATOR_LOG_SAFETY_20261008.json` — odczyty DNS/CF i bezpieczny log.

Raport uzupełniono z lokalnych receipts i końcowego QA operatora. Samo przygotowanie dokumentu wykonało **0 nowych wywołań sieci/providera, 0 deployów, 0 commitów i 0 zmian DNS**. Nie zawiera wartości sekretów, prywatnych rozmów, haseł ani kodów MFA.

Końcowa kontrola przed lokalnym checkpointem ponownie potwierdziła 812/812 PASS, oba generatory, trzy walidatory, składnię i diff. Log: REXBID_TEST_REFRESH_CHECKPOINT_20261008.log. Kontrola własnych 60 logów/receipts i 20 zmienionych plików względem znanych lokalnych wartości sekretów: 0 wystąpień, 0 wypisanych wartości (REXBID_REFRESH_LOG_SAFETY_20261008.json). Nie jest to odczyt Bitwarden ani dowód odzyskania na drugim urządzeniu.
