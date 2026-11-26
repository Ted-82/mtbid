# Automatyczne odświeżanie REXBID

## Wznowienie 26.10.2026

Właściciel potwierdził opłacenie Apibara i zlecił uruchomienie bieżących ofert dla testerów. Po rzeczywistym `/usage` (Basic, 30 000 dostępnych), zaszyfrowanych kopiach obu D1 i kontroli danych usunięto `OPERATOR_STOP` bez zerowania liczników. Historyczne instrukcje STOP z 25–26.10 dotyczą okresu przed tym wznowieniem. Dawna kampania ręczna i STOP56 pozostają zachowane i nie zostały wznowione.

Poprawka brakujących marek/roczników i limitu 40: [CATALOG_DISCOVERY_FIX_2026-10-26.md](CATALOG_DISCOVERY_FIX_2026-10-26.md).

Raport wznowienia, wersje, readback i rzeczywiste wykonania Cron: [LIVE_CATALOG_AND_ORDERING_2026-10-26.md](LIVE_CATALOG_AND_ORDERING_2026-10-26.md). Staging nie wykonuje automatycznych odczytów. Publiczne wejście na stronę nie pobiera danych providera.

Pula dzienna jest rozkładana również między pozostałe kwadranse UTC: liczba prób partii to minimum z limitu partii i całkowitej części `pozostałe próby / pozostałe kwadranse`. Atomowa rezerwacja nadal blokuje przekroczenie dziennej, miesięcznej i źródłowej puli; minimalna wartość planistyczna 1 nie daje prawa do wywołania po ich wyczerpaniu.

W kolejce oferty otwarte bez przypisanego terminu mają pierwszeństwo przed ofertami z minionym terminem w tej samej klasie. Późniejsza poprawna obserwacja może zastąpić termin starszego zadania `complete`; błędy tożsamości, 404, retry/backoff i `older_source_ignored` nie są przez tę regułę pomijane.

Operatorowy limit analityki GraphQL Cloudflare może uniemożliwić odczyt budżetu D1. Nie utożsamiać tego z limitem Apibara albo błędem zapisu danych. Po takim zatrzymaniu sprawdzić dziennik rezerwacji i brak niepewnych zapisów, zachować wymagany odstęp i wykonać readback przed kontrolowanym wznowieniem. Produkcyjny Cron korzysta z trwałych budżetów D1 oraz quota Apibara i nie wywołuje tej operatorowej analityki.

Stan wdrożenia i wyniki rzeczywistych kontroli: [raport 14.10.2026](DEVELOPMENT_STAGE_2026-10-14.md). Ten dokument opisuje obsługę; sam nie jest dowodem zakończonego wywołania Cron.

## Zakres i limity

- Jedyny harmonogram: `rexbid-production-preflight`, `*/15 * * * *` (UTC), D1 `c8a30088-70af-43a6-9a7f-c4018279d37d`.
- Staging `rexbid-auth-test` nie ma Cron. Starszy `mtbid` nie uczestniczy w odświeżaniu.
- Użytkownik czyta D1/cache. HTTP, wyszukiwanie, galerie i odświeżenie karty nie uruchamiają adaptera Apibara. Licytacja przez REXBID nie została uruchomiona.
- Maksymalnie 8 prób na uruchomienie, 500/dzień UTC, 12 000/miesiąc kalendarzowy; dzienna pula jest dodatkowo rozkładana na pozostałe dni miesiąca. Każde ponowienie i odczyt `/usage` zużywa próbę.
- Maksymalnie 2000 nowych ofert dziennie (od poprawki braków katalogu 26.10). Po osiągnięciu tego progu listy discovery są pomijane; pozostała pula służy istniejącym ofertom.
- `/usage` co 24 godziny, rezerwa 500 u dostawcy. Okres raportowania dostawcy nie jest automatycznie uznawany za datę odnowienia abonamentu. Wspólne konto może mieć inne źródła zużycia.
- Najwyżej jedno ponowienie przejściowego błędu 5xx/timeout; 429 wstrzymuje na dobę. Błędy autoryzacji, konfiguracji, zapisu lub odpowiedzi quota blokują dalszy transport. Nie zerować liczników w celu wznowienia.
- HOT 30 minut, WARM 6 godzin i COLD 7 dni to terminy kwalifikowania do kolejki. Przy ograniczonej puli nie gwarantują odczytu każdego auta z taką częstotliwością. Preferowane są trwające/przyszłe aukcje oraz wcześniej potwierdzone szczegóły.

