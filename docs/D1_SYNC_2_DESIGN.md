# Rex.Bid D1 Sync 2 — projekt architektury

**Status: Phase A DONE; Phase B D1 VERIFIED; Phase C SHADOW VERIFIED na izolowanym stagingu; Phase D NOT STARTED.** Phase B zweryfikowano na disposable SQLite oraz na prawdziwym Cloudflare D1 bindingu `rexbid-auth-test-db`, wyłącznie na danych syntetycznych. Phase C wykonała jeden ograniczony request discovery i zapisała minimalny, tymczasowy canonical subset do nowych tabel Sync; po bezpośredniej weryfikacji cleanup wszystkie te rekordy usunięto. Produkcyjne `rexbid-db`, konfiguracja produkcji i publiczne API pozostały nietknięte. Proposal 0004 nadal leży poza aktywnymi migracjami Wrangler; nie stosować go do produkcji.

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

**Status:** Phase A **DONE**; Phase B **D1 VERIFIED**; Phase C **SHADOW VERIFIED** (jedna strona, jeden live request; staging D1 odczytana bezpośrednio i cleanup potwierdzony); Phase D **NOT STARTED**. Proposal 0004 pozostaje w `docs/proposals/`, poza aktywnym katalogiem migracji i nie została zastosowana do produkcji. Końcowy staging Worker bez tymczasowej trasy: `c3137145-5d14-4cb6-b888-51c092b25938`.

**Następny krok:** Phase D pozostaje **NOT STARTED**. Wcześniejszy blocker pisemnej zgody Apibara na factual data/history/snapshots/derived/commercial use został zamknięty odpowiedzią opisaną w `docs/APIBARA_DATA_RIGHTS.md`; nie jest to automatyczna zgoda na dowolny wolumen ani wyłączenie niezależnych praw Copart/IAA. Trwałe archiwum/redistribution oryginalnych zdjęć nadal czeka na osobną zgodę. Przed Phase D wymagane są osobny zakres, request budget/plan limits, retencja konfiguracyjna, backup/rollback i approval. Phase C nie włączyła harmonogramu, queue, publicznego odczytu Sync ani masowego importu.

## Sources / status

- Apibara Terms, reviewed 2026-09-28: <https://apibara.tech/en/terms>. Public terms do not resolve specific long-term listing/history/media retention rights.
- Cloudflare D1 batch/transaction API: <https://developers.cloudflare.com/d1/worker-api/d1-database/#batch>; foreign keys: <https://developers.cloudflare.com/d1/sql-api/foreign-keys/>; D1 limits: <https://developers.cloudflare.com/d1/platform/limits/>; Workers limits: <https://developers.cloudflare.com/workers/platform/limits/>; Queues limits: <https://developers.cloudflare.com/queues/platform/limits/>; Cron: <https://developers.cloudflare.com/workers/configuration/cron-triggers/>; D1 metrics: <https://developers.cloudflare.com/d1/observability/metrics-analytics/>. Confirm account plan/current quota before enabling.
- No Apibara live request was performed for this architecture design. Budget values are mathematical scenarios based on current adapter page cap and stated assumptions. The permission status was updated on 2026-09-29 from the owner-reported written response in `docs/APIBARA_DATA_RIGHTS.md`; it supersedes earlier open-permission wording above.
