## 15.10.2026 — kopia przed konfiguracją właściciela

Odseparowana produkcyjna D1: `C:/Users/nowic/Documents/Codex/private-backups/rexbid/owner-setup-before-20261015`, 12:46:27 UTC (14:46 CEST). DPAPI CurrentUser i ACL właściciel/SYSTEM; jawny SQL usunięty po kontroli. 31 098 306 B, SHA256 SQL `8fe98c5887db031750df9e3bde738b4bde78905e31252fb21d481300e6b18616`. Odtworzenie w RAM 12:47:34 UTC: 28 tabel, integralność OK, FK 0, schemat i wcześniejsze rekordy zachowane przy podwójnej lokalnej migracji 0003/0006/0007. Syntetyczny test zamknięcia konta i rollback PASS. Zdalnych migracji nie wykonywano.

Kopia zawiera obecną D1 z dwoma kontami, ale nie zastępuje kopii tożsamości i MFA Supabase. Odtworzenie sprawdzono na tym komputerze; drugi komputer nadal niesprawdzony. Retencja tej kopii: 30 dni według zatwierdzonych zasad, ręczny przegląd. Nie odczytywano Bitwarden. Bieżące dowody poza Git: `C:/Users/nowic/Documents/Codex/REXBID_OWNER_SETUP_20261015`.

---

## 14.10.2026 — kopia bezpośrednio przed aktywacją kont

Kopia D1 `c8a30088-70af-43a6-9a7f-c4018279d37d` z 17:36:35 UTC: `C:/Users/nowic/Documents/Codex/private-backups/rexbid/auth-activation-before-20261014`. Szyfrowanie DPAPI CurrentUser, NTFS właściciel/SYSTEM, jawny SQL usunięty po kontroli. 30 448 734 B; SHA256 SQL `2e591eeace8d57140addb70924df2c7821f8e3f1a4f9c8d12b43f200d163e251`.

Odtworzenie w RAM 17:37:03 UTC: 28 tabel, integralność OK, FK0, schemat i istniejące rekordy zachowane po dwukrotnym zastosowaniu 0003/0006/0007; syntetyczne zamknięcie konta z rollbackiem PASS. Zdalnych migracji nie wykonywano. D1 nie zastępuje backupu tożsamości/MFA Supabase. Drugi komputer nadal niesprawdzony; nie odczytywano Bitwarden.

Właściciel zatwierdził 14.10 retencję ręcznych kopii danych kont: zwykłe do 30 dni, przed istotną migracją do 90 dni, ręczny przegląd miesięczny. Obecna kopia aktywacyjna nie poprzedza migracji — stosować 30 dni. Nie usuwać ostatniej sprawdzonej kopii bez nowszej sprawdzonej kopii; wyjątek musi mieć odnotowaną przyczynę. Żadnych danych nie usunięto w ramach tej akceptacji. Rejestr zamknięć stosować przed ponownym udostępnieniem odtworzonych danych.

---

## 14.10.2026 — kopia przed etapem kont

Najnowsza kopia odseparowanej D1: C:/Users/nowic/Documents/Codex/private-backups/rexbid/accounts-before-20261014, godz.16:50:12 UTC. DPAPI CurrentUser i NTFS właściciel/SYSTEM. SQL 30 425 384 B; SHA256: 064da7ff7c386a38b6532795d4b80beb3baa07465d7913d6de4f56591764bec8. Jawny SQL usunięty po kontroli zabezpieczenia. Odtworzenie w RAM o16:54:16 UTC: 28 tabel, integralność OK, FK0. Rekordy i schemat bez zmian po dwukrotnym zastosowaniu 0003/0006/0007. Brak zdalnych migracji.

Syntetyczny test zamknięcia konta tylko w lokalnej D1: dokładna tożsamość, ochrona właściciela, usunięcie powiązanych ulubionych, zachowanie innego konta i rollback PASS. To nie test zamknięcia konta Supabase. Przed przyszłym odtworzeniem zastosować rejestr wykonanych usunięć: [procedura](ACCOUNT_DATA_PRIVACY.md). Backup D1 nie obejmuje tożsamości Supabase ani MFA. DPAPI zależy od obecnego profilu Windows; odtworzenia na drugim komputerze nie potwierdzono. Wcześniejszy Bitwarden PASS pozostaje ręcznym wynikiem. Nie odczytywano sejfu.

Kontrola po wdrożeniu o17:06 UTC: osiem chronionych tabel w każdej D1 ma identyczne liczby i SHA256 przed/po. Publiczny katalog zmienia się niezależnie przez Cron. Nie odtwarzać całej bazy z powodu regresji kodu. [Wersje i rollback](ACCOUNTS_RELEASE_2026-10-14.md).

---

## 14.10.2026 — kopia przed automatycznym odświeżaniem produkcji

Świeża kopia wyłącznie D1 `c8a30088-70af-43a6-9a7f-c4018279d37d`: `C:/Users/nowic/Documents/Codex/private-backups/rexbid/automatic-refresh-before-20261014`. DPAPI CurrentUser, ACL właściciel/SYSTEM; manifest, SHA i roundtripPASS. SQL30 194 905B, plaintextSHA256 `098e4d0b00d8bd9d8182cd7825c42e897a155b8f2d3c0afebc53f7008972bee1`, ciphertextSHA256 `103301ba9ed2c6c1777269f2c818266d38575f032aefb3068a6a0806b6e9b0a2`. Jawny plik tymczasowy usunięto po kontroli. Sekrety i backupy pozostają pozaGit.

Odtworzenie SQLite w pamięci: integralnośćok/FK0,1817ofert/3253snapshoty/19044wydarzenia/1638potwierdzeń historii, prywatne tabele0. Migrację0008 zastosowano lokalnie dwukrotnie; fingerprint wszystkich wierszy23dotychczasowych tabel bez zmian,5nowych tabel. Zdalna migracja dotyczyła wyłącznie automatu, bez Accounts i bez stagingu. To test na obecnym komputerze zDPAPI, **nie test drugiego urządzenia**; wcześniejsze5pozycji sejfu mają osobny ręcznie zgłoszony PASS bezDPAPI. Sejfu nie odczytywano.

Od14.10 działa Cron w produkcji, więc kopia sprzed etapu nie zawiera późniejszych ofert/prób. Przed odtworzeniem wykonać STOP i kopię bieżącego stanu, zachować ledger oraz wszystkie późniejsze obserwacje. [Dokładna procedura STOP/rollbacku](AUTOMATIC_REFRESH_RUNBOOK.md), [wyniki i dowody](DEVELOPMENT_STAGE_2026-10-14.md). Przy niepewnej partii najpierw readback; nie zerować budżetów i nie wgrywać starego dumpu nad działającą bazą. Aktualizacja kodu nie wymaga cofania addytywnego schematu.

Nowy produkcyjny VersionID **aaa709e1-24eb-4985-aa73-851c2baa0a05**, punkt sprzed etapu **1cd69740-fda8-495a-a895-587f135cf077**. Samo cofnięcie wersji nie usuwa harmonogramu Cloudflare. Staging **0db16a3d-d7d9-4c05-95e4-1041f799cd1b** wdrożono bez zmian jego danych, poprzedni **85a44ee5-5b9d-4a6d-ac35-1b7456535a12**. Konta/MFA pozostają w osobnym Supabase; D1 nie jest backupem haseł i czynników.

---

## Najnowszy checkpoint preflight — 10.10.2026, transfer ukończony

Nowe kopie poza Git: `private-backups/rexbid/publication-ready-resume-before-20261010` i `publication-ready-complete-20261010` w Documents/Codex. Nie nadpisano poprzednich. Końcowy SQL30194905B, SHA256 `098e4d0b00d8bd9d8182cd7825c42e897a155b8f2d3c0afebc53f7008972bee1`. DPAPI roundtrip oraz SQLite restore wyłącznie w pamięci PASS: integrityok/FK0,1817/3253/19044/1638, prywatne dane0. Na obecnym komputerze, nie drugim urządzeniu; sejf nadal ma osobny wcześniejszy offline PASS. Nie deklarować przenośnego odtworzenia całej bazy.

Transfer276/276,inflightnull,stopnull, brak pending w starym ledgerze. Rollback kodu stagingu do6c7d016d; baza stagingu nie została zmieniona. Odtworzenie publikacyjnej D1 do nowego osobnego zasobu po readbacku, bez destrukcyjnego wgrywania dumpu. [Aktualny raport](PUBLICATION_COMPLETION_QA_2026-10-10.md). Poniższe instrukcje STOP206 są historyczne.

## Poprzedni checkpoint preflight — 9.10.2026, transfer przerwany na budżecie

[Raport i wznowienie](PUBLICATION_PREPARATION_QA_2026-10-09.md) opisuje dwa backupy wyłącznie odseparowanej D1 c8a30088: `private-backups/rexbid/publication-ready-before-20261009` i `publication-ready-paused-20261009`, DPAPI CurrentUser + prywatny ACL, roundtripPASS. Pierwszy odtworzono w pamięci i sprawdzono pełny lokalny transfer, integrity/FK oraz ceny/wydarzenia. Drugi zabezpiecza206 ukończonych partii. Nie oznacza to odtworzenia na innym komputerze.

Zachować poza Git folder `REXBID_PUBLICATION_READY_20261009` (plan, oba capture, dowody, build, transfer-progress) oraz **wspólny** `REXBID_D1_ACCOUNT_BUDGET/ledger.ndjson`. Nie nadpisywać planu przy wznowieniu, nie zerować licznika, nie usuwać blokady po awarii. Niepewna partia wymaga readbacku. Po kolejnym resecie UTC odczytać metryki konta i stan bazy, odświeżyć backup, kontynuować70 pozostałych partii i ponowić audyt. Brak powtórnych requestów Apibara.

Przygotowanie pozostaje prywatne; rollback nie dotyka mtbid/stagingu. Nie odtwarzać dumpu w działającej bazie. W razie utraty danych odtworzyć osobny zasób, sprawdzić dane i dopiero po zgodzie zmienić binding. Kolejne wykonanie publikacji/DNS nadal wymaga odrębnej akceptacji.

## Kopia stagingu — 9.10.2026, przed uzupełnieniem marek