## Dane i kontrola

Każdy zapis sprawdza VIN, platformę i LOT. Inny LOT dla tego samego VIN nie zastępuje zamówionej aukcji. `vin_lots` nie jest traktowane jako pełny szczegół pojazdu. 404 nie oznacza sprzedaży. Błędne odpowiedzi zachowują stare dane i ich datę; zadanie dostaje przyczynę oraz termin kolejnego sprawdzenia. Cena null nie przejmuje starej wartości pod nową datą. Zero pozostaje zerem.

Zapis katalogu i postępu jest atomowy oraz chroniony dzierżawą; następuje readback oferty i fingerprintu obserwacji. Wydarzenia historyczne pozostają zachowane. Ten harmonogram nie importuje nowych wydarzeń historii aukcji i nie tworzy potwierdzenia pustej historii ze snapshotu. Pierwsze zasilenie obejmuje kolejne strony całego źródłowego zbioru Open, bez filtra ostatnich 24 godzin. Osobne zadania `inventory:copart` / `inventory:iaai` zachowują kursor także przez następne dni. Po dojściu do końca każdej platformy osobny kursor `list:*` śledzi zmiany z ostatnich 24 godzin. Katalog pozostaje częściowy; zakończenie przejścia ruchomej listy nie dowodzi kompletności rynku. Ostatnia strona przed limitem nowych ofert ma zmniejszone `per_page`, aby nie pomijać zwróconych pozycji.

Stan znajduje się w pięciu tabelach `automatic_refresh_*`. Przechowują stan, budżety, próby, zadania i zabezpieczenie dzierżawy. Brak sekretów i danych klientów. Obecnie nie działa automatyczne kasowanie tego dziennika; przyszłe porządkowanie musi zachować rozliczenie budżetów i checkpoint.

Odczyt operatora, wyłącznie w bazie publikacyjnej:

```sql
SELECT last_started_at,last_finished_at,last_success_at,blocked_reason,pause_until,last_report_json
FROM automatic_refresh_state WHERE singleton=1;
SELECT budget_key,limit_count,consumed FROM automatic_refresh_budgets;
SELECT operation,outcome,COUNT(*) FROM automatic_refresh_attempts GROUP BY operation,outcome;
SELECT last_error_code,COUNT(*) FROM automatic_refresh_tasks WHERE status='error' GROUP BY last_error_code;
```

Nie przedstawiać `ok:true` partii jako pełnego odświeżenia rynku lub wszystkich zapisanych aut. Sprawdzać `updated`, `inserted`, `detailFailures`, `rejected`, daty i stan poszczególnych zadań. Kompletność historii jest osobna.

Publiczne `GET https://rexbid.pl/ready` pokazuje `checks.provider=scheduled_only` i bezpieczny stan `refresh` oraz datę ostatniego ukończenia/sukcesu. `scheduled` oznacza sprawny ostatni przebieg, nie świeżość wszystkich aut. `due` oznacza brak ukończenia przez ponad 30 minut. `paused`, `blocked` lub `unavailable` wymagają kontroli operatora; nie wyłączają czytania poprawnie zapisanego katalogu. Endpoint nie wykonuje requestów Apibara i nie udostępnia sekretów, budżetów ani surowych błędów.

## Zatrzymanie i rollback

1. **Natychmiastowy STOP**, tylko w D1 `c8a30088-70af-43a6-9a7f-c4018279d37d`:

   ```sql
   UPDATE automatic_refresh_state
   SET blocked_reason='OPERATOR_STOP',lease_owner=NULL,lease_until=NULL
   WHERE singleton=1;
   ```

   Unieważnia dzierżawę także dla trwającej partii. Już rozpoczęta próba pozostaje policzona; następny chroniony zapis zostaje odrzucony. Strona dalej czyta zapisany katalog.

