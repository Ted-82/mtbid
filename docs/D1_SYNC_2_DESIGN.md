# Rex.Bid D1 Sync 2 — projekt architektury

## Staging product milestone — offline preparation (2026-10-01)

- Zmiany lokalne po checkpoint `32533d4`: D1 catalog search oraz advanced filter predicates trafiają do read repository; odpowiedzi nadal opisują wyłącznie known rows, gdy scope jest partial.
- Przygotowana nowa kampania `campaign-product-milestone-32533d4`: trwały globalny limit 20 requestów wraz z limitami 10 per platformę. Każde uruchomienie jest ograniczone do 4 stron po 20 rekordów, retry=0. Globalny request jest rezerwowany atomowo w osobnym wierszu `provider_request_budgets`, więc równoległe Copart/IAAI runy nie mogą wspólnie przekroczyć cap.
- Media: `migrations-staging/0005_listing_media_urls.sql` addytywnie dodaje URL-only columns. Canonical repository waliduje HTTPS, usuwa duplikaty i ogranicza liczbę/długość URL-i; raw provider JSON i binary image data nie są zapisywane. Istniejące wiersze pozostają z NULL do czasu aktualizacji canonical listing.
- W tej pracy wykonano 0 requestów Apibara. Automated suite 290/290, składnia, config validator, generator `--check` i diff-check PASS. Podwyższony staging dry-run PASS i wykazał bindingi wyłącznie `rexbid-auth-test-db` + ASSETS. `wrangler whoami` wskazał wygasły token; brak staging migration/deploy/readback/backfill. Ostatni znany stan pozostaje historyczny 220 Copart + 80 IAAI, oba partial, niepotwierdzony świeżym odczytem.
- Przed aktywacją: zastosować staging migration 0005 do `rexbid-auth-test-db`, wdrożyć wyłącznie staging, potwierdzić schema/counters, a dopiero potem użyć authenticated panelu. Produkcyjna konfiguracja, D1 i public API nie są zmieniane.

## Najnowszy stan multi-platform staging — 2026-10-01

- Worker stagingowy `rexbid-auth-test` Version `5c887ebe-9477-47d1-92b6-5e36f638d40d` używa wyłącznie D1 `rexbid-auth-test-db` (`acb3cb8e-69a2-459f-8a46-0f2f5b9004be`). Odczyt nie zmienił danych (`rows_written=0`, `changed_db=false`).
- Readback: Copart sources/listings/snapshots **220/220/220**; IAAI **80/80/80**; duplikaty obu identity **0**; events/entities **0/0**; konta 1/1; legacy vehicles/snapshots/history 0/0/0.
- Scope są rozdzielone: Copart `rexbid-phase-d:persistent-discovery:copart` i IAAI `rexbid-phase-g:persistent-discovery:iaai`. Oba `partial`, oba mają cursor; 11 i 4 page commits. Cursor jest przechowywany per scope i nie został odczytany w jawnej postaci.
- IAAI: `last_success_at=2026-10-01T08:55:47.280Z`, `last_complete_at=NULL`. To oczekiwane po poprawce: sukces atomowo zapisanej strony aktualizuje `last_success_at`, a `last_complete_at` wyłącznie po faktycznym końcu paginacji.
- Budżet kampanii bieżącej 4/12, IAAI 4/6, zero rezerwacji/ponowień; Copart nie zużył budżetu platformowego tej kampanii. Brak nowych requestów Apibara w readbacku. Phase G public API cutover nadal wyłączony.

## Multi-platform continuation and Phase G preparation — 2026-10-01

### Status

- **CODE PREPARED:** one shared staging runner supports Copart and IAAI; platform behavior is selected by an allowlisted parameter, not duplicated implementations.
- **AUTOMATED VERIFIED:** offline SQLite behavioral tests cover independent scopes/cursors/leases/budgets, shared VIN without entity reconciliation, per-platform failure isolation, first-page snapshots without auction events, idempotent replay, rollback before page/checkpoint commit, and hard campaign limits.
- **STAGING RUNNER VERIFIED / IAAI PERSISTENT RUN NOT YET VERIFIED.** Staging deployment Version `dcfc17fa-fc43-4234-b450-335e8d0b7c03`; exact binding `rexbid-auth-test-db` ID `acb3cb8e-69a2-459f-8a46-0f2f5b9004be`. Direct D1 readback confirms Copart sources/listings/snapshots 220/220/220, events/entities 0/0, 11 commits, partial scope with cursor; IAAI 0/0/0 and no scope. No duplicate listing/source rows; Accounts 1/1; legacy 0/0/0.
- Existing budgets read from D1: Phase D 1/5, Phase F 2/5, prior Phase G preparation campaign 8/10. New campaign `campaign-multiplatform-4c4e938` has not reserved/consumed a request: **0/12**. Live Apibara requests in this continuation: **0**. Database queries were read-only (`changed_db=false`, `rows_written=0`).
- Browser confirmed the staging Auth test page loads, but session status is Anonymous; authenticated IAAI/Copart controls are unavailable until the owner signs in. No provider call occurred.

### Shared runner invariants

- Copart keeps `rexbid-phase-d:persistent-discovery:copart`; IAAI uses `rexbid-phase-g:persistent-discovery:iaai`. Cursors, status, leases, timestamps and checkpoint commits remain scope-local. No cross-platform VIN merge or implicit physical entity creation.
- Campaign `campaign-multiplatform-4c4e938` is durable and separate from the previous Phase F campaign. The ceiling is 12 new calls total (6 per platform), at most two pages per click, page size 20, zero retry reserve. Failed provider attempts consume their reserved call; no hidden retries. Stop when a scope reaches actual terminal pagination.
- New listings create only an initial observed snapshot; discovery does not create a confirmed auction event. Identical replay creates no new listing/snapshot/event. Canonical page records plus cursor/checkpoint use repository batch semantics.
- The authenticated exact-host staging panel reports per-platform status/freshness, counts/facets, cursor presence only, durable budget, and sampled D1 read timings. Public endpoints do not consume Sync rows; no API contract changes, schedule/queue, raw payload or binary image storage.
- Phase G public API cutover remains disabled. Partial/stale/incomplete scopes may not be described as complete. See `docs/D1_PHASE_G_CUTOVER.md` for cutover gates and rollback conditions.

## Kontynuacja backfillu / przygotowanie Phase G — staging wdrożony, 2026-09-30

Staging Worker `rexbid-auth-test` Version `862a11a4-9761-4491-90c9-d64cf367e69d` zawiera manual route `/__staging/d1-sync-phase-g-backfill`, chronioną staging host/config, POST, same-origin, istniejącą zweryfikowaną sesję oraz staging D1 binding. Dry-run i deploy z `wrangler.staging.jsonc` pokazały wyłącznie `rexbid-auth-test` → `rexbid-auth-test-db` (`acb3cb8e-69a2-459f-8a46-0f2f5b9004be`). Produkcyjny Worker/config nie były użyte.

### Kampania i stan przed jej uruchomieniem

- Nowa trwała kampania `apibara-phase-g-preparation` / `campaign-controlled-backfill-2026-09-30` ma limit 10 requestów w całym sprincie, 0 retry; nie podnosi ani nie zeruje budżetu Phase F (2/5). Każda ręczna akcja przetwarza najwyżej 2 strony po 20 listingów i wznowi zapisany cursor Copart. Runner nie ma trybu IAAI, dlatego platformy i cursorów nie miesza. Nie włączono Cron/Queue.
- **Live Apibara requests in this pass: 0.** Nowa kampania nie została jeszcze uruchomiona, więc jej trwały budget row powstanie/da się odczytać po pierwszej autoryzowanej akcji.
- Bezpośredni staging D1 readback: sources/listings/snapshots = 60/60/60, `vehicle_entities=0`, events=0, scope `partial`, cursor obecny, `last_complete_at=NULL`; `users=1`, favorites=1, legacy vehicles/snapshots/history=0/0/0. Duplikaty listing/source = 0; poprzednie budżety: Phase D 1/5 i Phase F 2/5. Wszystkie zapytania readback miały `changed_db=false`, `rows_written=0`.
- Zakres katalogu: wyłącznie Copart, 60 listingów, 31 znanych marek, lata 1963–2025, 42 z Buy Now, 0 timed i 0 dat aukcji późniejszych niż bieżąca data kalendarzowa. Scope nadal jest partial.
- Jednorazowe D1 SQL durations uzyskane przez Wrangler: catalog 0.606 ms, exact detail 0.279 ms, snapshot history 0.184 ms, filter metadata 0.156 ms. Są to czasy SQL z metadanych D1, nie pełna latencja HTTP/Worker.
- Staging `/auth-test.html` zwrócił 200 i zawiera nowy runner/limit. Publiczne `/api/cars`, frontend, produkcja oraz D1 Sync read cutover pozostają bez zmian.

**Przyszła Phase G:** cutover nadal nieaktywny. Domyślny read mode ma pozostać dotychczasowy provider; D1 catalog/filter read można przełączyć dopiero przy kompletnym, świeżym scope każdej udostępnianej platformy i potwierdzonej semantyce paginacji. Partial D1 musi pozostać jawnie partial albo obsłużony pełnym provider fallbackiem; nigdy nie może wyglądać na pełny katalog. Rollback to natychmiastowy powrót do dotychczasowego provider path przez wyłączenie stagingowego przełącznika.

**Instrukcja kontrolowanego backfillu:** na stagingu zalogować istniejące konto i klikać `Wznów maksymalnie 2 strony` najwyżej 5 razy, łącznie nie więcej niż 10 requestów. Po każdym kliknięciu sprawdzić `liveRequests`/`campaignBudget` i D1 readback. Zatrzymać wcześniej, gdy scope stanie się complete; brak automatycznych retry. IAAI pozostaje poza kampanią.

> **Najnowszy status — Phase E (2026-09-29):** kod provider-neutral read repository, read policy/service oraz staging-only D1 read diagnostics jest zaimplementowany, automated-verified i staging-D1-read-verified. Final Worker `rexbid-auth-test` Version `6e19e605-a9a1-4e69-babe-0e4a515316ee` zwrócił read-only GET-y katalog (20), filtry (15 znanych marek), detail i initial snapshot z rzeczywistego staging D1. Catalog/filter metadata pozostały jawnie niekompletne. Finalny history GET potwierdził kompatybilny envelope, `snapshots_only`, private/no-store i noindex. Końcowy SELECT potwierdził brak zapisów i brak duplikatów. Publiczne API, production Worker/D1, frontend i schema nie zostały przełączone ani zmienione. Live Apibara requests = 0.

