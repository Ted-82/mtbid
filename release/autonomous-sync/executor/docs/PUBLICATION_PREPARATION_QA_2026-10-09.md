# Przygotowanie publikacji i budżet D1 — 9.10.2026

Status: **kod i pełny pakiet lokalny przygotowane; zdalny transfer zatrzymany na rezerwie D1, nie publikować jeszcze**. Punkt wyjścia: `4219816bfcfb8f8224ffed99739e743958774cdd`. Staging zachowany: `6c7d016d-a822-4a4f-9868-b46d111f20be`.

## Wykonane prace

- `d1-write-budget.cjs`: wspólne rozliczenie konta operatora, aktualne metryki wszystkich D1, trwała rezerwacja przed transportem, faktyczne `meta.rows_written/rows_read`, blokada równoległego operatora. Rezerwa: **20 000 zapisów i 500 000 odczytów** z limitu Free 100 000 / 5 mln na dobę UTC. Jedna partia maks. 5000 szacowanych zapisów; obecny transfer ma maks. 100 instrukcji na partię.
- `d1-operator-bridge.cjs` odrzuca każdy zapis bez jawnego budżetu. Starsze importery nie mogą kontynuować zapisów bez podłączenia tego zabezpieczenia. Błąd/timeout/brak metadanych pozostawia nierozliczoną rezerwację i wymaga readbacku. Nie ma automatycznego odblokowania ani usuwania locka.
- Licznik wykorzystuje większą wartość: najnowsze metryki konta albo pierwszy dzienny odczyt + własne operacje. **To zabezpieczenie naszych importów, nie gwarancja globalnego limitu naliczania Cloudflare.** Inne procesy mogą zużywać konto, a metryki są opóźnione. Nie podniesiono planu, limitów ani nie usunięto indeksów.
- Przygotowano przyrostowy transfer: nie powiela identycznych obserwacji/wydarzeń. Potwierdzenie kompletnej historii trafia do celu dopiero po wydarzeniach danego auta. Nie kopiuje lease, cursorów operacyjnych, kont, danych klientów, sekretów ani budżetów Apibara. Publiczne informacje o błędzie odświeżenia zachowują rzeczywiste daty; szczegóły błędów zastępują stałe, bezpieczne kody.
- Lokalna próba pełnego transferu ujawniła stary `final_price_usd` dla IAAI LOT 45674212. Dotychczasowy COALESCE zachowywał dawną cenę transakcji przy nowym null. Poprawiono transfer i dodano regresję. Aktualna oferta, cena historyczna i potwierdzona sprzedaż nie są zamiennikami.

## Stan danych i zatrzymanie

Cel: wyłącznie `rexbid-production-preflight-db / c8a30088-70af-43a6-9a7f-c4018279d37d`, bez publicznej trasy.

| Dane | Przed | Po kontrolowanym transferze | Pełny lokalny plan |
| --- | ---: | ---: | ---: |
| Oferty | 1638 | **1817** | 1817 |
| Copart / IAAI | 840 / 798 | **945 / 872** | 945 / 872 |
| Obserwacje | 1682 | **3253** | 3253 |
| Wydarzenia aukcyjne | 0 | **13 127** | 19 044 |
| Potwierdzenia/stany pobrania historii | 0 | **618** | 1638 |

Zakończono **206/276 partii**. STOP: `D1_WRITE_BUDGET_STOP`, bez rozpoczętej niepewnej partii. Pozostaje **70 partii / 5917 wydarzeń / 1020 stanów pobrania**. Obecne wydarzenia i 618 stanów dotyczą Copart; IAAI w bazie publikacyjnej nie ma jeszcze przeniesionych wydarzeń. **To nie oznacza pustej historii IAAI u źródła.** Staging nadal ma pełne 19 044 wydarzenia obu platform.

Własne metadane transferu: **76 529 rows written / 1 465 936 rows read**, plus bazowy odczyt całego konta **2763 / 1 583 600**. Ostrożne wykorzystanie zapisów na STOP: **79 292**, do 100 000 pozostawiono **20 708**. To nie potwierdzenie końcowej wartości całego konta: odczyt Analytics o 14:04:06 UTC nadal nie pokazywał nowych zapisów preflightu. Właśnie dlatego nie oparto STOP wyłącznie na dashboardzie.