Kopia wyłącznie rexbid-auth-test-db/acb3cb8e-69a2-459f-8a46-0f2f5b9004be: C:/Users/nowic/Documents/Codex/private-backups/rexbid/coverage-before-20261009. Manifest12:55:37UTC, plaintext29306211B, SHA256 fef941c953debf1809ce0f91a34bd22f0544c41c53a993ac1f5ef73c3d4e9eb6. DPAPI CurrentUser/ACL oraz roundtripPASS; jawna kopia usunięta, wszystko pozaGit. To nie jest test drugiego urządzenia.

Po zapisie179nowych publicznych ofert:1817listings/3253snapshots/19044events. Audyt13:19:50UTC potwierdził18chronionych tabel i wszystkie dotychczasowe wydarzenia bez zmian; FK/duplikaty0. Zapisane publiczne odpowiedzi, observedAt i checkpoint179 znajdują się pozaGit w REXBID_COVERAGE_AUDIT_20261009. Nie pobierać ich ponownie przy odtwarzaniu. [Pełny raport](CATALOG_COVERAGE_QA_2026-10-09.md).

Rollback samego kodu:6c7d016d →3e8a742c po wykrytej regresji; brak potrzeby cofania schematu. Nigdy nie przywracać starej kopii w miejsce działającej D1 bez uzgodnionego odtworzenia do osobnej bazy i porównania późniejszych kont/wiadomości/plików. Alert limitu zapisów D1 sam nie uzasadnia restore ani usuwania danych. Kolejne zapisy wymagają osobnego budżetu D1; historyczny STOP56 i obecny koniec transportu1774 zachowane.

---

> **8.10.2026 — zamknięcie historii 40/40.** Zweryfikowany pełny backup history-before-20261008 i lokalne odtworzenie w pamięci pozostają zachowane. Kontynuacja zabezpieczyła 60 publicznych wydarzeń / 38 receipts przed zapisem oraz 61/40 po zapisie, poza Git w REXBID_HISTORY_QA_20261008/final-two. Fingerprints, receipts, FK i chronione hash/count PASS. Nie zmieniano danych prywatnych ani nie odtwarzano działającej bazy. Do recovery użyć pełnej szyfrowanej kopii oraz zweryfikowanych odpowiedzi, odtwarzając je z prawdziwymi observedAt. Porównać final-audit i zachować wszystkie 61 wydarzeń. Obecny Worker 21522ccb nie był redeployowany. [Raport](HISTORY_ENRICHMENT_QA_2026-10-08.md).

## Historia obu platform — backup przed zapisami, 8.10.2026, 17:37 UTC

Nowa pełna kopia **wyłącznie stagingowej D1** `acb3cb8e-69a2-459f-8a46-0f2f5b9004be`: `C:/Users/nowic/Documents/Codex/private-backups/rexbid/history-before-20261008`. SQL pozostaje poza Git, ACL owner/SYSTEM + DPAPI CurrentUser. Manifest z17:37:04.884 UTC zawiera SHA ciphertext/plaintext i roundtrip PASS. Plaintext SHA **d21c4f4e01401208a41891c72a1bc33df181bf9e630388e2a7e2fc0b4ee4005b**, ciphertext SHA **eb1d18159ed7183d29e7ecb60c49f3edeb868a002310187ee9adc3f7052765cd**. Pełny restore SQLite w pamięci 17:42:41 UTC: checksum PASS, integrity=ok, FK=0. To aktualny komputer; nie niezależne drugie urządzenie. Plain SQL tymczasowy usunięto po zabezpieczeniu i kontroli roundtrip.

Counts kopii: users/favorites/orders/messages/files **2/2/2/4/3**, sources/listings/snapshots/events **1638/1638/1682/4**. Kopia jest stanem sprzed historii. Po wznowieniu i zapisach **60 events/38 receipts**; finalny direct readback 18:49:46.512 UTC: wszystkie chronione hash/count oraz non-history scopes niezmienione, duplicates/FK 0. Każdy z38commitów ponownie sprawdzono fingerprint/receipt. Nie odtwarzano backupu na działającą bazę.

Nowy operator historii zatrzymany **TARGETED_HISTORY_IDENTITY_MISMATCH39/98**; ledger zachowany, oryginalnySTOP 56 nietknięty. Poprzedni latch3/62 zarchiwizowano dopiero po readback PASS. [Wynik i procedura](HISTORY_ENRICHMENT_QA_2026-10-08.md). Rollback stagingowego kodu z21522ccb-b342-408f-a649-65d4b7720dc4 do 5e6f2c25 zachowuje60 rzeczywistych events, bez rollbacku schematu. Przy konieczności odzyskania danych: osobna D1, pełna kontrola schematu/checksum/FK/hash/count i reconciliation późniejszych zapisów po odrębnej zgodzie; nigdy destrukcyjny restore starej kopii do działającej D1. Sekrety/SQL/backupy pozostają poza Git.

---

## Poprzednia kontrola po końcowych dokumentach i demo — 8.10.2026, 16:13 CEST

Tylko kod/UI/dokumenty; **bez migracji i zapisów D1**. Staging SELECT przed/po: users/favorites/orders/messages/files **2/2/2/4/3**, sources/listings/snapshots **1638/1638/1682**, rows_written=0/changed_db=false. Receipts poza Git: REXBID_VARIANT_A_D1_BEFORE.json i REXBID_DEMO_D1_FINAL.json. Odczyt licznika odseparowanej D1: 56/1000, 25/31, retry=0 / reserved=0; lokalny STOP i 56 wpisów licznika zachowane.

Nie ponawiano restore bez zmiany schematu. Ostatni rzeczywisty lokalny restore 8.10, 10:36:53 UTC i szyfrowane kopie 10:22:31 UTC pozostają wcześniejszym dowodem, nie nowym testem. Przed późniejszą publikacją porównać pełny stan/schemat/manifest SHA; przy zmianie wykonać nowy backup. Sama zgodność countów nie dowodzi identycznych danych.

Staging final **69d632c2-4f53-4d08-9602-6cd60de43d8e**; rollback do **0dd0ea83-6777-4df8-a30b-7ba74a0664f3** nie wymaga cofania schematu. Uwaga: cofa też poprawki obserwacji/powrotu i kompletne teksty; używać jedynie przy krytycznej regresji. Przygotowany lokalny checkpoint obejmuje kod i publiczne dokumenty, nie receipts, cache, SQL lub sekrety. Dokładny SHA: git log -1.

Publikacja nadal nie ma poprzedniego działającego publicznego wydania na nowym Workerze: prywatny 0a876baa nie jest rollbackiem katalogu. Preferować zgodny build nowego Workera albo odpięcie jego routingu. Parking 213.186.33.5 nie przywraca katalogu. Odtworzenie danych wyłącznie do osobnej D1, kontrola FK/count/schema i osobna zgoda na rebind. DNS/DS/TTL mają oddzielną procedurę w runbooku. Retencja kopii 30/90 dni to propozycja z DATA_RETENTION_REVIEW.md, jeszcze bez kasowania/automatyzacji.

---

## Historia — wcześniejsze dowody; bieżący stan opisano powyżej

## Kontrola po zmianach treści i danych podmiotu — 8.10.2026

Sprint zmienił kod, treści i routing stagingowych aliasów, bez zmian schematu i zapisów D1. Odczyty przed, po i po końcowym deployu, wyłącznie read-only, potwierdziły identyczne liczby wierszy:

| Tabele | Wiersze przed i po |
| --- | ---: |
| users / favorites / orders / messages / files | 2 / 2 / 2 / 4 / 3 |
| sources / listings / snapshots | 1638 / 1638 / 1682 |
| changes / rows_written | 0 / 0 |

Końcowy receipt: REXBID_COMPANY_D1_FINAL_20261008.json; changed_db = false.

Zachowano ostatnie szyfrowane kopie z **8.10, 10:22:31 UTC** i ich pełne lokalne odtworzenie z **10:36:53 UTC**, opisane poniżej. Zgodność liczników nie jest nowym testem odtworzenia. Przed faktycznym oknem trzeba porównać aktualność wszystkich tabel z kopią; nowe zmiany danych wymagają nowego eksportu. Niezależny przenośny backup pozostaje późniejszym osobnym etapem, nieblokującym katalogu.

Końcowa wersja stagingu: **0dd0ea83-6777-4df8-a30b-7ba74a0664f3**. Wersja sprzed sprintu: **e4e54eaa-3438-4619-a4c4-aa6648262afb**. Rollback UI tego samego Workera nie wymaga cofania schematu.

Pierwsza publikacja używa nowego rexbid-production-preflight / D1 c8a30088-70af-43a6-9a7f-c4018279d37d, bez zmiany mtbid/rexbid-db. Po zgodzie, TLS i smoke trzeba zapisać pierwszą działającą wersję katalogu. Prywatna wersja 0a876baa nie jest poprzednim publicznym katalogiem.

Odtwarzanie danych: wyłącznie osobny target i reconciliation, bez cofania nowych danych klientów. Rollback DNS osobno uwzględnia DS i TTL. Lokalny checkpoint firmy zawiera tylko kod i publiczną dokumentację; sekrety, SQL i prywatne receipts są poza Git. Statusy sejfu i off-device zapisane niżej pozostają zachowane.

---

## Historia — wcześniejsze dowody, nadrzędny stan powyżej

## Aktualne kopie po odświeżeniu katalogu — 2026-10-08

**Obie kopie odtworzono do lokalnego SQLite w pamięci: PASS.** Eksporty po odświeżeniu i przeniesieniu publicznego katalogu na staging utworzono **2026-10-08 o 10:22:31 UTC**, do osobnego katalogu poza Git: `C:/Users/nowic/Documents/Codex/private-backups/rexbid/refresh-after-20261008`. Chroni je DPAPI CurrentUser oraz NTFS ACL ograniczone do bieżącego właściciela Windows i SYSTEM, z wyłączonym dziedziczeniem katalogu. Agent ponownie sprawdził ochronę katalogu, SHA-256 zaszyfrowanych plików oraz zgodność długości i SHA-256 odszyfrowanego SQL z manifestem. Kopia przed etapem `refresh-before-20261008` pozostaje zachowana.

