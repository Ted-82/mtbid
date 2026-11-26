# Publiczny snapshot katalogu — narzędzie offline 2026-10-07

`node --test tests/public-catalog-snapshot.test.cjs`: **10/10 PASS**. Wykonano rehearsal insertów na rzeczywistym `docs/proposals/0004_d1_sync_2.sql` w SQLite `:memory:`; FK=0. Brak requestów sieciowych, zapisu do D1, deploymentu, commitu ani pobrania nowych danych providerów przez ten moduł.

API `scripts/public-catalog-snapshot.cjs`:

```js
const {buildPublicCatalogSnapshot} = require('./scripts/public-catalog-snapshot.cjs');
const plan = buildPublicCatalogSnapshot({
  tables: {vehicle_sources, auction_listings, auction_listing_snapshots, auction_events},
  columns: {vehicle_sources: sourceColumns, auction_listings: listingColumns,
    auction_listing_snapshots: snapshotColumns, auction_events: eventColumns},
  capturedAt: new Date().toISOString(),
  existingListings: []
});
// plan.statements: {table, columns, sql, params}[]; tylko plan, bez wykonania.
// plan.manifest: agregaty, hash publicznych danych/hash planu, status partial.
```

`columns` przyjmuje nazwy kolumn albo rekordy `PRAGMA table_info`. Cztery tablice tabel publicznych są wymagane; mogą być puste. Inne tabele oraz dodatkowe, niewpisane na whitelistę kolumny są ignorowane i nie wpływają na content hash. Publiczne kolumny są ustalone statycznie; nie wynikają z zaufania do dowolnego schematu wejściowego. Kopiowane są oryginalne IDs, relacje i timestampy, bez VIN dedupe, bez wywnioskowanej ceny finalnej i bez sztucznego odświeżania danych. `vehicle_sources.entity_id=NULL`; tabela fizycznych encji nie jest kopiowana ani uzgadniana. Leases, source errors, runs, budgets, cursor state, Accounts i tabele prywatne nie trafiają do planu. Media są wyłącznie bezpiecznymi referencjami przepuszczonymi przez istniejące `safeMediaReferences`; liczba wejściowych i zatrzymanych referencji jest w manifeście.

Wynik odrzuca nie-Apibara, platformy inne niż `copart`/`iaai`, brakujące FK, duplikowane PK oraz dokładne kolizje `(platform,LOT)`. Ten sam VIN w różnych LOT pozostaje oddzielnymi ofertami; ten sam LOT na różnych platformach pozostaje oddzielny. `existingListings` jest opcjonalnym preflightem kolizji z niepustym celem. SQL jest stały i zawiera wyłącznie INSERT z bound params; istniejących rekordów nie nadpisuje.

Dla każdej obecnej platformy powstaje osobny `provider_sync_scopes`:

- `scope_key=public-snapshot:apibara:<platform>:<contentHash24>`;
- `status='partial'`, `operation='discovery'`, `cursor=NULL`;
- `last_attempt_at`, `last_success_at`, `last_complete_at` są NULL;
- `updated_at=capturedAt` odnosi się tylko do nowego scope. Daty publicznych danych pozostają źródłowe.

Manifest nie oznacza pokrycia ani zakończonej synchronizacji: `catalog_complete=false`, `status='partial'`, `accounts_included=false`, `entity_reconciliation_performed=false`. Zawiera agregaty per platforma, liczniki tabel, `all_timestamp_range` wszystkich zachowanych dat oraz osobny `listing_observed_at_range` wyłącznie z last_seen_at/summary_synced_at/detail_synced_at, count mediów, `content_sha256` i `plan_sha256`. Istniejące stare scopy nigdy nie są importowane. Wielokrotne wykonanie tego samego INSERT planu na już zapełnionym celu powoduje konflikt, zamiast cichego upsertu.

Preflight celu przed wykonaniem planu przez zadanie główne, po backupie i niezależnym potwierdzeniu właściwej odseparowanej bazy:

```sql
SELECT platform, lot, COUNT(*) AS n FROM auction_listings
GROUP BY platform, lot HAVING COUNT(*) > 1;
SELECT 'sources' AS table_name, COUNT(*) AS n FROM vehicle_sources
UNION ALL SELECT 'listings', COUNT(*) FROM auction_listings
UNION ALL SELECT 'snapshots', COUNT(*) FROM auction_listing_snapshots
UNION ALL SELECT 'events', COUNT(*) FROM auction_events;
PRAGMA foreign_key_check;
```

Readback: powtórzyć liczniki oraz sprawdzić zakres timestampów, scope partial/cursorNULL/last_completeNULL i FK; `vehicle_entities` oraz operacyjne tabele nie powinny zostać zasilone przez snapshot. Pełna baza produkcyjna, provider sync i zdalna wiarygodność świeżości danych nie były tu weryfikowane.

Do oceny aktualności używać wyłącznie `listing_observed_at_range`; przyszłe aukcje w `all_timestamp_range` nie potwierdzają świeżości. Oryginalne daty nie-ISO są dopuszczalne, jeśli Date.parse jest poprawny; narzędzie zachowuje ich bajty.