Nie zużywać rezerwy w celu dokończenia importu. Najbliższy reset: **10.10.2026, 00:00 UTC / 02:00 czasu polskiego**. Przed wznowieniem wymagany nowy odczyt metryk; reset daty nie jest dowodem wolnej puli.

## Rzeczywisty audyt

- Readback: wszystkie 1817 ofert, ceny/null, URL-e mediów i daty obserwacji zgodne ze stagingowym snapshotem; 3253 obserwacje zachowane (lokalne ID snapshotu nie są przenoszone).
- Wszystkie 13 127 przeniesionych wydarzeń zgodne kolumna po kolumnie. Każdy przeniesiony stan historii ma wszystkie wydarzenia z zaplanowanego zbioru dla danego auta; brak przedwczesnego oznaczenia kompletności.
- Duplikaty platforma/LOT **0**, naruszenia FK **0**. Chronione/operacyjne tabele preflightu poza celowo uzupełnianym `provider_sync_scopes` zgodne z początkiem; konta/realizacje/wiadomości/pliki **0**.
- Staging: publiczne tabele, stany pobrania i chronione sumy kontrolne bez zmian; users/favorites/orders/messages/files **2/2/2/4/3**. MFA i R2 nietknięte.
- **0 requestów Apibara**; licznik operatora pozostaje **1774**, ostatnie wcześniejsze rozliczenie dostawcy **5833/30 000**, bez nowego odczytu usage. Historyczny STOP56 zachowany. Nie odświeżono dat ofert.

## Testy i koszty odczytu

- **901/901 repo PASS, 14/14 partner PASS**. Celowane regresje budżetu, przerwania/wznowienia, zmiany tożsamości, braków metadanych i ceny transakcji.
- Generatory V3/V4/partner `--check`, walidatory konfiguracji produkcji/stagingu/preflightu oraz profil publikacyjny PASS. Walidator komercyjny nadal uczciwie zgłasza brakujące dane partnera.
- Składnia: **165 JS/CJS/MJS + 3 inline** z czterech głównych publicznych stron PASS. Moduły ES sprawdzono jako moduły; pierwszy ogólny checker CJS nie nadawał się do plików eksportujących ES.
- Pełny końcowy suite uruchomiono poza sandboxem po lokalnym EPERM przy atomowym rename testowego checkpointu. Te same testy, bez zmiany asercji, cache lub ACL.
- Wrangler4.149.0 **publication dry-run PASS**; tylko lokalny bundle, bez uploadu/deployu i tras.
- Handler publikacyjny z **rzeczywistą prywatną D1**, uruchomiony lokalnie: 7/7 odpowiedzi200 (Polestar, Timed, filtry, obie karty i historie). 27 zapytań D1, 19 983 odczytane wiersze, 0 zapisów. Powtórzenie każdej odpowiedzi z cache: **0 nowych zapytań D1**. To cache w pamięci testu, nie pomiar Cloudflare edge ani E2E domeny rexbid.pl.
- Koszt pojedynczego nietrafienia cache: 1436–3107 wierszy w tej próbce. Cache ma maks.30s, a nowe kombinacje filtrów mogą kosztować kolejne odczyty. Niskie obecne użycie nie gwarantuje obsługi dowolnego ruchu na Free. Po uruchomieniu obserwować account-wide reads; optymalizacja powtarzanych zapytań coverage pozostaje osobnym punktem przed zwiększaniem ruchu.
- Krótki realny staging HTTP: health/ready/Polestar/IAAI Timed **4/4 PASS**, dane D1, bez fallbacku. Nie powtarzano desktop/mobile, MFA, recovery ani panelu: żaden plik runtime strony nie został zmieniony w tym etapie. Poprzednie dowody UI pozostają z raportu Timed/Polestar.

## Pakiet, backup i wznowienie