| Baza po odświeżeniu | Wielkość SQL | SHA-256 SQL |
| --- | --- | --- |
| Staging `rexbid-auth-test-db` / `acb3cb8e-69a2-459f-8a46-0f2f5b9004be` | 8 245 274 B | `017bf84083bbb801c02386ccb52754419a7e20e9397db389f5922a4ae8f0050d` |
| Izolowana publikacja `rexbid-production-preflight-db` / `c8a30088-70af-43a6-9a7f-c4018279d37d` | 8 202 146 B | `44cc429858c59eeb397b6c4a59c8185ff59799ee69d2122af5251062ef435143` |

Zgodne SHA-256 ciphertextów: staging `5b2ce56e1aaa61661a7d1008f3eb38aad8b32008272de8cb85a1f775e88d92c1`, izolowana publikacja `82f696c0a4cd86f166aea9e83543808a06345fa7164fb1090461c0d8a20ad1a0`.

**Pełny lokalny restore zakończono o 10:36:53 UTC.** DPAPI odszyfrowano w pamięci i przekazano SQL przez stdin do osobnego procesu; helper utworzył wyłącznie `node:sqlite :memory:`. Nie powstał jawny plik SQL. Dla obu odtworzonych baz `integrity_check=ok`, naruszenia FK=0 i duplikaty znormalizowanej platformy/LOT=0. Każda zawiera sources/listings=1638, snapshots=1682, events/entities=0; Copart 840 ofert / 624 z mediami, IAAI 798 ofert / 739 z mediami. Katalog nadal jest częściowy; kopia nie stanowi dowodu aktualnej dostępności wszystkich historycznie zachowanych ofert.

Staging zachował users=2 / favorites=2 / orders=2 / messages=4 / files=3 oraz message-read receipts=0. Hashe uporządkowanych zbiorów wierszy prywatnych tabel Accounts i `import_order*`, z obydwu odtworzonych kopii przed i po etapie, są zgodne. Nie wypisywano ich treści, szyfrogramów ani sekretów. Izolowana publikacja ma wszystkie te tabele puste; `portal_customer_profiles=0` w obu bazach. Stagingowy import obejmował wyłącznie cztery tabele publiczne i nie kopiował kont, realizacji, wiadomości, plików, scope'ów, runs ani budżetów. Lokalny rehearsal tego merge'u potwierdził idempotentny replay, atomowe grupy oraz niezmienione hashe wszystkich 19 tabel spoza publicznego katalogu. Czynników MFA Supabase i obiektów R2 nie odtwarza ten eksport D1; wcześniejsze konta, sesje i pliki pozostają oddzielnymi zasobami.

Receipt po pełnym restore: `C:/Users/nowic/Documents/Codex/REXBID_REFRESH_20261008/after-backup-local-restore.json`; receipt próby merge'u: `local-merge-rehearsal.json` w tym samym katalogu. Oba zawierają agregaty i hashe, bez jawnego SQL, rekordów klientów lub wartości sekretów. W tej kontroli provider requests=0 i remote database writes=0. To dowód odtworzenia na bieżącym komputerze i profilu Windows. **Odzyskanie na drugim urządzeniu nadal NOT VERIFIED**, a DPAPI nadal zależy od profilu; wcześniejszy same-computer VerifyVault PASS pozostaje odrębnym dowodem dla pięciu pozycji sejfu.

Rollback kodu stagingu lub przyszłej publikacji wykorzystuje zapisaną wcześniejszą wersję właściwego, odseparowanego Workera. Rollback danych katalogu: zatrzymać operatorowy refresh, zachować trwały licznik kampanii i receipt, wykonać kopię incydentu, odtworzyć wybraną kopię do **nowej osobnej bazy**, porównać schema/count/FK, platformę/LOT/VIN, daty obserwacji oraz całą historię i dopiero uzgodnić przepięcie bindingu. Przy korekcie stagingowego katalogu używać publicznego merge'u z ochroną nowszych summary/detail observations i późniejszego `detail_synced_at`, zachowując prywatne i operacyjne tabele. Nie cofać całego stagingu do starego dumpu kosztem późniejszych danych klientów; nie usuwać snapshots ani receiptów. Bieżący `mtbid` i produkcyjna `rexbid-db` nie są celami tej operacji. Bez DROP, restore w miejscu lub destrukcyjnego rollbacku obecnej produkcji.

## Potwierdzenia sejfu i historia odtworzenia — 2026-10-07

Właściciel potwierdził **LOCAL VERIFYVAULT PASS — SAME COMPUTER** dla pięciu pozycji: REXBID_AUTH_COOKIE_SECRET, pełnego REXBID_PORTAL_DATA_KEYS, REXBID_PORTAL_ACTIVE_KEY_ID, SUPABASE_URL i SUPABASE_PUBLISHABLE_KEY. Wszystkie wartości, cały keyring i aktywny ID były zgodne ze źródłem, bez użycia DPAPI. To ręcznie zgłoszony wynik rzeczywistego lokalnego weryfikatora; agent nie otwierał Bitwarden ani nie odczytywał sekretów.

Osobno zapisano produkcyjny klucz SMTP Resend, hasło bazy Supabase i APIBARA_API_KEY. Ich zapis ma status **MANUAL OWNER-CONFIRMED / NOT TECHNICALLY VERIFIED**. Nie regenerowano ani nie zmieniano sekretów.

Odzyskanie na drugim urządzeniu jest **NOT VERIFIED**. Lokalny PASS bez DPAPI nie potwierdza przenośnego odtworzenia danych Git/SQL/R2. Kopie zaszyfrowane DPAPI nadal wymagają osobnej przenośnej kopii. Nie trzeba powtarzać zakończonego transferu ani lokalnej kontroli. Zewnętrzny receipt zawiera wyłącznie nazwy i statusy, bez wartości sekretów.

### Świeże kopie i lokalny rehearsal — profesjonalny staging, 2026-10-07

Przed zatwierdzoną zmianą stagingowego schematu i zasileniem izolowanego preflightu wykonano eksporty **wyłącznie rexbid-auth-test-db i rexbid-production-preflight-db**, 7 października o 16:02 UTC. Bieżącej produkcyjnej rexbid-db nie eksportowano ani nie modyfikowano w tym sprincie. Katalog poza Git: `C:/Users/nowic/Documents/Codex/private-backups/rexbid/professional-before-20261007`, NTFS ACL bieżący właściciel/SYSTEM, DPAPI CurrentUser. Jawne pliki usunięto wyłącznie ze sprawdzonych ścieżek po szyfrowaniu/checksum/roundtrip.

| Kopia przed zmianą | Wielkość SQL | SHA-256 jawnego SQL, zachowany w manifeście |
| --- | --- | --- |
| Staging | 2 583 526 B | `5f71fa63f8458690d5f468c68d1948acf76505a3821f5ab93b2f8ca0f2044bf2` |
| Izolowany preflight przed seedem | 7 964 B | `f7e4367d112cbebbce9521b5e7d0aa40346fad5b9fad808bdc3537bbfbec958e` |

Rzeczywiste odszyfrowanie w pamięci → disposable SQLite → lokalne addytywne migracje i FK/county **PASS** o 16:03 UTC. To nie nowy remote restore, nie test drugiego urządzenia i nie kontrola produkcyjnego MFA. Staging zachował users=2 / favorites=2 / orders=2 / messages=4 / files=3, źródłowe sources/listings=579 i snapshots=584, FK=0. Addytywne 0007 tworzy message-read receipts oraz indeks; nie zmienia historycznych nadawców, szyfrogramów ani czynników MFA. Remote staging readback po zastosowaniu 0007 zachował powyższe county; początkowo receipts=0. Tabelę i indeks zachować także po rollbacku starego kodu, bez DROP.

Nowy preflight dostał addytywne 0004 i 0007 oraz publiczny snapshot **579 listingów (352 Copart / 227 IAAI), 584 snapshots, 281 listingów z 8063 URL, events/entities=0**. Users/favorites/orders/messages/files=0, brak importu stagingowych tożsamości/MFA/realizacji/plików lub kluczy. Ledger 0000/1/2/3/4/6/7; media columns są w 0004, więc 0005 nie powtarzano. Dwa scope partial bez cursorów, bez last_success/last_complete. Źródłowe daty obserwacji 29 września → 5 października zachowane, nie odświeżone przez import. Readback duplikatów platforma/LOT i FK=0. Dowody bez danych prywatnych: `REXBID_PROFESSIONAL_LOCAL_RESTORE_20261007.json` i `REXBID_PUBLIC_CATALOG_SEED_20261007.json`, poza Git w Documents/Codex.

**Kopia po seedzie i staging 0007 została wykonana o 16:27:18 UTC**, do osobnego katalogu `C:/Users/nowic/Documents/Codex/private-backups/rexbid/professional-after-20261007`. Restricted ACL + DPAPI CurrentUser, checksum i roundtrip **PASS**, jawnego SQL nie pozostawiono. Staging SQL 2 584 002 B / SHA-256 `427a6cd8896fe203a1b51cb3370d1d42b09b50c707368eb53f2722760b4b1e25`; preflight SQL 2 392 317 B / SHA-256 `94963738a9002abea9ec039468b3f7e510269b70ccf188f5ddafe3b5ebd6b3f2`.

**Pełny restore tych późniejszych eksportów do osobnego SQLite w pamięci PASS o 16:32:03 UTC.** Porównano schema/count/FK; staging users=2 / favorites=2 / orders=2 / messages=4 / files=3 zachowane. Izolowany cel: prywatne tabele=0, sources/listings=579, snapshots=584, FK=0. Receipt poza Git: `C:/Users/nowic/Documents/Codex/REXBID_PROFESSIONAL_AFTER_RESTORE_20261007.json`. To rzeczywisty local memory rehearsal, nie remote restore i nie off-device odzyskanie. Sam wcześniejszy roundtrip nie był przedstawiany jako restore; ten odrębny test uzupełnia dowód.

Backup preflight z 16:02 UTC pozostaje historyczną kopią pustego celu przed seedem; kopia z 16:27 UTC obejmuje publiczne oferty i ma potwierdzony restore. Przed osobno zatwierdzoną publikacją sprawdzić jej aktualność względem świeżego readbacku; przy zmianach danych wykonać nowy eksport/rehearsal. Nie nadpisywać starych punktów. Zawartości prywatnych plików/R2 nie były ponownie eksportowane w tym sprincie; wcześniejsza zaszyfrowana kopia pozostaje historyczna.