2. Usunąć harmonogram z konfiguracji wdrożenia i wyłączyć automat. Nie wystarcza samo cofnięcie wersji kodu, ponieważ Cron jest osobną konfiguracją. Z istniejącego generatora użyć domyślnego `buildPublicationConfig(base)` (bez wariantu `buildAutomaticPublicationConfig`), sprawdzić generator i wdrożyć profil publikacyjny bez `triggers` i zmiennych `REXBID_AUTO_REFRESH_*`. Po wdrożeniu API Cloudflare musi potwierdzić pustą listę schedules.
3. Punkt rollbacku kodu sprzed etapu: Worker produkcyjny `1cd69740-fda8-495a-a895-587f135cf077`; staging `85a44ee5-5b9d-4a6d-ac35-1b7456535a12`. W razie potrzeby cofnąć właściwego Workera, zachowując DNS, sekrety i dane. Starszy kod czyta schemat addytywny; nie usuwać pięciu nowych tabel.
4. Jeżeli problem dotyczy danych: po STOP najpierw zachować kopię stanu po błędzie. Odtworzyć kopię sprzed etapu do lokalnej SQLite, sprawdzić integralność/FK i zakres różnicy. Przywracać tylko uszkodzony zakres katalogu z planem/readback, albo odtworzyć do osobnej D1 i dopiero po porównaniu przełączyć binding. Nie nadpisywać całej bazy przez import SQL nad istniejącymi tabelami. Nie usuwać kont, realizacji, wiadomości ani plików.
5. Migracja `0008_automatic_refresh.sql` jest addytywna i idempotentna. Jeżeli jej wykonanie było częściowe, po backupie i sprawdzeniu istniejącego schematu dokończyć ją, zamiast usuwać tabele. Wykonanie dwukrotne na odtworzonej kopii nie zmieniło żadnego wcześniejszego wiersza.
6. Wznowienie dopiero po ustaleniu przyczyny, kontroli quota, integralności i testach. Nie zmieniać `consumed`, nie kasować prób ani starych kampanii STOP56. Usunięcie `blocked_reason` nie jest naprawą przyczyny.

Przygotowanie profilu bez harmonogramu po STOP (PowerShell, katalog repozytorium; nie uruchamiać rutynowo):

```powershell
node -e 'const fs=require("node:fs"),g=require("./scripts/prepare-production-publication.cjs");const base=JSON.parse(fs.readFileSync("wrangler.production-preflight.jsonc","utf8"));fs.writeFileSync("wrangler.rollback-catalog.jsonc",JSON.stringify(g.buildPublicationConfig(base),null,2),{flag:"wx"});'
$env:XDG_CONFIG_HOME='C:/Users/nowic/AppData/Roaming/xdg.config'
node 'C:/Users/nowic/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/bin/wrangler.js' deploy --dry-run --config wrangler.rollback-catalog.jsonc
```

Po przejrzeniu nazwy Workera, D1, dwóch domen i braku `triggers.crons`: powtórzyć ostatnie polecenie bez `--dry-run`, potem odczytać API `/accounts/7ff5a57444667c4eda2a6a7f0fc4120d/workers/scripts/rexbid-production-preflight/schedules` i potwierdzić brak harmonogramu. Jeśli Cloudflare zachowa schedules mimo pustego profilu, jawnie ustawić pustą listę schedules przez API przed zamknięciem rollbacku. STOP w D1 nadal blokuje transport. Nie stosować tego profilu do stagingu ani mtbid.

## Kopia i koszty

Kopia sprzed etapu: `C:/Users/nowic/Documents/Codex/private-backups/rexbid/automatic-refresh-before-20261014`. Manifest ma hashe plaintext/ciphertext, wynik roundtrip i identyfikator bazy. Kopia DPAPI jest związana z obecnym kontem Windows; test odtworzenia wykonano na tym komputerze, w pamięci SQLite. Nie jest to test odzyskania na drugim urządzeniu. Sekrety i prywatne kopie pozostają poza Git.

Automat używa istniejącego Apibara Basic i Workers Paid. Nie aktywowano nowej usługi ani dopłat. Limity aplikacji chronią liczbę wywołań Apibara; nie stanowią limitu całej faktury Cloudflare. Aktualne rozliczenia konta należy kontrolować osobno. Supabase Free pozostaje zgodnie z decyzją właściciela; katalog nie zależy od dostępności Auth.