Materiały poza Git: `C:/Users/nowic/Documents/Codex/REXBID_PUBLICATION_READY_20261009`:

- `candidate/`: 52 pliki / 2 507 146 B przed manifestem, aktualne publiczne assets i skompilowany Worker, profil docelowy oraz SHA-256 plików. Status `NOT_PUBLISHED_DATA_TRANSFER_PAUSED`.
- `transfer-plan.json`, `rehearsal.json`, `transfer-progress.json`, `audit.json`, `read-qa.json`, snapshoty kontrolne i log końcowego suite.
- Pełna próba odtworzenia poprzedniego zaszyfrowanego backupu w pamięci: integrity/FK PASS, po lokalnym transferze komplet 1817 / 3253 / 19044 i 1638 stanów, ceny i wydarzenia zgodne.
- Budżet konta: `C:/Users/nowic/Documents/Codex/REXBID_D1_ACCOUNT_BUDGET/ledger.ndjson`. **Nie usuwać, nie zerować, nie zmieniać katalogu dla nowej próby.**
- Backupy preflightu DPAPI + prywatny ACL: `private-backups/rexbid/publication-ready-before-20261009` i `publication-ready-paused-20261009`, oba roundtrip PASS. SHA SQL odpowiednio `44cc429858c59eeb397b6c4a59c8185ff59799ee69d2122af5251062ef435143` oraz `283253a9c65e2a80ef7186a58f36ade0459526e5da0bb316e1ab62dc94317eec`. Jawne eksporty usunięto po szyfrowaniu. DPAPI sprawdzono na tym komputerze, nie na drugim urządzeniu.

Operator po resecie: zachować plan i postęp, potwierdzić target/świeży backup/metryki oraz brak zmian w bazie od audytu; uruchomić istniejący `C:/Users/nowic/Documents/Codex/rexbid-publication-apply.cjs`. Korzysta ze wspólnej sesji Wrangler4.149.0/Windows XDG i jednego budżetu konta. Następnie `rexbid-publication-ready.cjs audit` oraz `rexbid-publication-audit.cjs`. Nie uruchamiać ponownie przygotowania planu ani pierwotnych kampanii. Nowe wydarzenia są już zapisane lokalnie; Apibara nie jest potrzebna. Niepewny zapis wymaga readbacku i udokumentowanego rozliczenia, nie wymazania checkpointu.

## Publikacja i dalsze warunki

Pierwszy zakres bez zmian: katalog/karty/galerie/historia/V4/lokalne ulubione/kontakt. Worker `rexbid-production-preflight`, jego osobna D1; Auth/portal/załączniki/Cron/Sync/fallback OFF. **Nie jest jeszcze gotowy do przełączenia:** pozostały transfer historii i końcowy readback, następnie akceptacja odłożonych dokumentów/retencji i ocena kanału korespondencji oraz osobna zgoda na publikację/delegację.

Runbook zachowuje apex rexbid.pl, www→apex308 z path/query, blair/titan, usunięcie parkingowych A i nieużywanego FTP, nienaruszone9 rekordów poczty/TXT. DS kontrolujemy ponownie bezpośrednio przed przyszłą delegacją; nie teraz. Dowody12/12 i pięć odpowiedzi DS0 pozostają historyczne. DNSSEC OVH nadal wyłączone, później nowy Cloudflare DS.

Rollback przygotowania: pozostawić preflight prywatny, zatrzymać transfer; staging i mtbid działają niezależnie. Nie wgrywać starego dumpu w miejsce aktualnej bazy. Gdyby potrzebne było odtworzenie, użyć osobnej D1 i dopiero po audycie/zgodzie zmienić binding. Rollback przyszłej domeny/TLS/DS pozostaje w [runbooku](PRODUCTION_CUTOVER_RUNBOOK.md).

Źródła zasad limitów: [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [metryki i analityka](https://developers.cloudflare.com/d1/observability/metrics-analytics/). Brak pusha, płatnych usług, zmian DNS, mtbid, produkcyjnych migracji, sekretów lub MFA.