### Phase E — staging D1 read model (nie jest publicznym cutoverem)

`sync/d1-read-repository.js` udostępnia odczyt katalogu z filtrami, keyset pagination, lookup listing/source/exact VIN/LOT, snapshots oraz znanego zakresu metadata. Model zwraca canonical RexVehicle wraz z `freshness`, `last_synced_at`, `last_seen_at`, freshness class i coverage. `sync/read-policy.js` rozdziela `d1`, `provider` i `hybrid`: fresh D1 detail nie wywołuje providera; stale/missing detail dopuszcza provider wyłącznie przez jawnie przekazany callback; jeśli provider zawiedzie, zachowany jest ostatni D1 rekord. Katalog/filtry wymagają kompletnego coverage przed etykietą complete; partial scope pozostaje jawnie partial.

`sync/read-service.js` demonstruje bounded detail fallback bez automatycznego requestu. Staging-only routes pod `/__staging/d1-read/{catalog,detail,history,filters}` są włączane wyłącznie przez staging config, dokładny staging host i właściwy D1 target. Zwracają kompatybilny kształt publicznego DTO oraz `read_source`/coverage/freshness; odpowiedzi są `private, no-store`. Nie są podłączone do normalnego `/api/cars` ani frontendów.

History odczytuje wyłącznie zapisane `auction_listing_snapshots`; snapshots są stanami zaobserwowanymi, nie potwierdzonymi wynikami aukcji. `auction_events` nie są fabrykowane. Filtry pochodzą z zapisanych wierszy i mają `metadata_complete=false` przy partial coverage. Obecny Copart scope z cursor nie jest kompletny, a IAAI nie ma ukończonego zakresu — 20 rekordów nie może być przedstawiane jako pełny katalog.

Cache: staging diagnostic read path omija cache aplikacyjny i wysyła `private, no-store`. D1 jest źródłem trwałym; ewentualny public cache dopiero po kompletnym pokryciu i z invalidacją opartą o odświeżenia/version. Private/account routes pozostają poza tym cache.

**Warunki przed przyszłym production cutover:** kompletne discovery scopes dla każdej włączonej platformy i filtrów; testy cursor/paginacji i canonical parity; uzgodniona freshness/SLA oraz provider request budget; brak empty/partial nadpisania; monitoring stale/coverage; staging soak; oddzielna akceptacja migracji produkcyjnej i przełączenia API. Do tego czasu produkcyjne `/api/cars`, detail i history zachowują dotychczasową ścieżkę providera.

**Status: Phase A DONE; Phase B D1 VERIFIED; Phase C SHADOW VERIFIED; Phase D CODE VERIFIED / AUTOMATED VERIFIED / STAGING PERSISTENT DISCOVERY VERIFIED.** Phase B zweryfikowano na disposable SQLite oraz na prawdziwym Cloudflare D1 bindingu `rexbid-auth-test-db`, wyłącznie na danych syntetycznych. Phase C wykonała jeden ograniczony discovery request i usunęła swoje temporary shadow rows. Phase D wykonała jedną stronę persistent Copart discovery na stagingu: 1 live request (limit 5), 20 provider records / 20 accepted, 20 sources, 20 listings, 20 initial snapshots; dane pozostają w D1 zgodnie z celem, bez cleanupu. Odczyt D1 był bezpośredni i wyłącznie read-only. Produkcyjne `rexbid-db`, konfiguracja produkcji i publiczne API pozostały nietknięte. Proposal 0004 nadal leży poza aktywnymi migracjami Wrangler; nie stosować go do produkcji.

Stan wejściowy: repozytorium `main`, checkpoint Phase A `015ee6f`. D1 Sync nie ma schedulera ani wdrożonego modelu produkcyjnego. Zwykłe GET pozostają read-only, a obecny klient Apibara nadal obsługuje większość katalogu.

## Decyzje w skrócie

1. Zachować `vehicles`, `vehicle_snapshots`, `auction_history` oraz ich PK bez zmian. Nie przenosić ani nie scalać legacy rekordów automatycznie.
2. Rozdzielić **fizyczną tożsamość pojazdu**, **wpis aukcyjny/listing**, **źródło providera** i **zdarzenie historii**.
3. Odczyt katalogu docelowo wykonywać z D1. Sync ma być osobnym, ograniczonym procesem; zwykłe przeglądanie nie wywołuje providera.
4. Pierwszy sync pobiera strony listy i zapisuje tylko dozwolone, walidowane canonical summaries. Nie pobiera szczegółów ani historii dla każdego wyniku.
5. Factual vehicle/auction/history/snapshot/derived data storage and commercial display are permitted by the owner-reported written Apibara response recorded in `docs/APIBARA_DATA_RIGHTS.md`. Permanent archiving/redistribution of original Copart/IAA photos is NOT APPROVED; URLs, supported display, temporary technical cache and thumbnails are allowed from Apibara's side.
6. Każdy zapis strony i checkpoint jej cursora muszą być atomowe/idempotentne. Niepełny przebieg nie przesuwa `last_complete_at` ani `last_success_at` zakresu.
7. Przy N=1k/10k/50k, przykładowy budżet dobowy wynosi odpowiednio ok. **98 / 956 / 4 778** upstream requestów przy założeniach jawnie podanych niżej. To model limitu, nie prognoza ani włączony harmonogram.

## 1. Stan istniejący

### Obecny przepływ i request budget

```text
przeglądarka → Rex.Bid Worker/API → adapter providera → Apibara
                               └→ D1 SELECT (lokalny fallback/summary)
explicit POST sync → provider → normalizacja/persistencja → D1
```

Produkcyjny Worker jest upstream-first. Zgodnie z bieżącym kodem zwykłe GET nie zapisują D1; jawny `POST /api/sync/vehicle/:identifier` jest chroniony tokenem i jest osobną ścieżką. `syncVehicleList()` istnieje jako funkcja wewnętrzna, ale nie jest włączonym schedulerem. `ensureDatabase()` tworzy tabele/indeksy i jest osiągane przez zapis, nie GET.

| Akcja użytkownika w obecnym upstream-first wariancie | Typowy / maksymalny upstream koszt wynikający z kodu |
|---|---:|
| Wejście Home i pełne przewinięcie czterech lazy sekcji | do 4 list calls (`/api/cars?per_page=4`); każda sekcja ma osobne filtry |
| Inicjalizacja metadanych filtrów | 1 `/api/filters` na unikalny zestaw parametrów; edge TTL 6 h |
| Pierwsza strona katalogu / kliknięcie „Załaduj więcej” | 1 list call na stronę; następna strona tylko po kliknięciu; list TTL 60 s |
| Otworzenie auta | zwykle 1 detail; dokładny search fallback tylko po 404/niezgodnym direct result; detail TTL 30 s |
| Otwarcie historii / każde jawne „Załaduj starsze” | 1 history page; cursor-specific TTL 5 min |
| Konto, login, favorites | 0 Apibara calls |

Cache jest krótkim edge cache, nie trwałym katalogiem; klucz listy uwzględnia query/cursor. Cztery sekcje Home nie są obecnie jednym upstream requestem. Po D1 Sync typowa akcja strony ma **0** upstream calls; wyjątkiem może być jawny refresh lub ograniczony cache miss exact lookup w okresie migracji.

### Legacy D1 — tabele, klucze i indeksy

Źródłem schematu jest `migrations/0000_rexbid_base.sql`, `0001_auction_history_events.sql` oraz zgodna ścieżka `ensureDatabase()` w `worker.js`.

| Tabela | Obecny klucz / dane | Istniejące indeksy / znaczenie |
|---|---|---|
| `vehicles` | `vehicle_key TEXT PRIMARY KEY`; VIN, slug VIN, platforma, LOT, tytuł/specyfikacja, status/daty/ceny, seller/title/damage, lokalizacja, media flags, `first_seen_at`, `last_seen_at`, `fingerprint`, `raw_json` | `idx_vehicles_vin(vin)`, `idx_vehicles_lot(lot)`, `idx_vehicles_platform(platform)` |
| `vehicle_snapshots` | autoincrement `id`; `vehicle_key`, `captured_at`, wybrane pola aukcji/cen, wymagany `fingerprint`, `raw_json` | `idx_snapshots_vehicle(vehicle_key)`; snapshot obserwacji zmienionego stanu, nie wydarzenie aukcyjne |
| `auction_history` | autoincrement `id`; `vehicle_key`, `event_hash`, `captured_at`, legacy `price/status/raw_json`; po `0001`: `event_key`, `source_event_id`, VIN/platform/LOT/daty, current/final/Buy Now, seller | `idx_history_vehicle(vehicle_key)`, `idx_history_date(auction_date)`, nieunikalny `idx_history_event_lookup(vehicle_key,event_key)` |

Legacy `vehicle_key` w adapterze Apibara powstaje obecnie zasadniczo jako `platform:VIN`, w przeciwnym razie `platform:LOT` (z wcześniejszym slug VIN w normalizacji). Nie jest to stabilna wielo-providerowa tożsamość listingu: jeden VIN może mieć równoczesne/relistowane LOT-y; LOT może zostać użyty ponownie; VIN może być błędny, sklonowany lub nieobecny. `auction_history.id` jest lokalnym row ID, `event_hash` jest hashem zmiennego zdarzenia, a fallback `event_key` to platform + LOT lub VIN + data; nie wolno bez audytu zakładać globalnej unikalności.

### Fingerprint, merge i raw data

- `saveVehicle()` pobiera poprzedni rekord, scala częściowy incoming payload z poprzednim i nie powinien wymazywać poprawnych wartości nowym `null`/pustym polem. Zapisuje fingerprint; `vehicle_snapshots` powstaje dla nowego rekordu lub zmienionego fingerprintu.
- Fingerprint obecnego adaptera jest skrótem wybranych pól zmiennych/wyświetlanych (status, daty, ceny, lokalizacja, uszkodzenia, przebieg, seller/title). To detektor zmiany bieżącego widoku, nie tożsamość auta/listingu/eventu.
- `vehicles.raw_json` i `auction_history.raw_json` przechowują payload źródłowy. To istniejąca retencja, której prawo i okres nie zostały pisemnie potwierdzone; nie rozszerzać jej przez nowy sync.
- `saveAuctionHistory()` preferuje jawne event ID/key; różne jawne ID są osobnymi wydarzeniami. Fallback jest ostrożny, a niejednoznaczne legacy dopasowanie pozostaje nieruszone. Cena/status nie definiują event identity.