### Zakres kopii przed zatwierdzoną publikacją

Nowe wydanie użyje wyłącznie rexbid-production-preflight i D1 `c8a30088-70af-43a6-9a7f-c4018279d37d`. Nie jest już pustym schematem: ma powyższy publiczny snapshot i ledger 0000/0001/0002/0003/0004/0006/0007. Nie migruje ani nie przepina mtbid/rexbid-db. Przed zatwierdzonym oknem potwierdzić aktualność szyfrowanej kopii **danych i schematu**, SHA-256 oraz manifest count/FK/daty obserwacji; zapisać prywatny Worker Version `0a876baa-7b80-44ce-9d85-602ff8c82314` i przyszłą wersję publikacji. Po uruchomieniu kont/portalu kopia musi obejmować ich rekordy oraz odrębne dane Supabase. Sam publiczny seed nie jest backupem prywatnego stagingu.

Pierwszy przygotowany profil używa stored catalog bez provider fallbacku, Auth/portal/files OFF i bez bindingu R2. Rollback Auth/portalu wraca do zapisanej, działającej wersji katalogu **tego samego nowego Workera**, z tą samą D1 i zachowanymi kluczami. Wersja mtbid nie jest rollbackiem nowego targetu. Utrata danych: zatrzymanie zapisów → kopia incydentu → restore do osobnej D1 → porównanie schematu/countów/FK/dokładnej tożsamości platforma/LOT i uzgodnienie rekordów → zgoda na przepięcie. Bez DROP i restore starego dumpu w miejscu. Częściowa migracja: STOP, flags OFF, porównanie ledger/DDL i checksum z plikiem; addytywna idempotentna naprawa lub osobno zatwierdzony restore. Sam rollback kodu nie naprawia schematu/danych.

Eksport D1 nie zawiera użytkowników/hasła/MFA Supabase ani obiektów R2. Cały keyring musi pozostać dostępny również po przyszłej zmianie aktywnego ID. W bieżącym pakiecie **nie wykonuje się migracji obecnej produkcji**. [Pełna kolejność i rollback](PRODUCTION_CUTOVER_RUNBOOK.md).

Metadane Cloudflare potwierdziły obecność APIBARA_API_KEY w izolowanym preflight, bez odczytu wartości i bez upstream requestu. Sejf: pięć pozycji same-computer offline PASS bez DPAPI, pełny keyring/aktywny ID; osobno SMTP key / DB password / APIBARA key zapisane tylko ręcznie. Drugiego urządzenia i pełnego off-device DR nie sprawdzono. Nie powtarzać zakończonego transferu, nie rotować kluczy i nie odczytywać ich z Bitwarden w celu dokumentacji.

Właściciel około 17:20–17:43 CEST ręcznie odczytał R2 Class A 15 / Class B 39, 519,36 kB, staging 3 obiekty / produkcyjny bucket 0, 0 USD; D1 odczyty 389 / zapisy 104 / 3,04 MB / 5 baz, 0 USD. Nie są to własne pomiary API ani gwarancja przyszłych kosztów. Produkcyjne pliki nadal OFF; dashboard/alert nie jest twardym limitem naliczania. Odzyskanie kluczy na drugim komputerze oraz miesięczna kontrola całego konta R2 pozostają osobnymi dowodami.

---

## Historia wcześniejszych kontroli — poniższe statusy nie zastępują aktualizacji powyżej

# Świeży odczyt odseparowanego preflight D1/R2 — 2026-10-07

**REMOTE READ-ONLY VERIFICATION PASS.** Kontrola wykonana 2026-10-07 **10:39–10:40 UTC** (12:39–12:40 CEST), po przygotowaniu niepublicznego Workera. Nie zastosowano żadnej migracji, nie zapisano rekordów D1/R2, nie pobrano zawartości plików i nie uruchomiono sync/discovery.

- Target: wyłącznie `rexbid-production-preflight-db`, UUID `c8a30088-70af-43a6-9a7f-c4018279d37d`, konto `7ff5a57444667c4eda2a6a7f0fc4120d`. To **nie jest** działająca produkcyjna `rexbid-db` ani stagingowa `rexbid-auth-test-db`.
- Faktyczny ledger preflight: `0000`, `0001`, `0002`, `0003`, `0006` — pięć istniejących wpisów. Brak Sync2/0004.
- Wszystkie tabele biznesowe oraz budżetowe mają **0 wierszy**: users, favorites, orders, events, messages, files, customer_profiles, legacy, budgets, reservations i guards. Tylko `d1_migrations=5`.
- `PRAGMA foreign_key_check`: **0 naruszeń**.
- Pełne odczytane DDL **26 tabel/indeksów aplikacyjnych** porównano lokalnie z aktualnymi plikami SQL `0000/1/2/3/6`: **identyczne po normalizacji whitespace**. Hash porównanego schematu: `e17aa96ad300c257332231c89ee2f1fc3104c465ddbefb8fcd5244652fe58fcf`. Systemowe `_cf_*`, `sqlite_*` i ledger nie są w tym fingerprint.
- Produkcyjny izolowany R2 `rexbid-production-private-files`: **Standard**, `r2.dev` **OFF**, custom domains **0**, CORS nie skonfigurowane. Bezpośrednia lista obiektów HTTP200: **0 obiektów**, bez odczytu treści.

Sanitizowany dowód operatora poza Git: `C:/Users/nowic/Documents/Codex/REXBID_PREFLIGHT_READONLY_20261007.json`. R2 list receipt: `REXBID_PREFLIGHT_R2_EMPTY_20261007.json`. Wynik potwierdza pusty, odseparowany schemat i prywatny bucket; **nie potwierdza publicznego runtime produkcji, pocztowego E2E ani miesięcznego billing hard capu**. Nowy preflight nie zawiera testowych kont lub realizacji. Istniejące produkcyjne i stagingowe dane oraz MFA pozostają zachowane.

---

# Kontrola istniejących kopii i warunki aktywacji plików — 2026-10-07

W tej kontynuacji wykonano **odczyt metadanych i SHA-256 zaszyfrowanych plików**, bez odszyfrowywania wartości kluczy, tworzenia nowych kluczy lub zmiany zasobów. Ta kontrola nie jest nowym eksportem D1/R2 ani nowym remote restore.

## Kontrola chronionego katalogu

Katalog: `C:/Users/nowic/Documents/Codex/private-backups/rexbid/production-environment-20261006T182151Z`. Hash każdego z poniższych ciphertextów zgadza się z odpowiednim istniejącym manifestem:

- `rexbid-db.sql.dpapi` — PASS;
- `rexbid-auth-test-db.sql.dpapi` — PASS;
- **`new-production-keys-v1.json.dpapi`** — PASS; to aktywna kopia wskazana przez `manifest.new_keys.file`, nie wcześniejszy zastąpiony plik bez `-v1`;
- `rexbid-production-preparation-final.git.bundle.dpapi` — PASS, zawiera checkpoint `b8872972cc228ccd9f3c274b5f776a7892bc6728`.

ACL katalogu ma wyłączone dziedziczenie i dostęp ograniczony do właściciela Windows oraz SYSTEM. Manifest zachowuje wcześniejsze dowody DPAPI roundtrip, restore/fsck i lokalnego rehearsal. Powtórzone **syntetyczne testy operatorowego rollback/replay: 2/2 PASS**. Nie powtarzano zdalnej próby ani ręcznego recovery. Rzeczywisty stagingowy e-mail E2E był testem **konta klienta**, wykonywanym przez właściciela; nie zmieniono hasła ani MFA właściciela administracji.

Kopia z 6 października pozostaje odtwarzalnym punktem historycznym. Przed przyszłą zmianą produkcyjnych danych lub schematu trzeba ponownie wykonać świeży eksport, odczyt liczników i rehearsal; sam zgodny hash ciphertextu nie potwierdza aktualności danych.

## Niezależna kopia kluczy w Bitwarden — narzędzie przygotowane 2026-10-07

**SOURCE / TOOL / LOCAL RESTORE CHECKS VERIFIED. MANUAL TRANSFER OWNER-CONFIRMED; VAULT READBACK / OFF-DEVICE RESTORE NOT VERIFIED.** Właściciel 2026-10-07 potwierdził zapis wszystkich pięciu pozycji w Bitwarden, normalne zamknięcie narzędzia i brak przesyłania wartości w czacie. To ręczne potwierdzenie transferu; nie niezależna obserwacja schowka ani odczyt z sejfu. Gotowy lokalny mechanizm: [dokładna instrukcja transferu i kontroli](PRODUCTION_VAULT_TRANSFER.md), publiczny launcher `scripts/production-vault-launch.cmd`. Wklejenie i zapis wykonuje sam właściciel; narzędzie nie uzyskuje dostępu do Bitwarden, hasła głównego ani sieci.

Kontrolowane pozycje: **REXBID_AUTH_COOKIE_SECRET**, **pełny REXBID_PORTAL_DATA_KEYS**, **REXBID_PORTAL_ACTIVE_KEY_ID**, **SUPABASE_URL**, **SUPABASE_PUBLISHABLE_KEY**. Każda w osobnym wpisie Login, pole Password, URI puste. Aktywne źródła to manifestowy `new-production-keys-v1.json.dpapi` oraz `production-supabase.json.dpapi`; poprzedni plik bez `-v1` nie jest używany. Nie rotowano ani nie regenerowano żadnej wartości.

Rzeczywista kontrola kopii w pamięci: ACL katalogów i plików, checksum aktywnych kluczy, uwierzytelnienie DPAPI, pełny ring/active ID/project isolation PASS. Cookie seal/open i text/binary portal AES-GCM **dla wszystkich zachowanych kluczy** rzeczywistym kodem na syntetycznej treści PASS. Narzędzie kopiuje po jednym polu, ustawia formaty wyłączające historię/cloud clipboard, TTL45s i bezwarunkowo czyści schowek na Next/Finish; zajęty schowek nie jest zgłaszany jako wyczyszczony. Weryfikator ma maskowane pola i TTL30s. Nie tworzy jawnego pliku z sekretami, nie wypisuje ich ani nie przekazuje w argumentach. Testy 17 syntetycznych kontroli oraz pełny suite **671/671 PASS**; agent nie używał prawdziwego schowka.