### Provider independence

`providers/contract.js` definiuje canonical `RexVehicle`, `RexAuction`, `RexPricing`, `RexSeller`, `RexCondition`, `RexDocument`, `RexMedia`, `RexHistoryEvent`, `RexFilterMetadata`; `providers/apibara.js` wykonuje requesty i mapuje źródło. Fake Provider B istnieje w testach. Adapter nie dostaje D1. Frontend/publiczne API nadal używa kompatybilnego DTO, nie czystego canonical JSON.

Obecny `docs/proposals/0002_provider_sync_foundation.sql` jest **proposal-only** i nie jest w aktywnym `migrations/`. To użyteczny szkic lease/run, ale nie należy stosować go wprost: `vehicle_sources.vehicle_key` wiąże źródło z legacy kluczem `platform:VIN/LOT`, nie oddziela listing identity od physical vehicle identity; zmienia istniejące tabele przez `ALTER`; nie zapewnia scope dla discovery cursoru. Niniejsza propozycja `0004` zastępuje ją koncepcyjnie i ma tworzyć wyłącznie nowe, puste tabele. Nie stosować obu propozycji razem.

## 2. SAFE NOW / REQUIRES SEPARATE RIGHTS OR APPROVAL

### SAFE NOW — prawa Apibara do factual data potwierdzone po jej stronie

- Według pisemnej odpowiedzi Apibara może Rex.Bid przechowywać vehicle/auction facts, dane historyczne VIN/LOT/status/cena/seller/spec/damage/title, ich zmiany/snapshots oraz derived data; można je wyświetlać publicznie i używać komercyjnie, także w płatnych funkcjach/analytics/alerts. Dane legalnie pobrane w aktywnej subskrypcji mogą pozostać po jej zakończeniu.
- Testy offline normalizatorów, partial-payload merge, identity collision, cursor replay, budget limiter, 429/timeout i Fake Provider B.
- Sync orchestration/repository na canonical input oraz bounded factual-data discovery można planować w osobnej zatwierdzonej fazie; techniczna zgoda dostawcy nie zatwierdza wielkości importu, harmonogramu ani wydatku.
- Operacyjne metryki sync: run ID, provider/operation, liczba requestów/stron, HTTP class, latency, wynik, retry delay i techniczny checkpoint; bez e-maili, sekretów, request/response body i raw error body.

### REQUIRES SEPARATE RIGHTS / OWNER APPROVAL

- Trwałe archiwum/redystrybucja oryginalnych zdjęć Copart/IAA: odpowiedź nie daje sublicencji copyright. Store URL, wspierane remote display, temporary cache i thumbnails są dozwolone po stronie Apibara; watermark nie zmienia praw.
- Długoterminowy raw provider payload nie jest w odpowiedzi wyraźnie wymieniony; nie zakładać, że zgoda na normalized/derived factual fields obejmuje nieograniczone raw JSON.
- Niezależne Copart/IAA platform terms, privacy/retention obligations, request quota/price, automatyczne discovery limits oraz uprawnienia każdego przyszłego Provider B wymagają osobnej weryfikacji.
- Pełny backfill, szeroki harmonogram, production cutover, publiczny API rate/egress budget, D1 capacity, backup/restore i rollback wymagają osobnej operacyjnej zgody.

Podsumowanie pisemnej odpowiedzi i provenance: `docs/APIBARA_DATA_RIGHTS.md`. Publiczne warunki Apibara nadal opisują limity/zakaz obchodzenia limitów i obowiązki klienta: [Regulamin Apibara](https://apibara.tech/en/terms).

## 3. Docelowe warstwy i canonical data

```text
Apibara / Provider B adapter
        ↓ fixed provider operations
Rex.Bid sync orchestrator (budget, leases, checkpoint, validation)
        ↓ canonical summaries/events allowed by policy
D1 source/listing projection + sync control
        ↓ stable Rex.Bid DTO / existing compatibility DTO
Rex.Bid API → Home / catalog / detail / history
```

Frontend i D1 query layer nie czytają pól Apibara. Adapter jest jedyną warstwą source mapping. Provider B powinien przejść te same contract fixtures i canonical repository contract; nie wdrażać go jako produkcyjnego dostawcy bez osobnego prawa/limitu review.

### Rozdzielone identity

1. **Vehicle entity** — wewnętrzny, niezmienny `entity_id` dla fizycznego samochodu, jeżeli połączenie jest wiarygodne. VIN to silny kandydat do linkowania, ale nie pewny klucz ani gwarancja: klon, literówka, brak VIN i różne LOT-y są możliwe. Collision wymaga rozdzielenia/oznaczenia, nie nadpisania.
2. **Provider source** — `source_key` dla `(provider, platform, provider_vehicle_id)` tylko gdy provider ID ma potwierdzoną semantykę i stabilność. Zachować ID jako provenance, wersję normalizatora, czas obserwacji i stan. Brak stabilnego ID oznacza słabszą tożsamość, nie sztuczne zrównanie z VIN.
3. **Auction listing** — osobny `listing_id` dla cyklu aukcyjnego. Priorytet: stabilny provider listing ID; dalej udokumentowany source listing ID. Fallback `provider + platform + LOT + listing_generation` dopiero po dowodzie cyklu/relist; LOT nie jest globalne ani wieczne. VIN jest pomocniczym resolverem, nigdy samodzielnym listing PK. Przesunięta data aukcji nie tworzy nowego listing.
4. **Auction event** — `event_id` Rex.Bid oraz opcjonalny `provider_event_id`, w scope provider/platform/listing. Jawne, stabilne source event ID ma pierwszeństwo; fallback listing + event date + jawny typ/status tylko gdy wystarczają do rozróżnienia. Jeśli event jest niejednoznaczny, pozostaje unresolved; nie scalać według ceny/statusu.
5. **Snapshot** — obserwacja zmiany canonical listingu/entity; nigdy nie jest historią aukcji.

### Pola, źródło, świeżość, brak wartości

| Pole/grupa | Canonical i provenance | Freshness | Brak / partial semantics |
|---|---|---|---|
| provider/platform/provider IDs | nazwa z registry, platform enum, source identifier + `identity_kind`; przypisanie z adaptera | aktualizuje się po poprawnym discovery/detail | brak ID nie powoduje użycia VIN jako pewnego listing key; zachowaj unresolved |
| VIN/LOT | znormalizowana wartość + oryginalny provider/source path poza publicznym DTO | last observed; osobne detail freshness | null/empty nie usuwa poprzedniej wartości; sprzeczna niepusta wartość tworzy conflict do rozstrzygnięcia |
| make/model/year/spec | Rex canonical fields i provenance/source timestamp per source; nie wybierać zwycięzcy bez merge policy | discovery summary vs detail refresh osobno | brak pola pozostawia poprzednią dobrą wartość; jawne source clear wymaga osobnej semantyki |
| auction state/time/timed | enum/source status + raw source status w ograniczonym provenance; auction_at i timed_end_at rozdzielone | hot/warm; aktualizuje się na nowym source timestamp | missing != zakończona; bez terminu nie twórz countdownu |
| current bid / Buy Now / final / source price | oddzielne pola i USD provenance/observed time | ceny aktywne częściej wg klasy; ended nie odświeżać ciągle | zero/null zachowuje semantykę; generic price nigdy automatycznie final |
| seller/document/condition/location/media | normalizowane wartości; media referencje oddzielone od binarnych assetów | summary/detail na podstawie zmiany | brak sprzedawcy nie jest Unknown-name; nie kopiować aktualnego seller do eventu; media retention osobno |
| events | event status, event date/sale date, source_price/final_price oddzielnie, seller tylko event-scoped | tylko selektywna history refresh | źródłowy `Not Sold`/`Sold on Approval` zachowuje znaczenie; brak final price zostaje null |
| sync timestamps | `last_attempt_at`, `last_success_at`, `last_complete_at`, scope cursor | aktualizacja przez state machine | próbę/partial nie przedstawiać jako świeżość poprawnego complete runu |

Per-field provenance w pełni szczegółowa może zwiększyć storage; pierwsza wersja powinna zachować `provider/source_key`, `source_updated_at`, `observed_at`, `normalizer_version` per source/listing, a provenance pola dodać tylko jeśli konflikty wymagają audytu.

## 4. Docelowy D1 model

Konkretna, additive-only wersja empty schema jest w `docs/proposals/0004_d1_sync_2.sql`. Jest wyłącznie szkicem do code review i testu na pustej SQLite; nigdy nie jest automatyczną migracją.

| Proponowana tabela | Rola |
|---|---|
| `vehicle_entities` | nowy wewnętrzny entity ID, nullable VIN hint i stan jakości dopasowania; brak automatycznego VIN merge |
| `vehicle_sources` | adapter source record, provider/platform/ID, relacja opcjonalna do entity, normalizer/fingerprint i świeżość detail |
| `auction_listings` | indeksowalny bieżący/ostatni summary pojedynczego listing cycle i jego refresh state |
| `auction_events` | history events z provider-scoped identity; event source price/final price rozdzielone, bez raw JSON |
| `auction_listing_snapshots` | opcjonalne changed-summary observations, oddzielone od events; używać tylko po zgodzie retencyjnej |
| `provider_sync_scopes` | discovery feed cursor, lease, last attempt/success/complete, next due |
| `sync_runs` | bounded run audit/counters/latency/error category; bez body/PII |

Schemat nie zapisuje zdjęć/mediów ani raw payloadów. Kanoniczne pola nadal są danymi pochodnymi providerów — wypełnianie ich długoterminowo czeka na prawa. `auction_listing_snapshots` może być wyłączone/retencjonowane osobną konfiguracją; na początek preferować overwrite bieżącego summary i nie insertować snapshotów, dopóki nie potwierdzono retencji.

Nie migruj/nie backfilluj w jednej operacji. Najpierw utrzymuj oba modele bez re-key; dodawaj powiązania tylko przy przyszłym sync nowych listingów i dopiero po review. Legacy `vehicle_key` i surowe wiersze pozostają nietknięte.

### Indeksy — celowo ograniczone

Proposal tworzy indeksy dla:

- Provider source resolution: `(provider, platform, provider_vehicle_id)` jako **nieunikalny** do czasu potwierdzenia stabilności ID.
- Dokładnego VIN hint i LOT: `(normalized_vin, platform, updated_at DESC)` i `(platform, lot, updated_at DESC)`. Wynik może być wieloma listingami; warstwa API wybiera zgodnie z jawną regułą, nie `LIMIT 1` przypadkowego row.
- Głównego katalogu: `(platform, auction_state, auction_at, listing_id)`; osobny timed partial index `(platform, timed_end_at, listing_id) WHERE is_timed=1`; Buy Now partial `(platform, buy_now_usd, listing_id) WHERE buy_now_usd>0`.
- Make/model/year + auction time tylko po EXPLAIN i potwierdzonym zapytaniu katalogowym; szeroki composite index ma koszt zapisu/storage.
- Event pages: `(listing_id, auction_date DESC, event_id)`; source event ID non-unique `(provider, platform, provider_event_id)` aż do audytu stabilności/kolizji.
- Due queue: `(next_refresh_at, freshness_class, listing_id)`; scope lease/due; listing snapshot `(listing_id, observed_at DESC)` tylko jeśli snapshots są włączone.

Nie twórz indeksu dla każdego damage, seller, fuel, color, document i spec field. Filtry rzadsze mogą używać indeksów głównych, małej metadata table lub skanu ograniczonej kandydatury; sprawdzić `EXPLAIN QUERY PLAN` i realne query patterns przed dodaniem indeksu. Każdy indeks zwiększa koszt write i storage.

Z tego powodu propozycja SQL **nie** tworzy jeszcze indeksu make/model/year. Dodać go dopiero po pomiarze rzeczywistych zapytań i planów. Sprawdzić także koszt kompozytowego indeksu katalogu dla aktualnego udziału Copart/IAAI i keyset ordering.

### Legacy compatibility/read model

- Zachować istniejący `vehicle_key`, `vehicles` projections i publiczny API DTO.
- W fazie dual-read, `/api/cars` scala/serializuje tylko nowy indeks katalogowy oraz legacy rows w stabilny ordering/cursor. Nie losować kolejności po świeżości.
- D1 keyset cursor jest Rex.Bid opaque cursor, np. sort key + `listing_id`, podpisany/wersjonowany, nie cursor Apibara.
- Exact VIN/LOT może zwrócić wiele matching listings. Użyć jawnego rankingu `active → last observed → platform/lot`, albo odpowiedzi disambiguation jeśli niejednoznaczne; nigdy pierwszego przybliżonego matchu.
- `/?catalog=1`, Home aisles, pagination and filters run indexed D1 queries. JSON shape `data/meta` stays compatible; new freshness metadata can be additive. Apibara is never a front-end parameter.

## 5. Discovery, refresh i D1-first

### Discovery Sync vs Detail Refresh

**Discovery**: Provider `listVehicles` pages (page size capped at 20 per current adapter), canonicalize and validate summaries, upsert listing summary, checkpoint page cursor. Nie dociągaj detail/history każdego znalezionego auta. Uruchamiaj source-supported delta (`updated_within_minutes`) tylko jeśli provider gwarantuje semantykę/cursor; okresowo pełny bounded traversal wykrywa znikające/zmienione pozycje. Brak rekordu w pustej/partial page nie oznacza usunięcia.

**Detail refresh**: fetch znanego provider vehicle/listing ID tylko dla nowego listing wymagającego pól karty, stale HOT/watched, konkretnej zmiany, operatora lub jawnego user refresh. Nie robić go przy każdym list item. Detail fields aktualizują tylko niepuste/valid values; przechowywać freshness osobno od list summary.

**History refresh**: osobny, limitowany budżet. Nie pobieraj pełnej historii nowo odkrytego auta. Pierwszą stronę pobierać tylko przy wyświetleniu/wyraźnym sygnale lub selektywnym backfillu; kontynuować cursor po jawnej prośbie albo niskiej częstotliwości background priority. Per-run limit stron, budżet godzinowy, dedupe event ID/key, powtarzany cursor stop, provider cursor expiry restartuje od początku z idempotentnym replay. Historia nie jest eventem snapshot.

### Freshness tiers (konfiguracja, nie twardo wdrożone SLA)

Nie ma wiarygodnego SLA ani limitu planu podanego przez Apibara; poniższe to **proponowane parametry do kalibracji**, nie promise użytkownika:

| Klasa | Przydział | Proponowany target | Co odświeżać |
|---|---|---|---|
| HOT | aktywna/trwająca, timed end bliski lub obserwowana przez użytkownika | summary list max co 6 h w budżetowym modelu; pojedynczy detail max 1/dobę chyba że source changed/explicit refresh; widoczny listing może dostać niski, osobny foreground refresh limit | summary + selektywny detail; nie pełna historia |
| WARM | aktywna, aukcja dalej w przyszłości | summary przez codzienne discovery; detail co najwyżej przy nowym listing/zmianie lub wybrane max co 7 dni | summary, mała część detail |
| COLD | zamknięta/terminalna/historyczna | brak regular detail polling; event/history tylko jawny demand albo ograniczona kontrola statusu | event refresh z limitem, nie zdjęcia |

Model requestów poniżej zakłada 5% HOT populacji z 4 summary sweeps/dobę, pełne discovery raz/dobę, 2% detail refresh/dobę, 1% history refresh/dobę + 10% z tej grupy pobiera jedną dodatkową stronę. To pomaga ocenić górny koszt, ale nadal zakłada prawnie dozwolone persistence. Częstotliwości muszą być config versioned, centralnie ograniczone i obniżone do faktycznego allotmentu. Nie ustawiaj mniejszego interwału niż provider pozwala.

### D1-first + stale-while-revalidate

1. `GET /api/cars`, Home sections, `/api/filters`, detail/history najpierw czytają D1 po indeksach (po migracji/fill i cutover). Zwracają zgodne DTO i `data_as_of`/freshness — ostatni udany source update, nie ostatnią próbę.
2. Stale-but-known summary jest zwracane natychmiast z timestampem i stanem stale, jeśli wyświetlenie/retencja nadal dozwolone. Błąd providera nie usuwa ani nie nadpisuje dobrych pól.
3. GET nie blokuje się na Apibara i nie uruchamia ukrytego sync. Opcjonalny async enqueue może być tylko po jawnej, dedupowanej regule, z globalnym budget i liczbą 0 dla zwykłego user view; standardowy D1 GET najlepiej bez enqueue.
4. Exact VIN/LOT cache miss w przejściowym rollout może wykonać ograniczony, read-only live lookup, bez persistence, oznaczony jako live fallback. Po wyłączeniu fallback, brak record daje uczciwe not-found.
5. `/api/filters` po wdrożeniu jest zmaterializowanym, ograniczonym metadata projection z D1/cache; odświeża ją sync scope, nie każde wejście. Zachować aktualny kontrakt.
6. Cache API pozostaje krótką warstwą nad D1. Cache TTL nie może przekroczyć dozwolonego data-retention/cache contract.

Freshness UI nie powinien zdradzać technicznego vendora, chyba że source disclosure wymaga; format np. `Dane zaktualizowano: …` i `odświeżenie opóźnione`, source timestamp null → `czas aktualizacji niedostępny`.

## 6. Synchronizacja, koszt i request budget

### Jawny model dobowy

Założenia modelu — **nie są wynikiem live pomiaru**:

- źródło daje 20 records/list page; full discovery once/day = `ceil(N/20)`.
- HOT = 5% N, 4 list-summary refresh/day = `4 × ceil(0.05N/20)`.
- wybrane detail refresh = 2% N/day = `ceil(0.02N)` requests.
- history refresh = 1% N/day, 1 pierwsza strona + jedna dodatkowa cursor page dla 10% tej kohorty: `ceil(0.01N) + ceil(0.001N)`.
- suma bazowa + 5% retry reserve (429/5xx/timeout/partial): `ceil(base × 1.05)`. Retries nie są automatyczne natychmiast; reserve jest zużywany z kontrolowanym backoff.
- Nie doliczono osobnego filter metadata refresh; założyć 1/day/provider-platform combination i dodać do budżetu, np. maksymalnie 2/day przy Copart+IAAI. Liczba list pages dla strony wyznacza requesty, nie records.

| Listings N | discovery pages | HOT extra pages | detail | history first + cursor | base/day | retry reserve | model/day | średnio/h |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 000 | 50 | 12 | 20 | 11 | 93 | 5 | **98** | 4,1 |
| 10 000 | 500 | 100 | 200 | 110 | 910 | 46 | **956** | 39,8 |
| 50 000 | 2 500 | 500 | 1 000 | 550 | 4 550 | 228 | **4 778** | 199,1 |

Wartości zaokrąglone w górę; do każdego scenariusza dodać 1–2 metadata refresh/day. To **scenariusz planistyczny**. Jeśli pełny daily discovery przekracza plan/limit Apibara, obniżyć discovery cadence/zakres i proporcjonalnie kohorty; nie zwiększać concurrency. Przed włączeniem trzeba znać planowy quota, czy każdy page/filter/detail/history countuje jako osobny request, granice 429, cache/retention terms i limit cursorów.

`requests/user page view` po D1 cutover: zwykłe Home scroll (4 sekcje), catalog page/pagination, detail z cached D1, history read, filter read oraz konto/favorites: **0 upstream**. Jawny/awaryjny exact lookup: 1 provider detail, ewentualnie 1 exact list fallback; history explicit live fallback: 1/page. W transition mode cache miss może kosztować 1–2. Nie gwarantować D1 read-only claim do czasu route instrumentation; licznik powinien pochodzić z adapter request metric.

### Sync lifecycle / atomicity / limits

```text
Cron control tick (budgeted)
  → claim provider/platform scope lease
  → enqueue bounded work (or process one bounded page)
  → provider adapter fetch one list page
  → canonicalize + validate + reject unsafe/partial clears
  → atomic D1 batch: idempotent upserts + counters + next cursor
  → repeat only within budget/time; otherwise leave resumable cursor
  → mark scope complete only when cursor is terminal and all page writes committed
```

- **Idempotency:** deterministic source/listing keys; retrying a page repeats the same canonical records. `sync_page_commits` keys cursor hashes by `(scope_key, run_id, cursor_hash)`: replay within a run is a no-op, while a new run may start at the same initial cursor. Repeated next cursor within one run is rejected. Page upserts, cursor checkpoint and run progress commit in one D1 `batch`; statement failure rolls back the whole page.
- **Leases:** conditional claim uses `lease_owner + lease_token + lease_generation`. One transaction claims an expired/free scope and marks its abandoned running runs `interrupted`; generation blocks stale workers (ABA protection). A second worker cannot claim an active lease; no database transaction is held across network I/O.
- **Cursor:** store encrypted? Provider cursors may be opaque sensitive identifiers; store only while run is incomplete, scope limited, never log/URL expose; expiry/policy-configured TTL; on cursor invalid restart from first page only if page upserts are idempotent. Keep `cursor_version`/updated timestamp. A provider cursor can be cleared after complete traversal.
- **Freshness:** `last_attempt_at` always updates; `last_success_at` when one requested operation completes; `last_complete_at` only after full relevant scope. Per-source `detail_synced_at` and `history_synced_at` distinct. Partial does not update full-scope freshness.
- **Partial data:** validate identity and minimum contract; missing/null leaves prior value; only explicit, documented clear event can clear field. Don’t update listing's completeness/freshness if validation skipped a record/page.
- **Crashes/concurrency:** recover expired lease after Worker death; persist run as interrupted/partial on next claimant. D1 one-writer behavior favors low consumer concurrency; start 1 worker per provider scope, then load-test. No DO needed for first release.
- **Retries:** 429 honors validated Retry-After as lower bound, with provider-wide backoff; 5xx/network timeout use exponential backoff+jitter, bounded attempts and daily retry reserve. Auth/invalid schema/400 are blocked for operator review. One-hour/day provider outage does not erase rows; pause that provider's schedule, mark stale, continue D1. Changed API fails validation and alerts, not silent null overwrites. Provider disappearance keeps last permitted data only until retention says delete/expire.
- **Metrics:** `provider_requests/day`, operation, status class, 429s, latency histogram/summary, runs complete/partial/failed, pages/records, validation omissions/conflicts, stale count, queue depth/oldest age, last successful complete time. No email/VIN/LOT in logs/metrics. High-cardinality source identifiers stay in protected D1 state only if needed/authorized.

### Trigger choice

- **Cron Triggers**: one low-frequency scheduler/tick to enqueue due bounded scopes, deterministic and simple. Avoid a cron invocation traversing thousands of records/pages inside one request.
- **Cloudflare Queues**: recommended worker for page/source tasks once sync is enabled; durable backlog/backpressure/retry. Start consumer concurrency low (proposal 1–4, then measured), batch modest, strict provider token bucket. Queue is not a license to exceed upstream quotas.
- **Workflows**: defer; durable multi-step orchestration may help long imports/cursor chains, but the bounded page+cursor state machine plus queue is simpler and more directly idempotent.
- **Durable Objects**: not justified initially. D1 lease + queue and one provider-budget scope sufficient. Revisit only if cross-region, strong global token bucket/coordination needs cannot be safely handled otherwise.

Cloudflare execution, D1 and Queue limits depend on account plan and change over time. D1 is single-threaded per DB and constraints on duration/row size/connections apply; design queries as indexed keyset pages and small atomic batches. Verify actual account limits before rollout. See [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Queues limits](https://developers.cloudflare.com/queues/platform/limits/), [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) and [D1 metrics](https://developers.cloudflare.com/d1/observability/metrics-analytics/).

W opublikowanej tabeli limitów sprawdzonej na 2026-09-28 D1 podaje limit rozmiaru bazy zależny od planu (500 MB Free / 10 GB Paid), maksymalnie 100 kolumn w tabeli i rozmiar pojedynczego wiersza do 2 MB; zapytanie ma limit czasu i liczby parametrów. Worker ma limit równoległych połączeń wyjściowych na invocation. Queue i Cron mają osobne limity czasu/ilości. Są to limity platformy, nie potwierdzenie planu ani konfiguracji konta Rex.Bid. Przed rolloutem sprawdzić aktualny plan, quota/billing D1, limity zapytań i dostępność paid features; nie planować wykorzystania limitu maksymalnego. Trzymać listing row znacznie poniżej 100 kolumn i 2 MB, nie przechowywać raw payload/media, paginować SQL małymi porcjami i mierzyć row reads/writes.

## 7. Retention / provider outage behavior

Per-data-class retention is deployment configuration/versioned policy: `listing_summary_ttl`, `detail_ttl`, `history_ttl`, `snapshot_ttl`, `media_reference_ttl`, `raw_payload_ttl`. Use null/disabled to prohibit a class; no implicit infinite retention. Each has `effective_from`, `reviewed_at`, `source/permission reference`, and `max_age`. Expired data is hidden/deleted only according to contractual policy; deletion audit records counts, not payload. Apibara factual-data storage permission is recorded in `docs/APIBARA_DATA_RIGHTS.md`; set each factual-data retention class to an explicit reviewed value under that permission and applicable platform/privacy requirements. Permission for raw provider payload and permanent original-photo archive is not granted by the response.

| Provider state | Rex.Bid behavior |
|---|---|
| 429 | global pause/backoff, no immediate retry storm, serve last permitted D1 summary as stale |
| 5xx/timeout/network | bounded retry later, preserve last good values and timestamps |
| down ~1 hour/day | normal D1 read path; freshness becomes stale; sync backlog bounded and coalesced, no catch-up flood |
| schema drift/partial fields | canonical validation flags partial; leave old good fields; no complete freshness advance |
| provider permanently unavailable/contract ended | stop requests; follow retention/deletion license; don’t promise indefinite archive; adapter can be replaced without frontend changes |

## 8. SAFE NOW implementation steps and rollout

| Phase | Goal / files | Tests and acceptance | Risk / rollback | Request budget |
|---|---|---|---|---:|
| A — contract, identity & offline repository | **IMPLEMENTED OFFLINE**: `sync/core.js`, `sync/planning.js`, `tests/d1-sync-phase-a.test.cjs`; no public UI or D1 | Fake B/Apibara canonical parity, identity collision/relist, partial merge, cursor replay/crash, repeated cursor, leases, request budget, freshness tiers | Low; offline/unreferenced modules can be disabled; no DB effect | 0 live |
| B — repository + empty additive schema | **OFFLINE VERIFIED**: `sync/d1-repository.js`, disposable SQLite, proposal 0004; actual Cloudflare D1 not verified | atomic page batch, replay/cursor, leases, merge, budget, query plans and unchanged legacy rows; staging D1 validation requires separate approval | Medium; repository is not connected to Worker/API; disable by not invoking it; no persistent DB changed | 0 provider; SQLite only |
| C — bounded manual discovery shadow run | protected staging operator route/queue, one page per job, write only the approved canonical subset under configured retention | same page replay idempotent, D1 writes count, compare D1 summary vs adapter, injected crash/429 | Medium; turn off trigger; retain no data beyond configured policy | fixed cap e.g. ≤20 calls/run; no production |
| D — read-only D1 shadow catalog | add D1 repository behind disabled flag; compare output to upstream/cache without exposing to user | contract DTO parity, paging/filter correctness, EXPLAIN, response-time and staleness | Low-medium; flag off returns existing upstream path | normal user page 0 D1 shadow may still use provider only for comparison; cap comparison |
| E — D1-first staging cutover & refresh | enable D1 reads on staging; queue/Cron refresh, no UI redesign | outage simulation, stale fields, category/filters, cold miss, exact VIN/LOT ambiguity | Medium; instant feature flag back to known read path; no cleanup | normal page 0, bounded async budget |
| F — selective detail/history | schedule detail/history separately; first-page demand, cursor continuation | event dedupe/relist, seller event scope, incomplete history, retention expiry | High legal/storage risk; disable jobs and stop new writes, preserve/delete according to agreement | independently capped; no mass history fetch |
| G — production cutover | after documented factual-data permission (recorded), confirmed plan quota, verified backup/restore, migration review, performance and ops review | staged rollout, API compatibility, D1 cost budgets, rollback rehearsal | High; dark launch/read shadow then feature flag | hard daily cap set below written quota |

### Migration/rollback

`0004_d1_sync_2.sql` contains only `CREATE TABLE/INDEX` for new tables; no changes to legacy primary keys/data and no DML/backfill. It supersedes conceptually `0002`; **do not apply both**. Proposal is not in Wrangler’s configured `migrations/`. Rollback for pre-data schema is feature disable then drop only newly introduced empty tables in an explicitly reviewed non-production rollback script; do not add automatic DROP to migration. Once rows exist, rollback is disable writes + restore from verified backup/retention-compliant export; never silently delete or remap. Migration first gets tested on disposable SQLite and isolated staging DB; production target name/ID and pending migrations require independent confirmation and approval. No one-shot mass import; crawl bounded cursor pages only within the documented factual-data permission, after quota/operations approval. Original-photo archive is excluded unless separately licensed.

## 9. Open gates and first implementation step

Before coding persistent data path:

1. Apibara factual-data permission is recorded in `docs/APIBARA_DATA_RIGHTS.md`; preserve the original written response in controlled records. Still confirm plan quota/counting/retry semantics with Apibara. Independently review Copart/IAA platform terms, privacy obligations, and original-photo copyright/storage; no permanent original-photo archive without separate rights.
2. Current plan quota semantics: requests per day/hour, page calls counting, burst/concurrency, 429 retry policy, available delta/update endpoint and cursor lifetime.
3. Provider listing/vehicle/event ID guarantees and LOT reuse/relisting semantics for both Copart and IAAI; acceptable matching/conflict/retention rules.
4. Owner-approved target freshness SLA and maximum daily request budget derived from plan and estimated operating cost.
5. Cloudflare account plan and current D1/Workers/Queues quota confirmation, data volume forecast, backup/restore and monitoring owner.

### Phase A — wykonane offline, bez trwałego zapisu

`sync/core.js` implementuje provider-neutral identity helpers, partial canonical merge oraz `InMemorySyncRepository`. `sync/planning.js` zawiera konfigurowalne obliczenie dobowego request budget, guard rezerwacji oraz planner HOT/WARM/COLD z obowiązkowym `now` i policy przekazywanymi przez wywołującego. `tests/d1-sync-phase-a.test.cjs` prowadzi canonical fixtures Apibara i strukturalnie inny Fake Provider B przez ten sam repository; adapter Apibara użyty jest tylko do lokalnej normalizacji fixture, a jego fetch jest zabroniony.

Identity zwraca osobno `sourceKey`, `listingId`, `vehicleCandidateKey`, `vinCandidate` oraz `entityId`. Provider vehicle ID i VIN pozostają kandydatami/provenance — nie dowodzą fizycznej tożsamości; `entityId` pojawia się wyłącznie po przekazaniu zaufanego `confirmedEntityId` z przyszłego procesu reconciliation. VIN nie jest PK ani automatyczną regułą merge. LOT reuse/relisting wymaga jawnego `listingGeneration` albo nowego stabilnego source listing ID. Brak stabilnych ID wymaga page-scoped `observationKey` i otrzymuje stan `ambiguous`, dzięki czemu takie obserwacje nie są automatycznie scalane.

Merge zachowuje wcześniejszą wartość dla pól pominiętych, `null`, pustych stringów i pustych tablic. `0` i `false` są wartościami, nie brakiem. Jawne kasowanie jest możliwe tylko po podaniu `explicitClears` dla ścieżki potwierdzonej przez źródło. In-memory repository usuwa z zapisu testowego raw payload/json i zawartość mediów; nie jest to trwałe repozytorium ani zgoda na retencję.

Discovery page jest walidowana i upsertowana przed checkpointem. Powtórzenie ukończonej strony jest no-op; crash po upsercie, lecz przed checkpointem, można bezpiecznie odtworzyć idempotentnym upsertem. Cursor pozostaje opaque, pusty/powtarzany/cofający się cursor jest odrzucany, a `lastCompleteAt`/`lastSuccessAt` przesuwa się wyłącznie po terminalnej stronie zakresu. Lease w pamięci blokuje drugiego wykonawcę, pozwala odzyskać wygasły lease i zwalnia go po zakończeniu/błędzie; failed run nie zmienia udanej świeżości.

Budget planner liczy discovery pages, HOT sweeps, detail, pierwszą/ciągłą stronę historii, metadata i retry reserve; domyślne założenia odtwarzają **98 / 956 / 4 778 requestów/dzień** dla 1k/10k/50k rekordów. To nadal model z założeń sekcji 6, nie ustalony limit dostawcy. Guard odmawia nowych rezerwacji po wyczerpaniu limitu, ale nie cofa rozpoczętego requestu; po `complete()` usuwa jedynie rekord rezerwacji w pamięci, a naliczone zużycie pozostaje. Proporcje planu są walidowane w zakresie 0..1. Freshness planner używa konfigurowalnych interwałów i czasu `now` przekazanego przez caller.

Phase A jest **offline only**: nie używa D1, nie zapisuje nowych snapshots, raw payloadów, zdjęć ani trwałej historii, nie uruchamia Workera/schedulera i nie zmienia publicznych endpointów.

### Phase B — repository/schema foundation, D1 VERIFIED

`sync/d1-repository.js` implementuje provider-neutral repository dla bindingu zgodnego z D1. Przyjmuje canonical `RexVehicle` oraz identity z `sync/core.js`, waliduje wejście i mapuje ograniczony zestaw summary columns. Nie importuje Apibara adaptera. `raw_payload` i zawartość mediów są usuwane; nie zapisuje nowych events ani snapshots.

`persistDiscoveryPage()` umieszcza entity/source/listing upserty, cursor ledger, scope checkpoint i run progress w jednym `db.batch()`. Pierwszy guard sprawdza scope/provider/platform, lease owner/token/generation/expiry, aktywny run, oczekiwany cursor i zapobiega replay/pętli. Awaria statementu ma wycofać cały batch; checkpoint i `last_complete_at` nie mogą wyprzedzić danych. Ograniczenie strony to maksymalnie 20 rekordów.

Cursor ledger przechowuje hash opaque cursora i kluczuje go przez `(scope_key, run_id, cursor_hash)`, dzięki czemu replay tej samej strony w runie jest idempotentny, a kolejny run może ponownie zacząć od pierwszego cursora. Surowy cursor scope jest utrzymywany tylko jako checkpoint nieukończonego przebiegu i nie może trafiać do logów ani URL-i.

Lease wykorzystuje losowy token i monotoniczny generation. W tej samej transakcji odzyskania lease poprzednie porzucone runy `running` przechodzą w `interrupted`; stale owner nie może zapisać, failować ani zwolnić nowego lease. Trwały budżet requestów jest rezerwowany transakcyjnie per provider/dzień, z oddzielną pulą retry. Wyczerpanie budżetu blokuje nowe rezerwacje, lecz rozpoczęta praca może bezpiecznie zakończyć checkpoint.

Testy odtworzyły `0000` + `0001` i legacy rows na `node:sqlite` disposable DB, dwukrotnie zastosowały proposal 0004, potwierdziły niezmienione legacy rows/PK, replay, crash rollback, cursor loop, run-scoped initial cursor, leases i stale-owner protection, merge, Fake Provider B, budget race oraz `EXPLAIN QUERY PLAN`. Na staging D1 `rexbid-auth-test-db` wykonano następnie jednorazowy test przez rzeczywisty Worker binding z danymi syntetycznymi: `db.batch()` persist + checkpoint, rollback statementu, replay, cursor/repeated-cursor guard, lease acquire/block/expiry/recovery/stale generation, budget reservation/retry reserve, partial merge i query plans przeszły. Cleanup potwierdził wszystkie nowe Sync tables = 0 wierszy, `users=1`, `user_favorites=1`, legacy `vehicles`, `vehicle_snapshots`, `auction_history` bez zmian; foreign-key check pusty. Nie wykonano żadnego requestu providera.

**Phase C — wynik shadow testu:** Request ID `e62bf910-74b3-4386-a7ab-4a01be9fef6e`; pojedyncza strona Copart (`per_page=20`), 1 request Apibara łącznie. Provider zwrócił 20 rekordów; canonicalizer zaakceptował 20, odrzucił 0 i oznaczył 0 jako niejednoznaczne. Przy pustym baseline tabel Sync zapisano 20 nowych listingów, bez raw payloadów, mediów, URL-i zdjęć, snapshotów ani historii. Ponowne przekazanie tej samej przechwyconej strony do repository nie utworzyło duplikatów; synthetic Provider B, partial update, failure/recovery, replay, budget i readback przeszły. Nie pobierano detail ani history i nie wykonywano zewnętrznego requestu Provider B.

Tail dla tej próby potwierdził `stage=complete`, `live_requests=1`, `ok=true` i `cleanup=true`. UI wyświetliło `cleanup: undefined`, ponieważ endpoint zwracał `endState.cleanupPass`, a komponent oczekiwał `cleanup.verified`. To był wyłącznie błąd prezentacji wyniku; końcowy SELECT na rzeczywistym D1 potwierdził cleanup. Zachowany test `cleanupReport()` normalizuje to pole i chroni przed regresją.

Po cleanup: wszystkie 11 tabel Sync = 0; `users=1`, `user_favorites=1`; legacy `vehicles=0`, `vehicle_snapshots=0`, `auction_history=0`. Publiczne `/api/cars`, Home, karta auta i Accounts nie korzystały z shadow rows. Tymczasowy endpoint, przycisk i flaga Phase C zostały usunięte z czystego stagingowego bundle.

**Status przy zamknięciu Phase C:** Phase A **DONE**; Phase B **D1 VERIFIED**; Phase C **SHADOW VERIFIED** (jedna strona, jeden live request; staging D1 odczytana bezpośrednio i cleanup potwierdzony); Phase D nie była wtedy rozpoczęta. Aktualny status Phase D podano w sekcji poniżej. Proposal 0004 pozostaje w `docs/proposals/`, poza aktywnym katalogiem migracji i nie została zastosowana do produkcji. Końcowy staging Worker bez tymczasowej trasy Phase C: `c3137145-5d14-4cb6-b888-51c092b25938`.

**Stan w chwili zamknięcia Phase C:** Phase E — projekt i walidacja D1 Primary Reads — nie była wtedy rozpoczęta. Bieżący status Phase E jest podany na początku tego dokumentu. Factual data/history/snapshots/derived/commercial use objęte są odpowiedzią Apibara opisaną w `docs/APIBARA_DATA_RIGHTS.md`, ale nie oznacza to dowolnego wolumenu ani wyłączenia niezależnych praw Copart/IAA. Trwałe archiwum/redistribution oryginalnych zdjęć nadal nie jest zatwierdzone. Phase D nie włączyła harmonogramu, queue, publicznego odczytu Sync ani masowego importu.

### Phase D — persistent staging discovery (CODE VERIFIED; AUTOMATED VERIFIED; STAGING PERSISTENT DISCOVERY VERIFIED)

Dodano staging-only `staging/phase-d-discovery.cjs`, route wrapper w `worker.staging.js`, przycisk na `staging/auth-test-page.js` i tymczasowy flag `REXBID_PHASE_D_DISCOVERY`. Endpoint wymaga HTTPS oraz dokładnego staging hostu i flag, POST, Origin zgodnego z originem, `Sec-Fetch-Site: same-origin`, niepustego sesyjnego cookie weryfikowanego przez wewnętrzne `/api/me`, pustego body i właściwego staging D1 bindingu. Nie jest częścią production Worker/config.

Runner jest ograniczony do jednego Copart list call o `per_page=20`; persistent campaign budget ma cap 5, ale osobny single-page guard odmawia drugiej próby nawet wtedy, gdy provider zwróci next cursor. Rezerwacja i zużycie budżetu poprzedzają call; brak automatycznego retry. Discovery zapisuje tylko kanoniczne entity/source/listing summary fields, bez `raw_json`, payloadu, zdjęć, media URLs ani eventów historii. Nie pobiera detail/history. Każdy nowy listing zapisuje bazowy `auction_listing_snapshots` fingerprint; identyczny fingerprint jest no-op, a zmiana auction state/date/timed end/current bid/Buy Now zapisuje nowy snapshot w tej samej atomowej `db.batch()` co listing, page ledger, run progress i checkpoint. `auction_events` nie jest tworzona z discovery i pozostaje bez fabrykowanych danych.

Odświeżone wskaźniki runu w `sync_runs` (records received/inserted/updated/skipped, provider request count i latency) są zapisywane atomowo z checkpointem. Staging run zwrócił 20 rekordów, zaakceptował 20, odrzucił/oznaczył jako niejednoznaczne 0, wstawił 20 i zaktualizował 0; powtórne przekazanie przechwyconej strony potwierdziło replay bez duplikatów. Powstało 20 snapshotów stanu początkowego, 0 auction events. Brak raw payload/media; discovery nie pobierał detail/history.

**Bezpośredni staging D1 readback (target `rexbid-auth-test-db`, ID `acb3cb8e-69a2-459f-8a46-0f2f5b9004be`):** `vehicle_entities=0`, `vehicle_sources=20`, `auction_listings=20`, `auction_events=0`, `auction_listing_snapshots=20`, `provider_sync_scopes=1`, `sync_runs=1`, `sync_page_commits=1`, `sync_batch_guards=0`, `provider_request_budgets=1`, `provider_request_reservations=1`. Wszystkie 20 listing IDs i source keys są unikalne; 20 listingów ma provider listing ID i VIN candidate, a wszystkie mają fingerprint; 20 źródeł ma unikalną tożsamość źródłową; każdy listing ma snapshot.

`vehicle_entities=0` jest zachowaniem oczekiwanym, nie brakującym zapisem: provider discovery zawiera VIN-y, ale `createSyncIdentity()` traktuje VIN/provider ID jako kandydata, nie dowód tożsamości fizycznego auta. Entity tworzy się wyłącznie po jawnej, zaufanej rekonsyliacji przekazującej `confirmedEntityId`; Phase D takiej rekonsyliacji nie wykonuje. Nie scalono automatycznie aut po VIN.

Scope ma status `partial`, zachowany opaque cursor (wartość nie jest ujawniana w dokumentacji), jeden page commit z `next_cursor_hash`, a lease jest zwolniony. To oczekiwane: dostępna jest następna strona, więc `last_complete_at` pozostaje puste i nie twierdzimy, że cały zakres discovery został ukończony. Można wznowić go później z zapisanej pozycji; Phase E/strona 2 nie została uruchomiona. Run zawiera 1 ukończoną stronę i 20 odebranych/wstawionych rekordów, a jego status pozostaje częściowy dla scope’u.

Budget D1: normal limit 5, consumed 1, reserved 0; retry limit/consumed/reserved 0. Jedna normal reservation ma stan `finished`. W tej weryfikacji nie wykonano kolejnego requestu Apibara. `users=1`, `user_favorites=1`; legacy `vehicles=0`, `vehicle_snapshots=0`, `auction_history=0`. Zapytania kontrolne miały `rows_written=0`, `changed_db=false`. Sync schema nie zawiera kolumn `raw_json` ani mediów; nie zapisano binarnych ani archiwalnych zdjęć.

Publiczne `/api/cars`, Home i karta auta nadal nie korzystają z Sync tables; `sync/d1-repository.js` pozostaje poza publicznym odczytem. Produkcja nie była dotykana. Nie wykonano cleanupu danych Phase D.

**Status Phase D:** persistent discovery na stagingu zweryfikowany dla jednej strony. Nie oznacza to kompletnego ingestionu całego scope’u ani scheduled sync. Aktualny stan Phase E i jej staging-only read model opisano na początku dokumentu; production D1 Primary Reads pozostaje poza zakresem.

## Sources / status

- Apibara Terms, reviewed 2026-09-28: <https://apibara.tech/en/terms>. Public terms do not resolve specific long-term listing/history/media retention rights.
- Cloudflare D1 batch/transaction API: <https://developers.cloudflare.com/d1/worker-api/d1-database/#batch>; foreign keys: <https://developers.cloudflare.com/d1/sql-api/foreign-keys/>; D1 limits: <https://developers.cloudflare.com/d1/platform/limits/>; Workers limits: <https://developers.cloudflare.com/workers/platform/limits/>; Queues limits: <https://developers.cloudflare.com/queues/platform/limits/>; Cron: <https://developers.cloudflare.com/workers/configuration/cron-triggers/>; D1 metrics: <https://developers.cloudflare.com/d1/observability/metrics-analytics/>. Confirm account plan/current quota before enabling.
- No Apibara live request was performed for this architecture design. Budget values are mathematical scenarios based on current adapter page cap and stated assumptions. The permission status was updated on 2026-09-29 from the owner-reported written response in `docs/APIBARA_DATA_RIGHTS.md`; it supersedes earlier open-permission wording above.

## Phase F — controlled backfill and scheduling (CODE VERIFIED; AUTOMATED VERIFIED; STAGING PERSISTENT BACKFILL VERIFIED)

### Safe resume path

`staging/phase-f-backfill.cjs` provides a manually invoked staging-only continuation for the existing `rexbid-phase-d:persistent-discovery:copart` scope. It reads the persisted opaque cursor; it never starts at page one if a checkpoint exists. The normal staging UI requests `max_pages=2`; the endpoint accepts only 1–3 pages per run. Page size is 20, matching the observed adapter/request bound. There is no automatic retry. A started request is permanently charged before `fetch()`, including failed/time-out attempts.

The Phase F campaign is separate from Phase D's historical 1/5 budget and has an independent durable ceiling of **5 additional real provider requests total** (`apibara-phase-f`, `campaign-phase-f-controlled-backfill`, retry limit 0). Existing persisted usage cannot be reset by a second button click. Before any live operation, read `normal_consumed + normal_reserved`; if it is at the cap, schedule no provider call. A run stops on actual terminal pagination, requested page limit, exhausted campaign budget, lease conflict, provider error, invalid/empty canonical page, cursor repetition, or D1/readback error. Errors never fabricate completion. A failed page preserves the previous cursor; successfully committed earlier pages stay committed and resumable.

For every page, the lease and budget reservation precede upstream work. Provider list summary is normalized and identity-validated. The page's canonical listing/source upserts, initial/change snapshot fingerprint, `sync_page_commits`, run counters and next opaque cursor are committed by existing `D1SyncRepository.persistDiscoveryPage()` via D1 `batch()`. Thus checkpoint does not advance without that page's writes. A replay of the captured page in the same run is idempotent; no second provider request is used to prove replay. No details/history/media/raw response are fetched or stored. A page whose provider response repeats its input cursor is rejected, and the runner stops rather than looping.

The staging endpoint requires exact HTTPS host, all staging flags and target name, POST, matching Origin, `Sec-Fetch-Site: same-origin`, an existing verified BFF session, and the staging D1 binding. It has no production route counterpart. It only writes the Sync 2 schema; Accounts and legacy catalog tables are not part of the runner. The Phase E read repository sees committed new listings but reports known-row pagination separately from scope completeness.

### Completeness and freshness state

Persisted scope statuses remain `partial`, `complete`, `failed`/`blocked`; `complete` is written only when upstream returns no next cursor. `stale` is a derived freshness state, not a stored coverage status, so it cannot make an incomplete scope look complete or break resume. A partial scope is stale by age of its last cursor attempt; complete scope is stale by age of `last_complete_at`. `classifyScopeState()` requires an explicit timestamp and configured staleness age. Phase E should expose both coverage (`complete` boolean, cursor available) and freshness; `stale` never means full coverage.

Current staging policy variables are tunable values, **not approved production SLAs**: HOT due interval 5 minutes, WARM 6 hours, COLD 7 days; HOT window 2 hours; scope stale threshold 24 hours. HOT selection is near/live auction or explicitly watched; WARM is active/upcoming but not imminent; COLD is terminal/sold/ended or lacks a usable schedule. Before production, choose values from plan quota, auction cadence and operational needs. Discovery list summaries stay cheap; detail and history are separate selective queues/cohorts, not per-listing mandatory calls.

### Request model (mathematical, not quota approval)

Adapter page size is capped at 20 and Phase D observed one request for one page of 20. Initial full discovery therefore costs `ceil(N/20)`: 50 / 500 / 2,500 calls for 1k / 10k / 50k listings. The current `calculateDailyRequestPlan` assumptions add four sweeps of a HOT cohort (5% of listings), detail refresh for 2%/day, first history page for 1%/day, continuations for 10% of that history cohort, and a separate 5% retry reserve rounded up:

| Listings | Discovery | HOT sweeps | Detail | History first + continuation | Base/day | Retry reserve | Modeled total/day |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1,000 | 50 | 12 | 20 | 10 + 1 | 93 | 5 | **98** |
| 10,000 | 500 | 100 | 200 | 100 + 10 | 910 | 46 | **956** |
| 50,000 | 2,500 | 500 | 1,000 | 500 + 50 | 4,550 | 228 | **4,778** |

This conservative model treats discovery as a complete listing sweep each day because the reliability/meaning of an upstream changed-since filter has not been established here. A verified delta feed could reduce discovery to `ceil(changed_rows/20)`; do not assume that saving until the endpoint semantics and cursor stability are documented. These figures do not prove the Apibara plan quota. Phase F campaign limit is independently only 5 total additional calls, not the modeled daily rate. With D1 as read source, ordinary page views are designed for 0 Apibara calls; current public routes have not been cut over, so do not claim that production already has this property.

### Scheduling plan (not activated)

1. Manual bounded staging runner first; operator starts a limited page count, observes budget, checkpoints, readback and failure state.
2. After repeated staging runs and confirmed plan/Cloudflare quotas, consider one low-frequency Cron dispatcher that selects due scopes and creates bounded Queue messages; never execute a full sync loop inside one Cron invocation.
3. Queue consumer reserves the persistent provider budget, acquires a per-scope D1 lease, processes at most one page/message, checkpoints, then enqueues continuation only if scope/budget/page cap permit.
4. Separate discovery from HOT/WARM/COLD selective detail refresh and first-page/history-cursor jobs. Detail/history have independent quotas and may be disabled without stopping discovery.
5. Dead-letter/429/5xx pauses the affected scope with safe `retry_after_at`; no automatic retry in Phase F. Later backoff must remain inside a distinct configured retry reserve and must not consume the normal pool.

No Cron trigger, Queue binding, consumer, production schedule or automatic provider sync is enabled in Phase F. The owner performed one authenticated manual run on staging and it succeeded for two pages: **2 real Apibara requests**, 40 returned/accepted records, 40 inserts, 0 updates, 0 duplicates, 40 initial snapshots, no events, raw payload/media not stored, and a next cursor remains. The persistent data is intentionally retained; no cleanup was performed. Direct read-only verification of `rexbid-auth-test-db` (`acb3cb8e-69a2-459f-8a46-0f2f5b9004be`) confirmed 60 sources/listings/snapshots, 0 entities/events, 1 partial scope, 2 runs, 3 page commits, Phase F campaign budget 2/5 consumed with 0 reserved and retry disabled, 60 distinct listing IDs/source keys with no duplicates, `users=1`, `user_favorites=1`, legacy tables 0/0/0. Scope `last_complete_at` is NULL; the saved cursor permits later resumption. SELECT metadata confirmed no writes during verification. Phase E's persisted model remains compatible by identity and storage contract; the Phase F runner uses the same repository upserts/page checkpoint and does not alter the public API/read path. No Cron/Queue, public API cutover or production change was made. The current 60-row partial scope is not enough for a public API cutover. More backfill and a coverage/operational decision are required before Phase G.

### Phase F later bounded campaign continuation — readback 2026-09-30

This later owner-approved campaign supersedes the earlier 60-listing/budget snapshot above; those values remain as historical checkpoints. No new provider operation was run for this readback. The owner's last run advanced the Copart scope from 180 to 220 listings: 40 provider records accepted, 40 inserts, 40 initial snapshots, zero duplicates, and a next cursor. Direct read-only SELECT against staging D1 `rexbid-auth-test-db` (`acb3cb8e-69a2-459f-8a46-0f2f5b9004be`) confirmed:

| Data | Readback |
| --- | ---: |
| `vehicle_sources` / `auction_listings` / `auction_listing_snapshots` | 220 / 220 / 220 |
| `vehicle_entities` / `auction_events` | 0 / 0 |
| Copart scope | 1, `partial`, opaque cursor present, `last_complete_at=NULL` |
| `sync_page_commits` for scope | 11 |
| Distinct listing IDs / source keys | 220 / 220; duplicate count 0 |
| `users` / `user_favorites` | 1 / 1 |
| Legacy `vehicles` / `vehicle_snapshots` / `auction_history` | 0 / 0 / 0 |
| Campaign budget | 8 consumed / 10 limit; 0 reserved; retry 0 |

Wrangler reported the verification queries as read-only (`changed_db=false`, `rows_written=0`). Live Apibara requests during this verification: **0**; campaign total remains **8/10**. The owner-directed stop at 8/10 is in force; no further backfill was run. The stored next cursor and 11 page commits show resumable progress, not completion. No IAAI scope is included in this sample.

**Phase G assessment:** 220 rows are adequate for bounded diagnostic tests of the D1 read model (known-row listing/detail/snapshot queries and observed filter distributions). They are not sufficient for a public catalog cutover: the only scope is partial Copart, pagination has not reached its end, and IAAI coverage is absent. Do not present those rows as the complete catalog or activate public API cutover. Recommendation: **more backfill first**, subject to a separately approved request budget; the current campaign is stopped.
# Phase G — staging public API D1-first wrapper (2026-10-01)

## Status

**Status: STAGING VERIFIED / AUTOMATED VERIFIED.** Final Worker `rexbid-auth-test` Version `a6569e87-47be-4039-af7c-cd36374afdde`, D1 `rexbid-auth-test-db`. The cutover is mounted only by `worker.staging.js`; `worker.js` and production `wrangler.jsonc` are unchanged. No sync, discovery, backfill, or provider call is performed by D1 list/filter reads.

## Switch and isolation

`REXBID_D1_PRIMARY_READS=true` is configured only in `wrangler.staging.jsonc`. Activation also requires HTTPS, the exact hostname `rexbid-auth-test.tedn828.workers.dev`, the existing staging UI/host guard, and `REXBID_D1_READ_TARGET=rexbid-auth-test-db`. Production has neither the wrapper import nor this flag. Any failed guard delegates to the existing Worker route.

Rollback is immediate at the configuration level: set the staging flag to `false`, verify `wrangler.staging.jsonc` still names `rexbid-auth-test` and D1 `rexbid-auth-test-db`, then redeploy only that config. The original provider-backed route handles the public API; stored D1 data remains untouched. Re-enable by setting `true` and redeploying staging.

## Read and completeness rules

- `/api/cars`: D1 known rows, with the established `{ok,data,meta}` envelope and existing cursor pagination over only stored rows. `meta.read_source=d1`, `catalog_complete=false`, `known_rows_only=true`, and global platform coverage remain explicit. A platform filter does not conceal the other platform's scope.
- `/api/filters`: values are computed only from known D1 rows. `metadata_complete=false` and `known_rows_only=true` prevent partial values from appearing market-complete.
- Detail: exact unique listing/source identifier and usable fresh record (24h default) returns D1 without provider access. Missing, ambiguous, incomplete, or stale records delegate to the existing provider endpoint. A stale record is `hybrid`; non-null provider values enrich it while null/empty fields do not erase known D1 values. Fallback reason and `read_source` are attached to the response and structured log.
- History: D1 returns `observed_snapshot` rows separately from `confirmed_auction_event` rows. An initial snapshot never means sold or an auction event. The 6h default freshness threshold controls whether D1 history suffices; missing/stale history delegates to the existing provider path, without inserting fabricated events.
- D1 errors/schema mismatch fall back to the pre-existing provider API and are logged with a safe reason. If that provider path itself is unavailable, its established safe response is preserved.
- All cutover API responses currently use `private, no-store` while being validated; no shared cache can mask stale D1 data. Auth/account stays private/no-store.
- Real smoke verified list/filter and IAAI detail/history as D1 responses. Current client-visible HTTP round trips were roughly 470–1,100 ms; Worker-side D1 operation logs were 0–2 ms. A stale Copart detail used hybrid fallback (~728 ms client round trip; ~237 ms Worker route). These are smoke samples only.
- One real staging rollback check set the flag OFF, called `/api/cars` once, and observed the original provider-backed envelope; the flag was then restored ON and the final D1-first deployment completed. This plus the stale Copart detail accounts for **2 provider-backed reads** during this verification; no discovery/backfill occurred.
- Real browser showed Home/catalog, the partial badge and an IAAI car page with D1 detail, empty-photo state and snapshot/event distinction. The browser-control surface did not expose DevTools console/network panels; Wrangler tail captured the stale-detail request and safe route/source/freshness/fallback timing logs.
- Filter query mapping now translates `lot_sub_status=Open`, `lot_status=Buy Now|Timed`, `upcoming=only|without` to canonical D1 predicates. Behavioral tests cover these cases and assert they never call the provider.

## Observability

Structured staging logs include safe route template, random request ID, `read_source` (`d1`, `provider`, `hybrid`), D1 hit/miss, freshness, fallback reason, cache behavior and elapsed milliseconds. They do not include VIN, email, cookies, tokens, or request bodies. The staging HTML partial badge is shown only on the exact guarded staging host while the flag is enabled.

## Current D1 scope and production gates

Starting data: 220 Copart and 80 IAAI sources/listings/snapshots; both scopes partial with separate cursors; zero events/entities; users/favorites 1/1; legacy tables empty. These 300 known rows are not the full catalog. Before production D1-first: complete/accepted scope for every advertised catalog segment (or product-approved explicit partial semantics), verified production schema/migration and backup/restore, freshness/cost budget, provider outage/fallback behavior, monitored rollback, and separately approved production migration/deploy. No production setting is enabled here.
# Staging Product Milestone media/catalog addendum — final readback 2026-10-01

Staging-only migration `migrations-staging/0005_listing_media_urls.sql` adds nullable `auction_listings.media_urls_json` and `media_thumbs_json`; values are validated HTTPS URL references only. Latest direct readback has 260 Copart + 120 IAAI listings/sources, 380 snapshots, 0 events/entities, users/favorites 1/1 and no duplicate source identities. Scopes remain partial with separate cursors. URLs and thumbnails are populated for 40 listings per platform (80 total); 300 older rows still have no stored media references. No binary media was downloaded or stored.

The controlled UI backfill is a bounded authenticated staging operation. The latest owner-reported run advanced Copart 220→260 and IAAI 80→120 using four live discovery requests total, with 80 initial snapshots and no duplicates; no backfill was run in this final media QA pass. Discovery remains partial and no scope is represented as a complete market catalog.

Real-browser catalog QA found and fixed a status mapping defect: `lot_sub_status=Open` must map to `auction_state`; the source's display `source_status` may be a date string and is filtered only when an explicit `source_status` query is supplied. The corrected UI returns known D1 rows while keeping scope metadata partial. Timed/upcoming sections can correctly be empty for this bounded sample.

Media root cause: the adapter maps list record `media.items` and `media.thumbs` to the canonical Rex.Bid media shape; sync sanitizes HTTPS references; the D1 repository persists URL arrays; read repository and public DTO expose them to `car.html`. The real 80 populated rows verify this pipeline for records whose discovery summaries carry media. Original request bodies are not retained, so retrospective inspection of the exact raw records is impossible. The prior `rawOrMediaStored=false` flag only meant no raw payload or binary image was stored; it was an ambiguous diagnostic that incorrectly suggested URL arrays were absent. It is replaced by independent raw-payload, binary-media, and persisted-URL counters.

Real-browser QA loaded fresh media-bearing D1 detail records. Initial Copart rendering exposed a gallery normalization bug: 13 canonical full URLs plus 13 matching thumbnails were counted as 26 images. IAAI showed 17 because its imageKeys permit URL-variant deduplication. `public/rexbid-media.js` now pairs canonical parallel URL/thumb arrays so a thumbnail is a rendition of the same image, not an extra photo; focused behavioral tests cover paired arrays, missing thumbs, HTTPS-only filtering, IAAI identity deduplication, and integration with the real `car.html`. Post-fix staging browser verification remains pending.

Home loaded known D1 cards with the partial badge. A narrow mobile-style viewport had no observed horizontal overflow. Catalog showed vehicle thumbnails but exact sampled card→media-bearing-row correlation is unverified. Desktop viewport, console/Network, and exact fallback-call count remain NOT VERIFIED. No discovery, backfill, or media enrichment request was initiated during this pass. Fresh rows used for gallery QA were within the D1 detail freshness threshold; no provider fallback is required for their stored media.

The 300 rows without media URLs were not enriched. Any later media enrichment must be a separate bounded detail-read operation with per-platform request caps, durable progress, no automatic unlimited retries, and URL-only persistence. Never archive original binary photos. Migration/readbacks did not touch production.

## Final media/gallery verification — 2026-10-01

The pending browser verification above is complete. Final staging Worker Version is `d86cef66-7683-42d6-8c75-32566f828a81`. Direct staging SELECT confirms Copart 260 + IAAI 120 sources/listings, 380 snapshots, 0 events/entities, 80 URL-populated rows and 80 thumb-populated rows (40 per platform), no duplicate provider/platform/provider-vehicle IDs, and Accounts 1/1. The read changed no rows. Both scopes remain partial with separate cursors.

Copart LOT 73650295 rendered 13 unique images; IAAI LOT 44803631 rendered 17. The client treats canonical `media.items` as authoritative and pairs `media.thumbs` by index. Real-browser testing found and fixed an additional extraction regression: `car.html` still needed the shared HTTPS URL predicate for video/360 and source navigation; this now comes from `RexBidMedia.isHttpUrl`. Mobile 375px and desktop 1350×900 viewports had no horizontal overflow; guest favorite add/remove, next image and lightbox open/close passed.

No discovery/backfill/detail enrichment was intentionally run (0 Apibara requests in this pass). The 300 older records without URL refs remain unchanged. Home/catalog and fresh detail readbacks used known D1 rows; exact automatic provider fallback count and browser console/Network capture are NOT VERIFIED. Full suite 299/299 plus generator/config/syntax/diff checks pass. Production was not touched.