Dowód `vault-verification-proof-v1.json` w chronionym katalogu `production-auth-20261007` zawiera wyłącznie nazwy, losowy nonce i HMAC kontroli, bez wartości. Razem z publicznymi plikami narzędzia umożliwia **VerifyVault na innym komputerze Windows bez źródłowego profilu i DPAPI**. Właściciel musi odzyskać wszystkie pięć pól z Bitwarden i uzyskać PASS; dopiero po rzeczywistym teście można wystawić nowy zewnętrzny receipt z `portable_off_device_backup=true`. Nie oznaczono tej bramki na podstawie lokalnego testu lub checkboxa zapisania wpisu.

**Oddzielne kopie właściciela nadal wymagane:** produkcyjny Resend SMTP key, hasło DB Supabase oraz APIBARA_API_KEY. Nie ma ich w wymienionych dwóch źródłach; nie twierdzimy, że przeszukano cały komputer. Nie da się odzyskać wartości z listy nazw sekretów Cloudflare lub zamaskowanego SMTP dashboard. Sprawdzić zachowane kopie; ewentualny reissue/reset wymaga osobnego uzgodnienia, bez automatycznej rotacji. Nie eksportować MFA stagingu, kont testowych, service-role ani nie tworzyć R2 S3 keys dla bindingu.

**Granice:** wyłączyć historię/cloud i dodatkowe clipboard managers, nie używać RDP ani nagrywania. Normalne zamknięcie/TTL czyści schowek; zabicie procesu lub awaria OS tego nie gwarantuje. Awaryjny `production-vault-clear.cmd` czyści bieżący schowek po usunięciu blokady. .NET/OS memory/pagefile/dumps nie są jawnie zarządzanymi plikami eksportu i nie mogą mieć gwarancji zerowania. DPAPI SQL/Git/R2 archives nadal nie są pełnym przenośnym DR; sejf kluczy jest jednym elementem odtworzenia.

## R2 Standard: istniejące zabezpieczenia i brak twardego capu rozliczeń

Prywatny bucket produkcyjny `rexbid-production-private-files` pozostaje odseparowany. Dostęp publiczny `r2.dev` i publiczne domeny mają pozostać wyłączone. Sama obecność bindingu nie aktywuje plików: `REXBID_PORTAL_FILES_ENABLED=disabled` blokuje serwis załączników przed `get/put/delete`; Auth/portal mają własne gates.

Sprawdzenie kodu `portal/attachments.cjs`, `portal/crypto.cjs` i `portal/operations.cjs` potwierdza: **8 MiB na plik**, PDF/JPEG/PNG, weryfikację MIME/magic bytes/nazwy pliku, AES-GCM z key ID oraz AAD order/file, SHA-256 po odczycie i `private, no-store`. Upload wymaga właściciela z AAL2; autoryzacja klienta/realizacji i visibility są sprawdzane przed R2. Klient nie może sam deklarować roli ani pobrać pliku wewnętrznego. Te zabezpieczenia nie zastępują miesięcznego limitu kosztów.

Cloudflare R2 Standard ma bezpłatną pulę **10 GB-month, 1 mln operacji Class A i 10 mln Class B miesięcznie**. Przekroczenia są rozliczane według cennika; darmowy transfer nie oznacza darmowych operacji. Free allowance dotyczy Standard, nie Infrequent Access. [R2 pricing](https://developers.cloudflare.com/r2/pricing/), sprawdzone 2026-10-07.

**Nie potwierdzono account billing hard cap.** Obecny kod nie ma trwałego, wspólnego miesięcznego licznika Class A/Class B ani łącznej wielkości wszystkich bucketów konta. Limit 8 MiB, AAL2 oraz limiter prób Auth nie stanowią gwarancji braku dopłat. Dlatego produkcyjne załączniki pozostają **OFF**, zgodnie z zakazem płatnych przekroczeń; nie zaznaczać gotowości wyłącznie dlatego, że bucket jest prywatny i ma mało plików.

Przed osobną zgodą na aktywację plików:

1. [Cloudflare R2](https://dash.cloudflare.com/) → konto Tedn828 → **R2 Object Storage → Overview** oraz **Billing → Usage**: sprawdzić faktyczne account-wide storage/GB-month, Class A i Class B, w tym staging i kopie. Zapisać timestamp oraz metryki, nie dane klientów.
2. Pozostawić Standard; nie dodawać lifecycle do Infrequent Access ani automatycznego usuwania dokumentów bez zatwierdzonej retencji.
3. Uzgodnić i zweryfikować przed aktywacją kontrolę wydatków zgodną z zakazem dopłat. Propozycja marginesu operacyjnego to zatrzymanie zapisów przed 80% dostępnej puli i blokada nowych R2 operacji przed jej wyczerpaniem, ale obecny kod **nie implementuje** takiego globalnego capu. Alerty/dashboard są monitoringiem, nie automatycznym hard stopem; nie przedstawiać ich jako gwarancji.
4. Generator finalnego profilu wymaga m.in. niezależnych sekretów, prywatnego R2, właściciela MFA, SMTP confirmation/recovery E2E, backup/rehearsal i jawnej zgody. Dodatkowy kosztowy warunek musi być wykazany osobno; `private_r2_verified=true` nie oznacza zgody na metered overages. Faza `owner-setup` nadal ma files OFF i bez bindingu R2.

Najbliższe działania dotyczące backupu/pliku są jednoznaczne: transfer pięciu pozycji został ręcznie potwierdzony; sprawdzić odczyt z Bitwarden na obecnym komputerze, a następnie osobno odzyskanie na drugim urządzeniu; do czasu zamknięcia kontroli rozliczeń R2 zachować produkcyjne **files OFF**. Nie wymaga to resetu kont, usunięcia plików lub zmiany stagingowego MFA.

---

# Świeża kopia przed publikacją — 2026-10-06 18:21UTC

**EXPORT / LOCAL MEMORY RESTORE VERIFIED. CURRENT PRODUCTION NOT MIGRATED.**

Bieżący prywatny katalog: C:/Users/nowic/Documents/Codex/private-backups/rexbid/production-environment-20261006T182151Z; DPAPICurrentUser + ACLowner/SYSTEM. ProdSQL61931B SHA2566aa64c185783a6d3b94e28ec7a9e10eb1a47287d65a1915b801dbde82760c7b9, stagingSQL2583526B SHA2565f71fa63f8458690d5f468c68d1948acf76505a3821f5ab93b2f8ca0f2044bf2. Zaszyfrowane kopie i checksum/DPAPIroundtripPASS; plaintext usunięty z dokładnych sprawdzonych ścieżek. Sekrety i dane pozaGit.

Na świeżym prodbackup0003→0006 localrehearsalPASS: legacyDDL/PK/indexes+budgetrows zachowane; rollback wymuszonego błędu, replay i jawny częściowyCREATE006recoveryPASS. StaginglocalrestorePASS users2/favorites2/orders2/messages4/files3/listings579/snapshots584/FK0. Są to testySQLitew pamięci, nie remote restore do produkcji. Nowa niezależna D1c8a30088-70af-43a6-9a7f-c4018279d37d dostała tylko pusty schemat0000/1/2/3/6 i readbackallbusiness0/FK0.

Nowe produkcyjne klucze: **new-production-keys-v1.json.dpapi**, activeIDproduction-20261006; actualportalAESroundtrip+cookiesseal/openPASS, zapisane wyłącznie w niepublicznym rexbid-production-preflight. Stagingkeyringnietknięty. Pierwszy nigdy nieużyty plik new-production-keys.json.dpapi został zastąpiony poprawnym formatem base64url i nie jest aktywną kopią — korzystać z manifest.new_keys.file wskazującego v1. Nie ujawniać wartości. DPAPIzależy od profiluWindows: osobny securevault/offdevicebackup nadal potrzebny.

Checkpoint 30903c1efbcd4ed6afed612217e382cffa25d7f0 zabezpieczono encryptedGitbundle24437566B+SHA256/DPAPIroundtrip/bundleverify i odtworzono do nowego bare repo poza workingtree: fsck oraz blobchecks PASS18:46UTC. Manifest local-checkpoint-manifest.json podaje konkretny SHA i checksum. Następujący commit dokumentacyjny otrzymuje osobną kopię. .codex-wrangler-cache zachowany. Źródłowe materiały i historyczne3encryptedR2objects pozostają w zabezpieczonej kopii11:26UTC; nie przedstawiać tego jako świeżego exportuR2.

Przed rzeczywistą produkcyjną migracją wykonać nowy export/counts/keybackup i uzgodnić okno zapisów. Rollback przy częściowej migracji nie oznacza samego cofnięcia kodu: STOP, porównanieledger/schema/constraints/counts, addytywna naprawa albo restore do nowego D1+walidacja+osobnozatwierdzonybinding. BrakDROP/down ani nadpisania obecnejbazy. SQLrestorebezR2/keyring nieodtwarza plików.

**Poniższe dowody mają własne daty i opisują historię oraz procedury, nie bieżącą kopię.**

---

# Bieżący dowód odtworzenia i migracji — przygotowanie publikacji 2026-10-06

**LOCAL RESTORE / ACCOUNTS+PORTAL REHEARSAL PASS. PRODUCTION NOT MIGRATED.** Ta sekcja jest bieżącym wynikiem; wcześniejsze audyty i wersje opisane dalej są historią. Rzeczywisty recovery e-mail E2E stagingu został potwierdzony przez właściciela: nowe hasło zapisano, stare odrzucono, nowe umożliwiło logowanie. Nie wymaga powtarzania w celu wykonania backupu.

## Zweryfikowany istniejący backup

Źródło: eksport `rexbid-db` / `971879fe-04ed-4e8c-9dc6-5306980bb872` utworzony **2026-10-06 11:26:28.88 UTC**, chroniony DPAPI CurrentUser i restricted NTFS ACL, poza Git. W tym etapie odszyfrowano go wyłącznie w pamięci, ponownie zweryfikowano SHA-256 i odtworzono do `node:sqlite` `:memory:`. Nie importowano nic do istniejącej zdalnej bazy.

- SHA-256 SQL: `6aa64c185783a6d3b94e28ec7a9e10eb1a47287d65a1915b801dbde82760c7b9`.
- Źródłowa historia: `0000_rexbid_base.sql`, `0001_auction_history_events.sql`, `0002_provider_read_budgets.sql`.
- Źródłowe county: legacy `vehicles/vehicle_snapshots/auction_history=0/0/0`; budgets10, reservations182; Accounts/portal/Sync2 nie występują.
- Źródłowy fingerprint schematu: `ea5133364982bd1635b9f868670b392981cd83de35dd0cc252db078f8f749006`; foreign-key violations0.
- Manifest kontrolny: `C:/Users/nowic/Documents/Codex/private-backups/rexbid/2026-10-06T11-26-28-268Z/local-accounts-portal-rehearsal-20261006.json`. Zawiera wyłącznie hashe i county, bez rekordów klientów lub sekretów.

To dowód odtwarzalności **tej konkretnej kopii**; nie zastępuje świeżego eksportu, odczytu aktualnej historii i uzgodnienia okna zapisów tuż przed zatwierdzoną produkcyjną migracją. DPAPI zależy od obecnego profilu Windows; niezależna szyfrowana kopia właścicielska z procedurą dostępu pozostaje obowiązkiem przed publikacją.

## Rehearsal `0003 → 0006` na kopii

Dodano operatorowy `scripts/rehearse-production-migrations.cjs`: przyjmuje SQL przez stdin, tworzy wyłącznie bazę w pamięci, nie korzysta z sieci ani bindings; wypisuje tylko agregaty/hashes. Zatrzymuje się przy baseline innym niż0000–0002 albo istniejących tabelach Accounts/portal/Sync2, więc nie traktuje stagingu jako produkcyjnego źródła.

| Sprawdzenie | Wynik |
|---|---|
| Import rzeczywistego eksportu, checksum i FK | PASS |
| Accounts0003, następnie portal0006 | PASS |
| Legacy DDL/PK/indeksy oraz istniejące budżetowe rekordy | Zachowane, PASS |
| Nowe users/favorites/orders/events/messages/files/customer_profiles | Wszystkie0, bez importu kont lub realizacji |
| Kontrolowany błąd statementu po SQL0006 przed COMMIT | ROLLBACK PASS, brak częściowych tabel006 |
| Ponowne zastosowanie dokładnego003/006 | PASS, bez driftu schematu |
| Disposable częściowe006: pierwszyCREATE TABLE→pełne006 | PASS dla tego jawnie kontrolowanego scenariusza |
| Sync2 albo media discovery | Nie utworzono/nie uruchomiono |
| Zdalne migracje/zapisy/restore | Nie wykonano |

SQL0003 SHA-256 `ab1595786818f1bb782aa7a21113d4527885bad14041cf591cc5802fb2ba2b90`; SQL0006 SHA-256 `593dd3d9b347ea7dd39df3eb12ad9711ef412886d96951e601b48020f644ce8e`. Fingerprint lokalnego schematu po003/006: `9b2b97ca8cf59fd7e040fe44904c43fff16eda09498c10ba2ba4518a4775fea2`; FK0. Lokalny rehearsal świadomie nie dopisuje wpisów do `d1_migrations`; docelowy zatwierdzony migration runner musi prowadzić tę historię.

**Ograniczenie:** SQLite rehearsal nie jest nową próbą remote D1 ani gwarancją automatycznej naprawy dowolnej częściowej migracji. `CREATE IF NOT EXISTS` nie naprawia istniejącej tabeli z błędnymi kolumnami/constraintami. Przy takim stanie należy zatrzymać aktywację i porównać dokładne `sqlite_schema`, `PRAGMA table_info`, PK/FK/indexy z zatwierdzonym SQL. Starszy remote staging restore opisany niżej pozostaje osobnym dowodem.

## Zatwierdzane zastosowanie i wycofanie

1. Przed zmianą potwierdzić konto, nazwę/UUID D1, aktywną wersję Workera, migration history i source counts. Wykonać **nowy eksport**, checksum/DPAPI roundtrip oraz powtórzyć memory rehearsal. Zachować manifest z czasem UTC i SHA kodu oraz SQL. Backup SQL/R2/keyring pozostają poza Git; nie przesyłać w czacie.
2. Dopiero po osobnej zgodzie zastosować003, direct readback; następnie006, direct readback. Provider-backed katalog, V4, Auth/portal/filesOFF i produkcyjny Sync/CronOFF podczas migracji. Accounts/portal nie wymagają0004. Jeśli później zatwierdzonoSync2, aktualny0004 już zawiera media columns; nie stosować ponownie stagingowego0005.
3. Przy błędzie migracji: STOP kolejnych migracji i aktywacji; odczyt history/schema/FK/countów, porównanie z manifestem. Jeżeli transakcja została wycofana, poprawić przyczynę i ponowić dopiero po review. Jeżeli istnieją częściowe obiekty, nie udawać braku błędu na podstawieIF NOT EXISTS; przygotować addytywną naprawę zgodną z zastanym DDL, z osobną zgodą. Nie wykonywaćDROP/down automatycznie.
4. Przy regresji kodu: przywrócić zatwierdzoną wcześniejszą wersję Workera i wyłączyć Auth/portal/files; schemat003/006 pozostaje addytywny. Zachować Supabaseidentity/MFA, klucze szyfrujące, R2 i rekordy. Rollback Workera nie odtwarza danych i nie cofa DNS.
5. Jeżeli doszło do utraty/korupcji danych: zachować kopię incydentu, zatrzymać portalowe zapisy, przygotować restore najpierw do **nowej, odseparowanej bazy**, zweryfikować schema/FK/count i relacje właściciela/klienta. Produkcyjny restore lub zmiana bindingu jest osobną zgodą; nie nadpisywać działającego `rexbid-db` lub stagingu w ramach rehearsal.
6. Przy portalowych plikach odzyskać spójny punkt D1+R2: ciphertext obiektów, object-key map, SHA256, visibility oraz **wszystkie używane key IDs/keyring/AAD**. Nie publikowaćbucketa. Supabase credentials/MFA/SMTP nie są zawarte w D1; nie kopiować stagingidentities. Powrót kodu bez odpowiednich kluczy nie odczyta danych.

Próby w tym etapie potwierdzają rollback transakcji i recovery na lokalnej kopii. Nowy remote production restore, test DR na innym koncie Windows, retencja i bezpieczny offsite vault wymagają odrębnego operacyjnego zatwierdzenia; nie oznaczono ich jako wykonane.

---

## Bieżąca gotowość produkcyjna — 2026-10-06 (bez aktywacji)

Cloudflare ma już strefę rexbid.pl **pending**,9/9 rekordów zgodnych z OVH, NS blair/titan. Właściciel zlecił wyłączenie DNSSEC; DS usunięty: oba serwery .pl zwróciły authoritative NOERROR/NODATA o2026-10-06 12:49:30UTC (14:49CEST). Stary DS miałTTL86400; konserwatywne okno cache do2026-10-07 14:49CEST. **Nameserverów teraz nie zmieniać.** MX/SPF OVH zachowane, FTP nieużywane, brak zmian DNS.

Staging Version **6da5587c-06f8-4e3f-9c04-73b00ae12561**; read-only D1 users2/favorites2/orders2/messages4/files3, listings579/snapshots584/media281, FK/duplikaty0. Właściciel potwierdził osobnego klienta: poprawni nadawcy, etap, internal hidden i klientowski download/open. Agent dodatkowo potwierdził trzy rzeczywiste odmowy404 (internal/foreign order/foreign file) w sanitizowanym tailu oraz czytelny mobilny panel bez overflow. MFA i dane bez zmian; brak nowych maili.

Produkcja mtbid Version **351ac4e7-2175-4d51-813b-5f85d9527f64**, rexbid-db971879fe-04ed-4e8c-9dc6-5306980bb872, wyłącznie0000–0002, Auth/portal/D1-first/Cron OFF. Właściwy profil **wrangler.rexbid-production.jsonc** zachowuje worker.js/katalog/V4; nie używać503 wrappera wrangler.release.jsonc. Generator **scripts/prepare-production-portal.cjs** przygotowuje odrębny profil kont/portalu dopiero po potwierdzeniu wszystkich zależności; nie kopiuje staging secrets/data. Proponowane003→006, prywatny R2produkcyjny, limiter30/60s i niezależny Supabase/keyring pozostają niewdrożone.

[Pełny raport i tabela potwierdzonych/brakujących danych kalkulatora](PRODUCTION_READINESS_2026-10-06.md), [DNS runbook](DNS_CUTOVER_REXBID_PL.md). Stawki610/24, preferred terminals, land multipliers i BEV150USD zachowane. Pierwszy mały pakiet od partnera: port/kraj odprawy, zakres frachtu i pakiet arrival/port/broker z jednostką/walutą/netto-brutto/datą. Pełny koszt pod dom nadal incomplete; nie zastępować braków zerem.

Nowe6 behavioral tests konfiguracji PASS; pełny suite647/647 PASS, partner14/14, parity125663, generatory/config/syntax/dry-run/diff PASS. Statyczny validator nie przedstawia już wdrożonej0002 jako aktualnego blockera. Przygotowano osobną fazę owner-setup (MFA przed włączeniem plików) oraz profil finalnego portalu; nie aktywowano ich. Lokalny checkpoint kodu/materiałów i szyfrowane kopie poza Git; cache zachowany. **Produkcja/DNS/NS/MFA bez zmian, bez pusha; Apibara0.** Starsze sekcje poniżej są historią, nie aktualnymi warunkami startu. Najbliższy krok: odczyt SMTP Settings aktualnego projektu staging, bez sekretów i bez kolejnego maila, podczas oczekiwania na wygaśnięcie cache starego DS.

---

# Backup i odtwarzanie Rex.Bid

## Aktualny stan — 2026-10-06: przygotowanie rexbid.pl (bez wdrożenia)

Potwierdzone ręcznie przez właściciela na osobnym koncie klienta: poprawni nadawcy, widoczna zmiana etapu, plik wewnętrzny ukryty i pobranie pliku klientowskiego. Staging Version 6da5587c-06f8-4e3f-9c04-73b00ae12561; users2/favorites2/orders2/messages4/files3 (client2/internal1). Verified MFA bez zmian.

Zdalny audit produkcji: mtbid Version351ac4e7-2175-4d51-813b-5f85d9527f64, rexbid-db971879fe-04ed-4e8c-9dc6-5306980bb872, migracje0000–0002, legacy0. Auth/portal/Sync2 nie skonfigurowane. Domena rexbid.pl: DNS i MX OVH; strefa Cloudflare pending istnieje; custom domain Workera niewdrożone, DMARC NXDOMAIN. Supabase production/SMTP dashboard NOT VERIFIED.

Nowy wrangler.rexbid-production.jsonc: wspólny worker.js, provider-backed, V4 exact-domain; konta/portal/D1-first/Cron OFF. Nie wdrażać wyłączonego wrangler.release.jsonc (503). Eksporty prod/staging zaszyfrowane DPAPI poza Git, local restore/count/FK PASS; kopia3 zaszyfrowanych obiektów staging R2. Brak importu staging do produkcji.

Szczegółowy audit, konfiguracja portalu, migracje0003→0006 (0004 opcjonalnie i już z mediami), backup/rollback, blokery recovery/SMTP/kalkulatora: docs/REXBID_PRODUCTION_PREPARATION_2026-10-06.md. Plan bez sekretów: config/rexbid-production-portal-plan.json. Nowe regresje i pełny suite641/641 PASS. Bez deployu/migracji/DNS/pusha/Apibara. Starsze rozdziały poniżej są historią, nie bieżącym stanem.


## Production D1 pre-cutover audit — 2026-10-03

- Odczytany target: `rexbid-db`, `971879fe-04ed-4e8c-9dc6-5306980bb872` (konto Tedn828).
- Zastosowane migracje: tylko `0000_rexbid_base.sql` i `0001_auction_history_events.sql`.
- County: `vehicles=0`, `vehicle_snapshots=0`, `auction_history=0`; brak `users`, `user_favorites`, Sync 2 i media columns. `foreign_key_check` czysty.
- Audyt był read-only. **Nie wykonano production exportu**: dump może zawierać dane użytkowników i wymaga zatwierdzonego szyfrowanego magazynu. Backup pozostaje warunkiem przed migracją.

### Gotowy export przed 0003 (uruchomić tylko w zatwierdzonym oknie)

```powershell
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$backup = "<approved-encrypted-dir>\rexbid-db-$stamp-pre-0003.sql"
npx wrangler d1 export rexbid-db --remote --config wrangler.jsonc --output $backup
Get-FileHash -Algorithm SHA256 $backup
```

Zachować checksum, target name/UUID, Wrangler version, migration list i pre-backup counts w manifeście poza repo. Nie commitować dumpu. Restore rehearsal wykonywać wyłącznie do nowej, odrębnie nazwanej D1; porównać schema/indexes/FK i kluczowe county. Usuwanie testowej D1 wymaga sprawdzenia UUID i osobnej zgody; nigdy nie restore'ować próbki na `rexbid-db` ani `rexbid-auth-test-db`.

Status: procedura projektowa. **Staging remote restore rehearsal wykonano 2026-10-03**: export `rexbid-auth-test-db` odtworzono do odrębnej tymczasowej Cloudflare D1 `rexbid-restore-rehearsal-20261003-0809` (`6ed87387-7501-4a1c-8fa8-cdcc02c05779`), porównano schemat/liczniki/FK i następnie usunięto tymczasową D1 oraz plik eksportu. Źródłowy staging i produkcja nie zostały nadpisane.

## Rozdzielenie środowisk

| Środowisko | Worker | D1 | ID D1 | Zasada |
|---|---|---|---|---|
| Produkcja | `mtbid` | `rexbid-db` | `971879fe-04ed-4e8c-9dc6-5306980bb872` | Nie używać w testach restore |
| Staging | `rexbid-auth-test` | `rexbid-auth-test-db` | `acb3cb8e-69a2-459f-8a46-0f2f5b9004be` | Pierwsze miejsce prób odtworzeniowych |

Przed każdą komendą z `--remote` porównaj nazwę i UUID z tabelą oraz `wrangler.jsonc` / `wrangler.staging.jsonc`. Eksport zapisuj poza repozytorium w katalogu z ograniczonym dostępem; nie dołączaj go do Git ani logów CI.

## Kopia i walidacja

1. Zapisz datę UTC, środowisko, D1 name/UUID, ostatnią udaną migrację oraz punkt Time Travel/bookmark dostępny w panelu.
2. Wykonaj kontrolowany eksport D1 przed zmianą schematu, np. `npx wrangler d1 export rexbid-db --remote --output <bezpieczna-sciezka-poza-repo>`. Dla stagingu jawnie użyj konfiguracji stagingowej i sprawdź target przed zatwierdzeniem polecenia.
3. Ogranicz dostęp do eksportu; może zawierać dane użytkowników. Zaszyfruj go w magazynie zatwierdzonym przez właściciela i określ retencję przed uruchomieniem automatycznych kopii.
4. Importuj najpierw do lokalnej/disposable bazy, sprawdź integralność SQL i kluczowe county. Następnie wykonaj próbę odtworzenia wyłącznie w stagingu.
5. Zapisz checksum, czas eksportu, wersję narzędzia oraz wyniki porównania tabel/indeksów. Nie kopiuj stagingowych użytkowników do produkcji.

Cloudflare D1 oferuje Time Travel; okno zależy od planu i w dokumentacji wynosi 7 dni dla Free oraz 30 dni dla Paid. Odtworzenie Time Travel działa na bazie i jest operacją destrukcyjną/odwracającą późniejsze zmiany. Przed restore zachowaj aktualny eksport i bookmark, a restore produkcyjny wymaga osobnego zatwierdzenia właściciela. Time Travel nie zastępuje niezależnego eksportu.

## Migracje i rollback

- Migracje produkcyjne wykonuj wyłącznie z aktywnego katalogu migracji i po porównaniu `wrangler d1 migrations list --remote` z repo.
- Proposal `0003_accounts_foundation.sql` i `0004_d1_sync_2.sql` nie są zgodą na zastosowanie do produkcji. `0003` i `0004` pozostają niezaaplikowane na `rexbid-db`.
- Zastosowanie migracji ma być addytywne. Zrób kopię przed migracją, zastosuj w stagingu, sprawdź foreign keys, indeksy, legacy rows i zachowanie aplikacji.
- Nie usuwaj tabel ani kolumn w tej samej migracji co cutover. Preferuj wyłączenie flagi/route i rollback wersji Workera. Przy niezgodnym schemacie zatrzymaj rollout; przywrócenie bazy jest osobną, zatwierdzaną operacją.
- D1 migration runner może wykonać automatyczny backup przed udaną migracją; nadal wykonuj i rejestruj własny backup.

## Próba odtworzenia

Przed publicznym uruchomieniem: wykonaj co najmniej jedną próbę importu eksportu do disposable SQLite oraz staging D1, porównaj schemat, liczbę rekordów i kontrolne relacje. Nie wykonuj destructive restore stagingu, dopóki nie potwierdzisz zachowania stagingowego konta i jego ulubionych.

**Źródła Cloudflare (sprawdzone 2026-09-29):** [D1 export/import](https://developers.cloudflare.com/d1/best-practices/import-export-data/), [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [Wrangler D1 commands and migration backup](https://developers.cloudflare.com/d1/wrangler-commands/).

### Wcześniejszy lokalny rehearsal — 2026-10-03 (historyczny, superseded dla remote D1)

- Źródło: wyłącznie `rexbid-auth-test-db` / `acb3cb8e-69a2-459f-8a46-0f2f5b9004be`; eksport tymczasowy poza repo, usunięty po kontroli.
- Cel: efemeryczna `node:sqlite` in-memory database; nie utworzono nowego zdalnego D1 i nie zmieniono danych źródłowych.
- Kontrola: 18 tabel, `users=1`, `user_favorites=1`, `vehicle_sources=380`, `auction_listings=380`, snapshots=380, events/entities=0, legacy vehicles/snapshots/history=0.
- Wynik: **PASS dla eksportu → importu do disposable SQLite i kontroli countów**. Późniejszy remote rehearsal opisany poniżej odrębnie zweryfikował import do Cloudflare D1.

### Korekta — remote Cloudflare D1 restore rehearsal — 2026-10-03

Powyższy zapis dotyczył wcześniejszej próby lokalnej i został uzupełniony późniejszym, pełnym testem zdalnym:

- Źródło pozostało wyłącznie `rexbid-auth-test-db` (`acb3cb8e-69a2-459f-8a46-0f2f5b9004be`). Wykonano remote export, import do osobnej tymczasowej D1 `rexbid-restore-rehearsal-20261003-0809` (`6ed87387-7501-4a1c-8fa8-cdcc02c05779`) i bezpośrednie porównanie.
- Porównano 41 obiektów CREATE TABLE/INDEX; znormalizowane DDL miało zgodny SHA-256 `84A6DF4978E3D2BBBBBF1429B59BDA2F0921AF213C158E63D58391AA66863291`. `foreign_key_check` pusty po obu stronach.
- Kluczowe county źródło/cel były równe: users 1, favorites 1, sources/listings/snapshots 380/380/380, events/entities 0/0, scopes 2, runs 10, page commits 19, budgets 7, reservations 23, legacy tables 0, listings z media URL 80.
- Po walidacji usunięto tylko tymczasową bazę wskazaną nazwą i UUID oraz tymczasowe eksporty. Ponownie potwierdzono, że źródłowy staging D1 i produkcyjny `rexbid-db` zachowały właściwe identyfikatory i nie zostały nadpisane.
- **Wynik: remote staging restore rehearsal PASS.** Nie dowodzi to jeszcze odtworzenia produkcyjnej bazy ani ustalenia produkcyjnej retencji/szyfrowanego magazynu. Wymagany jest osobny prod-target dry-run/review i właścicielska zgoda.
# Final review update — 2026-10-03 (historyczny zapis, superseded przez remote rehearsal poniżej)

- Completed staging D1 export followed by import into disposable in-memory SQLite; 18 tables and key account/catalog counts matched. Temporary export was removed. Source staging D1 was read-only.
- **Korekta statusu:** ten wpis powstał przed późniejszym remote rehearsal i nie opisuje końcowego stanu.
- Remote staging rehearsal został później wykonany; patrz sekcja „Korekta — remote Cloudflare D1 restore rehearsal”. Dla produkcji nadal wymagane są zatwierdzone zasady szyfrowania/retencji backupu i osobny plan operacyjny. Nigdy nie odtwarzaj nad `rexbid-auth-test-db` ani `rexbid-db` w trakcie rehearsal.
# Production environment build update — 2026-10-03

- Zdalna produkcyjna D1 `rexbid-db` nie została odczytana w tym sprincie. Próba Wrangler zakończyła się błędem wygasłego OAuth tokenu przed jakimkolwiek SELECT. Nie wykonano exportu, restore ani migracji.
- Wcześniejszy remote restore rehearsal dotyczył wyłącznie staging export → osobna tymczasowa D1; nie jest dowodem odtwarzalności production.
- Po ponownym uwierzytelnieniu: potwierdzić konto i UUID; wykonać wyłącznie `wrangler d1 migrations list ... --remote`, read-only schema/counts i następnie zaplanować production export poza repo oraz disposable restore do nowej, jednoznacznie nazwanej D1. Nie importować nad `rexbid-db`.
- Przed pierwszą produkcyjną zmianą ustalić zatwierdzony, szyfrowany backup storage, dostęp, retencję i checksumy. Aktualna propozycja runbooka (retencja 30 dni) jest nieaktywna i wymaga zatwierdzenia.
- **Migration prerequisite:** proposal 0004 zawiera już dwie media columns; sprawdzić `PRAGMA table_info(auction_listings)` przed wyborem migracji. Nie aplikować ponownie stagingowego 0005 po 0004 zawierającym te kolumny.


## Lokalny checkpoint V4/V5.3 i prywatne kopie — 2026-10-06

Właściciel zezwolił na lokalny checkpoint, bez pusha. Kod, wersjonowane configi/proposals i źródłowe dane partnera są zapisane lokalnym commitem; SHA i Git bundle w zewnętrznym manifeście. Nie wykonywać reset --hard obecnego checkoutu podczas odtwarzania; clone/bundle do nowego katalogu i dopiero porównanie.

Prywatny katalog: C:/Users/nowic/Documents/Codex/private-backups/rexbid/readiness-checkpoint-2026-10-06. owner-source-packages-and-private-qa.zip.dpapi zawiera50 zachowanych plików (źródłowe ZIP-y i nieśledzone QA V5). Oryginały pozostają w repo na dysku; są ignorowane przez Git. materials-manifest.json zawiera hashes/roundtrip/counts; osobny kodowy bundle/manifest dodawany po commicie. .codex-wrangler-cache pozostaje na miejscu i poza Git, nie jest czyszczony.

D1/R2 snapshot: C:/Users/nowic/Documents/Codex/private-backups/rexbid/2026-10-06T11-26-28-268Z. Oba dumpy ponownie odszyfrowano w pamięci do disposable SQLite: checksum/count zgodne, FK0. Trzy kopie R2: checksum/nagłówek RXBID1 zgodne; treści zdjęć/PDF nie odszyfrowywano. DPAPI roundtrip kopii materiałów PASS. Nie ma restore do żadnej zdalnej bazy.

### Procedura następnej kopii przed migracją

1. Potwierdzić Worker/D1name/UUID i spisać aktywny Version, route/config oraz liczniki. Produkcyjny target971879fe-04ed-4e8c-9dc6-5306980bb872.
2. Utworzyć katalog UTC w zatwierdzonym magazynie poza Git z restricted NTFS ACL (bieżący użytkownik/SYSTEM); plaintext tylko tymczasowo w tym katalogu.
3. Eksport bez mutacji: wrangler d1 export rexbid-db --remote --config wrangler.jsonc --output <private-dir>/rexbid-db-<UTC>-pre-0003-0006.sql.
4. SHA256 plaintext, zaszyfrować zaakceptowanym narzędziem/key management, SHA256 ciphertext, odszyfrować w pamięci i sprawdzić oba hashe. Usunąć wyłącznie utworzony własny plaintext po sprawdzeniu ścieżki; nie stosować masowego cleanupu.
5. Lokalny disposable restore: DDL/index/FK i county porównać z read-only źródłem. Kopia z poprawnym hash, ale bez restore nie jest pełnym rehearsal.
6. Dla R2 backup ciphertext+object_key mapping+key IDs/AAD; zachować wszystkie używane klucze w oddzielnym bezpiecznym vault. D1/R2 nie obejmuje Supabase identity/MFA/SMTPsecrets. Nie włączać publicznego bucketa do backupu.
7. Remote restore tylko po zgodzie, do nowej osobnej testowej D1/bucketa, nigdy na rexbid-db lub staging źródłowy. Zweryfikować mapowanie client visibility i encryption przed użyciem. Staging danych nigdy nie importować do production.

### Odtworzenie lokalne i granice DPAPI

Git bundle: git bundle verify <private-dir>/rexbid-code-<SHA>.bundle, następnie git clone <bundle> <new-directory>; checkout dokładnego SHA w nowym katalogu. Weryfikacja code manifest/file hashes, npm ci, generatory --check, testy, config guards. Nigdy nie pushować klona ani nie wdrażać automatycznie profilu.

DPAPI archive otwiera wyłącznie konto Windows, które utworzyło kopię. Po odszyfrowaniu do nowego chronionego katalogu porównać każdy source hash; przed ZIP extraction sprawdzić ścieżki i nie wychodzić poza ten katalog. Nie udostępniać decrypted archive/SQL/keys/QA w czacie. Utrata tego profilu Windows może uniemożliwić odzyskanie; potrzebna niezależna, zaszyfrowana kopia offsite wraz z kontrolowanym dostępem do keyringu. To nadal wymaganie operacyjne, nie potwierdzony offsiteDR.

### Kontrola odtworzenia kodu i bajtów źródłowych

Rzeczywisty clone do odrębnego chronionego katalogu wykrył, że historyczne bloby dwóch źródłowych MD miały LF, a robocze źródła używane przez generator CRLF. Same dodanie .gitattributes nie poprawia już istniejących blobów. Zapisano ponownie dokładne robocze bajty land_transport_rates.md i sea_transport_rates.md przez git add --renormalize z attr/-text. **Nie zmieniono wartości, stawek, source hashes ani wersji rate setu.** Hash land616468778c9f617b70a85e04ec7b4583c46fca162baaf442e38b9cfed91d63fa, sea fe07c2ef8428c072a24edab9b289bdba95ba6a0e23d2ac1614fb0ae3cc73e09e.

Przy odtworzeniu użyć git -c core.autocrlf=false clone --no-checkout <bundle> <new-dir>, następnie w nowym katalogu git config core.autocrlf false i git checkout --detach <SHA>. Pozostałe pliki tekstowe mogą mieć normalizowane końce linii: tożsamość kodu sprawdza commit/tree; źródła partnera zachowują dokładne bajty przez -text. Uruchomić oba generatory --check i validator profilu. Manifest zewnętrzny zawiera dowód isolated restore, nie zastępuje go samo git bundle verify. Wcześniejsza próbna kopia z błędną historyczną normalizacją jest zachowana jako diagnostyczna; odtwarzać najnowszy checkpoint z końcowego raportu.

Rollback nie wymaga DROP/down migracji003/006. Wyłączenie Auth/portal/files i poprawny redeploy blokują funkcje; dane/klucze/MFA pozostają. Worker rollback nie cofa DNS, danych ani Supabase. Po zmianie DNSSEC nigdy nie odwracać NS bez kontroli DS odpowiadającego kluczowi docelowej strefy.

## Lokalny checkpoint po konfiguracji Supabase — 2026-10-07

Zachowano historyczny checkpoint i jego kopie. Nowy lokalny commit obejmuje konfigurację odseparowanego preflightu, metadane produkcyjnego Supabase, regresje izolacji/kosztów R2 oraz aktualne QA i runbook. Nie obejmuje sekretów, eksportów prywatnych danych ani plików R2; bez pusha.

Osobny katalog chroniony: `C:/Users/nowic/Documents/Codex/private-backups/rexbid/production-auth-20261007`. Produkcyjne URL/publishable key mają kopię `production-supabase.json.dpapi`; aktywny cookie/portal keyring pozostaje w poprzednim katalogu, plik `new-production-keys-v1.json.dpapi`. Nie rotowano kluczy stagingu.

Procedura nowej kopii kodu: bundle wszystkich refs → bundle verify → DPAPI CurrentUser → SHA-256/roundtrip → clone mirror do nowej, osobnej ścieżki → fsck i porównanie kluczowych blobów → usunięcie tylko sprawdzonego jawnego bundle. Receipt `local-checkpoint-auth-manifest.json` zapisuje rzeczywisty SHA, wynik odtworzenia i checksum pliku `rexbid-production-auth.git.bundle.dpapi`. Poprzednich kopii nie nadpisywać.

Kontrola bezpieczeństwa przed commitem: rzeczywiste nowe klucze porównano w pamięci z 285 plikami kodu i logów operatora; **0 trafień**, bez wyświetlania wartości. Jest to kontrola tego zestawu plików, nie twierdzenie o skanowaniu wszystkich plików komputera. Pełny suite **668/668 PASS**, partner 14/14, generatory/config/syntax PASS. Nowa kopia kodu nie zastępuje niezależnego sejfu kluczy ani świeżego eksportu danych przed przyszłą migracją.


## Backup kampanii całego katalogu — 8.10.2026

Przed zapisami wykonano pełny zaszyfrowany eksport stagingu i restore w pamięci: checksum/integrity/FK PASS. Lokalizacja `C:/Users/nowic/Documents/Codex/private-backups/rexbid/catalog-complete-before-20261008`. DPAPI CurrentUser: nie jest to zweryfikowana kopia między komputerami. Wszystkie1682 wcześniejsze snapshoty porównano po kampanii, PASS. Bez odtwarzania do aktywnej bazy. [Raport i procedura rollbacku](CATALOG_HISTORY_REFRESH_QA_2026-10-08.md).
