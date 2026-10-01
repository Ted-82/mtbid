# Rex.Bid — Project Handoff

## Latest multi-platform staging readback — 2026-10-01

- Staging Worker `rexbid-auth-test` is Version `5c887ebe-9477-47d1-92b6-5e36f638d40d`, bound only to `rexbid-auth-test-db` (`acb3cb8e-69a2-459f-8a46-0f2f5b9004be`). Production was not targeted.
- Direct read-only D1 results: Copart sources/listings/snapshots **220/220/220**; IAAI **80/80/80**. Duplicate listing/source groups **0/0**; events/entities **0/0**; `users/user_favorites=1/1`; legacy vehicles/snapshots/history **0/0/0**.
- Copart and IAAI retain distinct discovery scopes and opaque cursors. Both are `partial`, with cursor present. Page commits: Copart **11**, IAAI **4**. IAAI `last_success_at` is set (`2026-10-01T08:55:47.280Z`) while `last_complete_at=NULL`, correctly reflecting committed pages without complete pagination.
- Budgets: current campaign **4/12**, IAAI **4/6**, no reserved/retry calls; previous campaigns remain separate (including prior Copart 8/10). No Apibara requests were made during this verification.
- Tests: **277/277 PASS**; syntax checks and `git diff --check` pass. Phase G public API cutover remains OFF. Recommended next step: checkpoint, then one IAAI resume (maximum 2 pages) before considering Copart.

## Multi-platform staging backfill / Phase G preparation — 2026-10-01

- **CODE / AUTOMATED VERIFIED; staging runner DEPLOYED, IAAI live run NOT YET VERIFIED.** Worker `rexbid-auth-test` now runs Version ID `dcfc17fa-fc43-4234-b450-335e8d0b7c03`, bound only to `rexbid-auth-test-db`. The provider-neutral Copart/IAAI runner uses independent durable scopes, cursors, leases and request budgets. Existing Copart scope key is preserved; IAAI receives its own new scope. Each operator action is capped at two 20-record pages, with no automatic retries.
- New campaign key `campaign-multiplatform-4c4e938`: hard ceiling **12 new Apibara requests total**, split into max 6 per platform. Before this continuation, live ledger = **0/12**. The earlier Copart campaign count 8/10 remains historical and is not reset or included in the new budget. Stop each platform when pagination completes.
- The authenticated staging panel exposes each platform's scope state/freshness, cursor presence (not cursor value), request consumption, counts/facets, and bounded D1 catalog/detail/history/filter timing. The panel and routes are exact-host + staging-flag + staging-D1 gated. Public production routes are unchanged.
- Offline behavioral tests cover parallel scopes with shared VIN, independent failure/budget/cursor, replay, batch rollback/recovery, page/campaign caps, and staging-route auth/origin. Full suite after the latest code and UI changes: **277/277 PASS**; partner rate generator `--check`, touched-module syntax checks, and `git diff --check` also pass.
- Staging dry-run and deployment used `wrangler.staging.jsonc`; its only Worker/D1 targets were `rexbid-auth-test` and `rexbid-auth-test-db` (`acb3cb8e-69a2-459f-8a46-0f2f5b9004be`). Production was not targeted.
- Fresh direct D1 readback (read-only, `changed_db=false`, `rows_written=0`): Copart `sources/listings/snapshots=220/220/220`; IAAI `0/0/0`; events/entities `0/0`; duplicates `0`; Copart scope `partial`, cursor present, 11 page commits, `last_complete_at=NULL`; no IAAI discovery scope yet. `users=1`, `user_favorites=1`; legacy vehicles/snapshots/history `0/0/0`. Old durable budgets remain Phase D `1/5`, Phase F `2/5`, and previous Copart campaign `8/10`. New campaign `campaign-multiplatform-4c4e938` has no budget rows/reservations yet, i.e. **0/12 used**.
- Browser opened `/auth-test.html` after deployment, but current browser session is `Anonymous`; protected status/action controls remain unavailable. No Apibara call was made. **Next owner action:** sign in with the existing staging account (do not share credentials), then click the IAAI action once. That run is capped at 2 pages; perform direct readback before deciding whether to resume Copart. Phase G public API cutover remains OFF; production is untouched.

## Aktualizacja stawek transportowych partnera (2026-09-30)

- Właściciel Rex.Bid wskazał realne tabele partnera/importera jako **autorytatywne robocze źródło stawek transportowych Rex.Bid** do chwili aktualizacji przez partnera. Wcześniejsze publiczne estymacje/benchmarki transportu są **superseded** i nie mogą być traktowane jako źródło cen.
- Docelowy przepływ: `auction location → land transport rate → route/hub → sea freight → remaining import costs → door-to-door estimate`. Stawki mają być wersjonowanymi danymi konfiguracyjnymi, oddzielonymi od algorytmu; później można rozważyć tabelę D1/panel admina.
- Źródłowe cenniki znajdują się w `data/partner/land_transport_rates.md` i `data/partner/sea_transport_rates.md`. Wygenerowany rate set zawiera 610 lokalizacji lądowych; dane i pełny audyt znajdują się w `docs/TRANSPORT_RATE_MODEL.md`.
- Obie tabele oznaczają kwoty `$`; zgodnie z decyzją właściciela rate set ma walutę USD. Sea 40'HC: 1 `[1850,1850,2400,4400,2400,4200]`; 2 `[950,950,1250,2250,1250,2100]`; 3 `[650,650,850,1515,850,1485]`; 4 `[575,575,675,1175,675,1050]`. `effective_from` pozostaje null, bo cenniki nie podają daty; port mapping nie został podany.
- Stare publiczne estymacje są superseded. Door-to-door estimator pozostaje **PROTOTYPE**, a nie źródło cen.

## Calculator V2 — lokalny/staging fundament partner rates (2026-09-30)

- Dodano odrębne `public/rexbid-transport-rates.js` i `public/rexbid-transport-engine.js`; strict calculator (`rexbid-calculator.js`) i jego podatki/opłaty nie zostały zmienione. Karta auta ma osobny UI „Szacowany koszt transportu”, stagingową flagę `REXBID_TRANSPORT_CALCULATOR_ENABLED` oraz automatyczny kontekst platformy, lokalizacji i dostępnych danych pojazdu. Production config flagi nie włącza; Worker usuwa UI/skrypty i blokuje oba assety, jeżeli flaga nie jest jawnie włączona.
- Matcher realizuje kolejno exact platform+location, platform+ZIP, platform+city/state, ZIP, city/state; normalizuje wielkość liter, interpunkcję, ZIP+4 i skróty/nazwy stanów. Match niejednoznaczny lub brak danych nie wybiera stawki.
- Parser `scripts/partner-transport-rates.cjs` deterministycznie importuje oba pliki, waliduje strukturę/walutę, normalizuje pola, zachowuje `source_row`, liczy audyt i generuje config. `--audit`, `--write`, `--check` opisano w `docs/TRANSPORT_RATE_MODEL.md`.
- Matcher używa exact platform+location → platform+ZIP → platform+city/state → ZIP → city/state. Kolizje zwracają `ambiguous`; nie ma fuzzy matchingu. Każdy wariant wybiera niezależnie najtańszą kompletną sumę ląd+morze: standard 4 auta i ostrożny 3 auta. Route IDs nie są pokazywane klientowi.
- Strict engine został połączony z partnerowymi land/sea values jako `configurable`, z ręcznym override zachowującym pierwszeństwo; podatki i fee logic bez zmian. Znane subtotal USD/PLN są osobne; pełna suma nadal blokowana przez brakujące opłaty aukcyjne/importowe, FX/podstawy podatkowe.
- **Status:** parser/rates/engine/strict integration/UI **CODED LOCALLY / AUTOMATED VERIFIED**; **STAGING NOT DEPLOYED / NOT VERIFIED**. Produkcja niezmieniona. Door-to-door public-market prototype jest superseded jako źródło cen i nie jest ładowany w nowym UI karty.

## Bieżąca kontynuacja backfillu / przygotowanie Phase G (2026-09-30)

- **Końcowy readback po kontynuacji Phase F:** właściciel zgłosił ostatni run: listings 180→220, +40 rekordów i +40 snapshotów, 0 duplikatów, scope partial z cursorem; trwały budżet kampanii wynosi 8/10. Read-only SELECT na staging D1 potwierdził: `vehicle_sources=220`, `auction_listings=220`, `auction_listing_snapshots=220`, `vehicle_entities=0`, `auction_events=0`; scope Copart `partial`, cursor obecny, `last_complete_at=NULL`, `page_commits=11`; 220 unikalnych listing IDs i 220 unikalnych source keys; budżet 10/8, reserved 0, retry 0/0. `users=1`, `user_favorites=1`; legacy `vehicles/vehicle_snapshots/auction_history=0/0/0`. Wszystkie kontrole były SELECT-only (`changed_db=false`, `rows_written=0`). W tej weryfikacji wykonano **0 requestów Apibara**; łączny budżet kampanii pozostał 8/10. Nie uruchamiać dalszych requestów na podstawie tego checkpointu.
- **Ocena Phase G:** 220 rekordów wystarcza do testowania diagnostycznego D1 list/detail/history i filtrów na znanych wierszach, ale nie do bezpiecznego publicznego katalogu: zakres jest częściowy, tylko Copart, cursor istnieje, a pokrycie nie obejmuje końca paginacji ani IAAI. Rekomendacja: **more backfill first** przed staging public API cutover; obecna kampania jest wstrzymana na 8/10 zgodnie z decyzją właściciela.
- Bazowy checkpoint `fc9f1d8`; staging Worker został wdrożony jako `rexbid-auth-test`, Version ID `862a11a4-9761-4491-90c9-d64cf367e69d`. Dry-run i upload potwierdziły binding wyłącznie do `rexbid-auth-test-db` (`acb3cb8e-69a2-459f-8a46-0f2f5b9004be`). Konto Wrangler zweryfikowano jako konto właściciela Rex.Bid.
- **Bezpośredni, read-only D1 readback po deployu:** `vehicle_sources=60`, `auction_listings=60`, `auction_listing_snapshots=60`, `vehicle_entities=0`, `auction_events=0`; scope discovery `partial`, cursor obecny, `last_complete_at=NULL`; `users=1`, `user_favorites=1`, legacy `vehicles/vehicle_snapshots/auction_history=0/0/0`. Listing/source keys unikalne, duplikatów brak. Wszystkie 60 wierszy to Copart; 31 marek, roczniki 1963–2025, Buy Now 42, Timed 0, termin aukcji w przyszłości 0 według porównania daty kalendarzowej. Stan pozostaje częściowy i nie jest pełnym katalogiem.
- **D1 SQL latency, pojedyncze odczyty przez Wrangler (nie HTTP end-to-end):** katalog 0.606 ms, exact detail 0.279 ms, snapshot history 0.184 ms, metadata filtrów 0.156 ms. SELECT-e miały `changed_db=false`, `rows_written=0`. Nie wykonano requestu Apibara.
- Staging UI HTTP 200 po deployu; zawiera nową ścieżkę `/__staging/d1-sync-phase-g-backfill`, nie zawiera starej ścieżki Phase F i pokazuje limit 10 requestów.
- Nowa kampania stagingowa ma twardy trwały limit **10 nowych requestów łącznie**, bez retry; poprzedni budżet Phase F (2/5) pozostaje nietknięty. Każde kliknięcie może wznowić maksymalnie 2 strony po 20 rekordów. Runner obsługuje wyłącznie istniejący scope Copart; IAAI nie jest włączone ani mieszane do tego cursora.
- **CURRENT WORK / CONTINUE HERE:** właściciel loguje się istniejącym kontem stagingowym na `/auth-test.html` i klika **„Wznów maksymalnie 2 strony”**. Może uruchomić ten przycisk najwyżej 5 razy, lecz powinien zatrzymać się wcześniej, gdy wynik pokaże `scopeComplete=true` albo `stopReason=scope_complete`; łącznie wszystkie uruchomienia nie mogą przekroczyć 10 requestów. Po każdym uruchomieniu wykonać read-only D1 readback. Phase G public API cutover nie jest aktywowany; bez pełnego scope nie wolno udawać kompletnego katalogu. Produkcja `mtbid`/`rexbid-db` pozostaje nietknięta.

## Phase F — controlled staging backfill (2026-09-29)

- **CODE IMPLEMENTED / AUTOMATED VERIFIED / STAGING PERSISTENT RUN VERIFIED.** The authenticated manual resume ran once for two pages, using exactly **2 live Apibara requests** from the durable 5-request Phase F campaign ceiling (retry reserve 0; no automatic retries). It added 40 accepted Copart records to the existing 20: D1 now has 60 sources, 60 listings and 60 snapshots. The scope remains `partial` with a next cursor; no claim of full catalog coverage.
- The route is guarded by exact staging HTTPS host, staging UI/host/target flags, POST, same-origin Origin and `Sec-Fetch-Site`, valid existing BFF session, and `REXBID_DB` only. It is mounted only by `worker.staging.js`; production `worker.js` and production Wrangler config are unchanged. No Cron, Queue, detail/history refresh, raw payload, media URL or image bytes are used.
- Offline SQLite tests verify cursor resume over several pages, partial then complete scope only after provider end, Phase E read-model visibility, replay/no duplicate listing/snapshot, failure without cursor advance or automatic retry, exhausted budget, lease conflict, repeated cursor protection, and the exact staging route gate.
- **Direct staging D1 readback:** target `rexbid-auth-test-db`, ID `acb3cb8e-69a2-459f-8a46-0f2f5b9004be`. Read-only queries confirmed `vehicle_entities=0`, `vehicle_sources=60`, `auction_listings=60`, `auction_listing_snapshots=60`, `auction_events=0`, `provider_sync_scopes=1`, `sync_runs=2`, `sync_page_commits=3`, `provider_request_budgets=2`, `provider_request_reservations=3`; `users=1`, `user_favorites=1`; legacy `vehicles/vehicle_snapshots/auction_history=0/0/0`. There are 60 distinct listing IDs and 60 distinct source keys, with zero duplicate keys. Phase F run is partial, 2 pages/40 records/2 upstream requests; scope cursor remains present and `last_complete_at` is NULL. Its budget reads 2/5 consumed, 0 reserved, retry limit/consumption/reservation 0. Query metadata reports `changed_db=false`, `rows_written=0`. No D1 writes were made by this verification.
- **Scheduling is design only:** no Cron or Queue is configured/enabled. Current daily estimate from the explicit planner assumptions is 98 / 956 / 4,778 requests for 1k / 10k / 50k listings, including 5% retry reserve; it is a conservative full discovery sweep model, not provider quota confirmation. Ordinary Phase E D1 reads make zero upstream calls when fresh; public routes remain on the existing behavior.
- **CURRENT WORK / CONTINUE HERE:** Phase F has completed its one authorized two-page run. Do not perform another Apibara request under this run’s authorization. More backfill requires a separately bounded approval/budget. The existing 60 known rows are not a full catalog; scope remains partial. No Cron/Queue schedule is enabled, public API reads have not been cut over, and production is untouched. Recommend more controlled backfill before Phase G.

## Phase E — D1 read model (staging, 2026-09-29)

- **Status:** CODE IMPLEMENTED; AUTOMATED VERIFIED; STAGING D1 READ VERIFIED. Final staging Version `6e19e605-a9a1-4e69-babe-0e4a515316ee`. Real staging GETs read catalog, filters, one detail and its snapshot history from D1; the final history shape/cache headers were rechecked after redeploy. Production `worker.js`, public `/api/*`, frontend, D1 schema and Apibara adapter are unchanged. No migration or provider call was made.
- **Partial coverage is explicit:** the persisted Copart scope still has a next cursor and IAAI has no completed discovery scope. Results carry `catalog_complete=false`, `known_rows_only=true`, scope and freshness metadata. The 20 staging rows are not represented as a complete catalog. Snapshot read is explicitly distinct from confirmed auction-event history (`events=[]`, `history_kind=snapshots_only`).
- **Read source policy:** fresh listing/detail data may be served from D1; stale/missing detail can use provider only when the caller explicitly enables and supplies a bounded provider callback. D1 values remain available on provider failure. Catalog/filter D1-only requires complete relevant coverage; otherwise policy calls for provider fallback or an explicitly partial D1 response. The staging diagnostics exercise D1 only and make zero provider calls.
- **Caching:** staging diagnostic reads use `private, no-store` and bypass application cache. D1 is the persisted source; a production cache policy is not enabled by this Phase E code. Public response caching can be considered after a verified complete-scope read path, with freshness/version invalidation.
- **Staging readback:** catalog returned 20 Copart rows, `catalog_complete=false`, source `d1`; filters returned 15 known makes with `metadata_complete=false`; detail resolved a stored Copart listing without `vehicle_entity`; history returned its one `observed_snapshot`, zero auction events, `snapshots_only`, `has_more=false`. Final history GET was HTTP 200 with `Cache-Control: private, no-store` and `X-Robots-Tag: noindex, nofollow, noarchive`. Final SELECT: entities 0, sources/listings/snapshots 20, events 0, scope/run/page commit/budget/reservation 1, guards 0, duplicate listing IDs 0, users/favorites 1/1, legacy tables 0/0/0. Scope remains partial with cursor. SELECT metadata reported `rows_written=0`, `changed_db=false`.
- **Staging verification target:** `rexbid-auth-test` → `rexbid-auth-test-db` (`acb3cb8e-69a2-459f-8a46-0f2f5b9004be`). Do not expose partial D1 data as the public full catalog and do not deploy `mtbid`.
- **CURRENT WORK / CONTINUE HERE:** Phase E staged D1 read model is verified for the existing partial data set. Next work may design bounded coverage/backfill and freshness operations; Phase F/scheduled sync and any public/API cutover have not started. Production remains untouched; live Apibara requests for Phase E = 0.

## Purpose

Rex.Bid is a Polish-language vehicle-auction discovery and research product for Copart and IAAI inventory. It helps buyers find a vehicle, inspect its auction listing and media, understand the source-reported condition and title data, review auction history, and estimate import costs. Rex.Bid presents source data; it does not place bids or guarantee that a vehicle can be registered in Poland.

## Repository and production checkpoint

- Repository: [Ted-82/mtbid](https://github.com/Ted-82/mtbid)
- Branch: `main`
- Current owner-provided checkpoint for this readiness pass: `20eaf49` (D1 Sync Phase C shadow verification). Accounts readiness edits described below are local and uncommitted.
- Owner-confirmed production Worker release: `241cfe3e-663d-49c3-bd2b-b29e8f20cb80` (Provider Independence)
- Local Git base when provider-independence work began: `80128cc` (`Document Rex.Bid architecture and production roadmap`)
- Provider Independence is deployed and production-regression checked at the version above; mark this architecture checkpoint **DONE**.
- Worker: `mtbid`
- Production URL: <https://mtbid.tedn828.workers.dev>
- Wrangler configuration file: `wrangler.jsonc`
- Cloudflare D1 binding: `REXBID_DB` → `rexbid-db` (`971879fe-04ed-4e8c-9dc6-5306980bb872`)
- Static asset binding: `ASSETS` → `./public`
- Current local checkout: `C:/Users/nowic/Desktop/stona_auta-www`, branch `main`, base HEAD `20eaf49`; preserve all uncommitted user/product work.

The production checkpoint and owner acceptance above are supplied by the owner. Do not infer that a local edit is deployed until a later deploy confirms it.

## Deployment status (quality-sprint checkpoint, 2026-09-28)

### D1 Sync 2 — Phase D final staging verification (2026-09-29)

- **Phase D status:** CODE VERIFIED; AUTOMATED VERIFIED; STAGING PERSISTENT DISCOVERY VERIFIED. One controlled Copart discovery page made exactly **1 live Apibara request** (limit 5), received/accepted 20 records, inserted **20 listings and 20 sources**, and created **20 initial listing snapshots**. No updates, duplicates, rejected/ambiguous records, history events, raw payloads, or media were persisted. The records remain in staging D1 by design; no cleanup was performed.
- **Direct read-only D1 readback:** target confirmed from `wrangler.staging.jsonc` as `rexbid-auth-test-db` (`acb3cb8e-69a2-459f-8a46-0f2f5b9004be`). Counts: entities 0; sources/listings/snapshots 20 each; events 0; scope/run/page commit/budget/reservation 1 each; batch guards 0. `users=1`, `user_favorites=1`; legacy `vehicles`, `vehicle_snapshots`, `auction_history` remain 0. Listings and sources are unique; each listing has one fingerprinted initial snapshot.
- **Identity/cursor:** all 20 listing rows have VIN candidates and provider listing IDs, but `vehicle_entities=0` is intentional: VIN is a candidate, not automatic proof of physical-vehicle identity, and discovery supplies no trusted reconciliation (`confirmedEntityId`). The listing/source rows retain those candidates without unsafe cross-listing VIN merges. The discovery scope is `partial`, has a saved opaque cursor and one committed page; `last_complete_at` remains unset because more pages exist. The run records one completed page and remains partial at scope level. Resumption is possible from the persisted cursor. Phase E status is updated above.
- **Budget/media/accounts:** provider budget is 1 consumed / 5 max, 0 reserved, retry allowance 0; the single reservation is finished. Sync schema has no raw payload or media columns; no image bytes or permanent image archive were written. All D1 checks in this verification were read-only (`rows_written=0`, `changed_db=false`). No new Apibara request, cleanup, production operation, deploy, commit, or push occurred during verification.

- **PRODUCTION:** Worker `mtbid` remains on the owner-confirmed provider-independent release `241cfe3e-663d-49c3-bd2b-b29e8f20cb80`; this sprint did not access or change production Worker/D1. Production Accounts are **NOT DEPLOYED**; `0003_accounts_foundation.sql` is **NOT APPLIED** to `rexbid-db`.
- **STAGING:** Worker `rexbid-auth-test`, D1 `rexbid-auth-test-db`, URL `https://rexbid-auth-test.tedn828.workers.dev`; latest staging deployment verified with Wrangler is Version ID `6a3d470a-2778-4030-9e48-6ae7271d7ce4`. It includes request-budget changes: one history page at a time, visibility/phase-aware detail refresh, removal of duplicate client exact-search fallback, 30-second detail cache and cursor-specific 5-minute history cache. Staging has an `APIBARA_API_KEY` secret configured (secret value never read or shown). The latest real-browser vehicle smoke loaded an IAAI VIN, rendered vehicle/media/seller/history, and did not show a page-wide error. Last read-only D1 counts: `users=1`, `user_favorites=1`, `vehicles=0`, `vehicle_snapshots=0`, `auction_history=0`; query reported `rows_written=0`, `changed_db=false`.
- **REAL BROWSER VERIFIED:** Owner-confirmed Accounts Phase 3 login/session/cloud-favorites/logout flow on staging; this sprint verified staging Home/catalog rendering, dynamic filter metadata, Timed Auction detail, IAAI/Copart and ended/approval-pending details, multi-event history, media, and guest favorite add/render/remove in a real browser. Automated tests are not a substitute for those browser checks.
- **PROTOTYPE:** Door-to-door cost estimator remains a prototype using market ranges; it is not a confirmed transport offer or approved production cost calculator. The strict calculator remains separate.
- **NOT VERIFIED THIS SPRINT:** Direct command-line HTTP status/body inspection of each JSON endpoint was blocked by the local Windows TLS client. Browser-rendered Home/filters/details demonstrate successful staging data reads, but do not claim a fresh standalone status-code check for each API route. Production GETs were not rerun in this sprint. No live Apibara calls were made after the request-budget warning; the one controlled staging browser car smoke after deployment made an estimated two provider reads (one detail and one initial history page), no fallback. Earlier exact upstream totals were not instrumented. Real-browser multi-page history interaction was not exercised on this deployment because the selected VIN did not return another cursor page.

## Product and technical overview

The Cloudflare Worker in `worker.js` serves the JSON API and static assets. The browser calls same-origin `/api/...` routes. The current upstream provider is Apibara. Wrangler binds the application D1 database as `REXBID_DB`.

Provider access has an adapter boundary in `providers/apibara.js`; it owns approved upstream operations, URL construction, the `X-API-Key` header from only `env.APIBARA_API_KEY`, timeout, manual redirects, safe transport errors, and Apibara-to-Rex normalization. `providers/contract.js` defines the canonical entities and provider registry. The Worker uses the registry and D1 persistence remains outside the adapter. This provider-independence refactor is deployed in Worker version `241cfe3e-663d-49c3-bd2b-b29e8f20cb80` (GitHub checkpoint `1d917d0`). Never print, copy, fixture, or commit secret values.

### Worker API routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/cars` | GET | Paginated listing/search; adapter-owned upstream filters; public `data`/`meta` response preserved for the current frontend. |
| `/api/car/:identifier` | GET | Vehicle detail by VIN or LOT. Direct lookup and fallback search both require an exact VIN/LOT match; never select the first approximate result. May include a D1 history summary via SELECT. |
| `/api/car/:identifier/history` | GET | Paginated Rex.Bid history events. Accepts `per_page` (adapter bounded, currently 20) and opaque `cursor`; client response stays no-store and separates `history`, `meta.next_cursor`, local `rex_history`, and snapshots. Edge cache is cursor-specific for 5 minutes. |
| `/api/filters` | GET | Proxies normalized filter metadata through the adapter, with a six-hour cache and optional source-supported narrowing. |
| `/api/database` | GET | D1 availability and row counts; read-only. |
| `/api/sync/vehicle/:identifier` | POST | Explicit persistence operation; requires a valid `Authorization: Bearer …` token from `REXBID_SYNC_TOKEN`. It is not a GET and is not a public browsing route. Confirm the secret is configured before relying on it operationally. |

Unknown non-API paths are served through `ASSETS`. Non-GET requests to normal API routes are rejected; OPTIONS supports CORS preflight.

### Current public assets

`wrangler.jsonc` publishes `public/`. The current public pages are:

- `public/index.html` — Home/discovery sections and full catalog view (`?catalog=1`), search, filters, URL state and load-more pagination.
- `public/car.html` — vehicle detail, gallery/media, auction module, details, history and import-cost estimate.
- `public/ulubione.html` — local favorites/watchlist.
- `public/konto.html`, `public/logowanie.html`, `public/rejestracja.html`, `public/reset-hasla.html` — account-related UI. Supabase BFF proof-of-fit passed live E2E on isolated staging. `public/rexbid-auth.js` obtains availability from same-origin `/api/auth/config`; the server fails closed unless explicitly and completely configured. Normal production remains dormant.
- `public/jak-to-dziala.html`, `public/kontakt.html`, `public/o-nas.html` — informational pages.
- `public/rexbid-storage.js` — shared versioned local favorites store, including one-time legacy-key migration and cleanup of retired compare state while preserving favorites. Compare UI/product is removed per owner direction; do not restore it without a new owner decision.
- `public/rexbid-brand.css`, `public/rexbid-mobile-nav.js` — shared visual brand and mobile navigation.
- `public/rexbid-auth.js` — BFF auth/favorite client gated by server configuration; it stores no tokens and uses account-scoped curated favorite cache only after `/api/me` verifies the session.

The repository root also has legacy copies such as `index.html` and `car.html`; Wrangler serves `public/`, so treat those root copies as non-production unless configuration changes deliberately.

## Working behavior to preserve

### VIN / LOT exact match

- A detail URL uses `car.html?vin=...` when a VIN exists and `car.html?lot=...` for a LOT-only vehicle.
- Direct and search fallback results are checked against the requested identifier. Do not use a first-result fallback.
- Listing, discovery cards and favorites must retain exact VIN/LOT links.

### Price semantics

- `pricing.current_bid_usd` and `pricing.current_bid2_usd` represent source-reported bids, not automatically a sale.
- `pricing.buy_now_usd` is a distinct Buy Now amount; zero/null is not shown as a usable price.
- Explicit `sale_price_usd` / `last_sold_price_usd` and event-scoped source data are handled as sale-price fields only when status/source semantics support it.
- Generic `price` remains source/event price. It is not a universal current bid or confirmed final sale price.
- `estimated_cost` is an estimate and must not be shown as the vehicle price.
- A finished auction with a confirmed sale price takes precedence over a future-looking auction date.

### Auction states and Timed Auction

UI status labels use a small Polish vocabulary derived from source auction state/outcome fields. `Sold on Approval` is not `Not Sold` and is not a confirmed sale: the UI says “Oczekuje na zatwierdzenie” and the event has no `final_price` until confirmed. `Not Sold`/`No Sale` remains unsold; `Sold` is sold.

For timed listings use `auction.is_timed`, `auction.timed_end_at`, `auction.sold_timed` and source bid fields. Do not substitute ordinary `auction_at` for the timed end, infer a countdown without a real timestamp, or imply that Rex.Bid can bid.

### Seller, condition and title

- Seller name extraction prefers a usable full source name (including observed provider/detail fields such as `details.attributes.ProviderName` and seller fields in details) over a type code or masked placeholder. `INS` is displayed as the type “Insurance”, never as a seller name. `***`, `Unknown`, empty and equivalent placeholders are missing data.
- Historical seller is shown only when that event itself supplies a seller. Do not copy the current vehicle seller into old events.
- Run state is source-based: `RUN & DRIVE`, `STARTS`, `STATIONARY`, or no claim when unknown. Keys and airbags likewise stay unknown unless the source supplies them.
- Title guidance is conservative and based on document text plus explicit source registration/export/pending flags. The three states are informational, not legal advice or a guarantee. Severe document restrictions take precedence over positive-looking text/flags.
- Never classify all insurance sellers as trustworthy or all non-insurance sellers as untrustworthy.

### History, snapshots and persistence

- `auction_history` is for auction events. `vehicle_snapshots` is for observations of changes to the currently observed vehicle. Do not merge them.
- History uses stable `event_key` / explicit `source_event_id` when present. Different explicit event IDs are separate events even with the same LOT/date. Otherwise the current deterministic fallback uses platform + LOT (or VIN) + event date; price/status are not identity.
- Price/status updates to one event should update that event. Preserve raw source JSON and old data; do not delete records to simplify migration.
- `YYYY-MM-DD` values must remain calendar dates without timezone day shifts.
- GET handlers are read-only with respect to D1. They may perform SELECT for local fallback/summary only. Persistence is explicit and separate; `ensureDatabase()` and DML are not part of the normal GET path.

### Home, catalog and filters

- Home is an offer-discovery page with four bounded aisles: current auctions, Timed Auction, Buy Now and upcoming auctions. Each loads at most four cards; there is no large all-vehicles list on Home.
- Full catalog remains available through `/?catalog=1`, the catalog navigation, and each “Zobacz wszystkie” link. Search/filter state belongs in the query string; applying a filter enters catalog mode and resets the cursor. Load-more remains user-driven.
- Filters are grounded in Worker/Apibara-supported parameters. Make/model options come from `/api/filters`; retain manual input fallback when metadata fails. Do not add decorative/nonfunctional filters.
- Keep the compact vehicle-card size and distinct price labels on each aisle.

### Favorites

- Favorites are stored locally on the user’s device in the shared, versioned `public/rexbid-storage.js` schema. The UI must say that they are device-local until account sync exists.
- VIN is primary identity and LOT is fallback. Avoid duplicates, keep payloads curated, validate image URLs, escape untrusted values and do not put secrets/auth credentials in localStorage.
- Compare/watch features are not a committed product direction; the owner explicitly rejected vehicle comparison. Do not reintroduce compare buttons, counters, links or pages.

## Tests and local workflow

Run from repository root:

```powershell
node --test
git diff --check
```

Current suite files:

- `tests/history.test.cjs` — Worker read/write separation, provider request safety, history canonicalization, pagination and D1 behavior.
- `tests/product-feedback.test.cjs` — source field mappings, title/seller/condition/status semantics and product markup contracts.
- `tests/local-storage.test.cjs` — favorite persistence, exact links and hostile local-storage input handling.
- `tests/provider-independence.test.cjs` — canonical mapping parity for Apibara-shaped and fake Provider B payloads, adapter safety/errors and compatibility response shape.
- `tests/accounts-proof-of-fit.test.cjs` — mocked Supabase/JWKS, PKCE, encrypted cookies, identity verification, account/favorite API contract, CSRF, refresh/logout and in-memory additive migration. No live Supabase, production D1 or OAuth requests.
- `tests/fixtures/` — representative observed payload shapes and regression cases; do not add credentials or unredacted personal data.

Keep tests offline: fixtures/mocks must not call production Apibara or D1. Production requests and changes to Cloudflare require an explicit task and safety review.

### Apibara request budget (local code audit)

- Home loads each of its four category aisles only when near the viewport; each section makes one `/api/cars` call with `per_page=4`, and its filter-specific response is edge-cached for 60 seconds. A full scroll may therefore cause up to four distinct provider list calls; they cannot be merged without weakening category correctness because the provider accepts distinct filters, not a union query.
- Home/filter bootstrap makes one `/api/filters` request per metadata key; the edge cache is six hours and make/model narrowing is part of the key.
- Full catalog makes one provider list call per first page and one per user-requested cursor page. No page is auto-fetched by the catalog; exact query/cursor cache keys prevent cross-page reuse.
- A vehicle page makes one detail call. On an upstream definitive 404, the Worker may make one exact-search fallback; the browser no longer repeats that search via `/api/cars`. A successful detail response is locally configured for a 30-second edge cache.
- History opens with one 20-event page. `Załaduj starsze wydarzenia` makes exactly one call for the opaque next cursor. Exact URL/cursor pages use a five-minute edge cache; the browser response remains `no-store`.
- Auction refresh uses single-flight, only while the document is visible: live/within 5 minutes 30 seconds, within 1 hour 2 minutes, farther scheduled 10 minutes, and unknown/terminal schedule no polling. This reduction is deployed to staging only; production remains unchanged.
- Account bootstrap, login, favorites, merge, refresh and logout do not call Apibara. The user's account/favorite endpoints use Supabase and/or D1 only.
- No live Apibara calls were run after the budget warning in this continuation. Exact earlier upstream totals are unavailable because request counters were not recorded per browser action. Continue using fixture/mock tests; keep any live verification to one request per distinct unresolved question.

## Owner UX/product decisions

- Public product brand is `Rex.Bid` (visual mark: `REX` white + `.Bid` yellow). Legacy technical identifiers are documented in `docs/NAMING_CONVENTIONS.md`; avoid using them as visible branding.
- Rex.Bid is an independent product, not a copy of Bid.Cars or DreamBid.
- Prioritize correct source facts and compact information hierarchy over decorative status labels or oversized blocks.
- No fake prices, auction times, seller names, document certainty, trust scores, bidding ability or import-cost guarantees.
- No vehicle comparison feature. Favorites remain important.
- Do not change calculator rates without current, dated sources and owner approval of assumptions.
- Do not begin a large product module during a documentation-only or checkpoint task.

## Known constraints / risks

- Apibara is the only integrated real provider. The provider registry/canonical Rex.Bid contract are deployed; the structurally different Provider B remains a test double only and is not integrated.
- Current public compatibility data fields intentionally retain the response shape used by existing frontend pages. The active adapter owns that compatibility serialization; a future adapter must implement it or a separately versioned stable API DTO before replacing Apibara.
- Some history payloads have only `{date, price, status, lot_number, platform}` and no seller or stable event ID. Fallback identity and price interpretation therefore have limits; never invent missing values.
- Apibara availability/rate limits affect uncached reads. Do not add automatic retries or fan-out requests casually.
- `REXBID_SYNC_TOKEN` is required for the explicit sync POST; verify its Cloudflare configuration before scheduling or manually invoking synchronization.
- D1 migrations are checked-in SQL. Never apply a migration to production without verifying the target binding/database and reviewing the exact pending migration.
- Accounts Phase 2A BFF proof-of-fit is **DONE/PASS**. Accounts Phase 3 normal UI has earlier owner-confirmed staging real-browser login/account/session/cloud favorites/logout. Current hardening was deployed to staging version `916a2a0c-f5ad-4643-b886-927c8b2849c9`; GET smoke and render of login/reset/resend passed. Real recovery email/callback/password update/export download and cross-tab refresh remain **NOT VERIFIED**. Production auth is **NOT DEPLOYED** and `docs/proposals/0003_accounts_foundation.sql` is **NOT APPLIED** to production.
- Strict fee/tax calculations in `public/rexbid-calculator.js` remain unchanged; Calculator V2 now supplies partner land/sea values as configurable inputs when no manual override exists. The UI is guarded for staging and has not been deployed. Current auction fees, customs value, duty/VAT bases, excise classification, legal FX, port/import handling and Poland delivery still need sourced inputs before any complete landed-cost total can be shown.
- Apibara written factual-data permission is recorded in `docs/APIBARA_DATA_RIGHTS.md`; permanent archive of original Copart/IAA photos and separate vehicle-history report resale licensing remain gated.

## CURRENT WORK / CONTINUE HERE

### Calculator V2 — staging + przeglądarka (2026-09-30)

- **CODE VERIFIED:** importer partnera generuje 610 rekordów z danych źródłowych; route matrix, stawki USD, wybór najniższej kompletnej sumy land+sea, wariant standardowy 4 auta i ostrożny 3 auta są objęte testami.
- **AUTOMATED VERIFIED:** 259/259 testów PASS; `scripts/partner-transport-rates.cjs --check`, kontrole składni i `git diff --check` PASS.
- **STAGING VERIFIED:** wdrożono wyłącznie `rexbid-auth-test` z bindingiem `rexbid-auth-test-db`, Version ID `00b55a4e-9389-453b-8153-5621f3bc4c7b`. Dry-run i deploy wskazywały stagingową D1. Produkcja nie była wdrażana ani migrowana.
- **REAL BROWSER VERIFIED:** karta Copart LOT 97885965 wyrenderowała galerię (12 zdjęć), historię (20 pozycji), seller/title/condition, guest favorite oraz Calculator V2. Wykryto i naprawiono lokalizację przekazaną jako obiekt (`[object Object]`): silnik wybiera teraz wyłącznie jawne pola tekstowe i odczytuje ZIP/stany z obiektu lokalizacji; `auction.state=open` nie jest mylone ze stanem USA. Staging po redeployu pokazał `Long Island (NY)`, match `fallback_zip`, land $295, sea $575/$650, sumę $870/$945 USD. Pełna suma importu pozostaje niekompletna z powodu nieznanych opłat aukcyjnych, podatków/odprawy i transportu w Polsce.
- **DANE:** staging D1 read-only: 220 Copart listings, 220 sources, 220 snapshots, `users=1`, `user_favorites=1`; brak zapisów D1 w tym QA. Apibara: nie uruchamiano discovery; wejście na Home i pojedynczą kartę korzystało ze zwykłych publicznych odczytów — nie wykonywano dodatkowych żądań do wyszukania przykładów.
- **NOT VERIFIED:** mobilny viewport nie był dostępny w tej przeglądarce; exact/fallback/unmatched/ambiguous zostały zweryfikowane z pełną tabelą i fixture'ami automatycznymi, ale na żywo w UI potwierdzono tylko ZIP fallback. Konsoli przeglądarki nie dało się odczytać przez dostępne sterowanie; nie zaobserwowano błędu blokującego render.
- Nie commitowano ani nie pushowano. Zachowaj wszystkie lokalne zmiany. Następny krok: mobilna weryfikacja na prawdziwym viewport oraz decyzja, czy wdrażać Calculator V2 do produkcji; produkcyjna flaga nadal wyłączona.

1. Provider Independence is **DONE** and production-regression checked on Worker version `241cfe3e-663d-49c3-bd2b-b29e8f20cb80`, corresponding to owner-provided GitHub checkpoint `1d917d0`. Read-only GET checks passed for `/`, `/api/database`, all three `/api/cars` variants, `/api/filters`, exact IAAI/Copart VIN lookups, exact LOT lookup, auction history with a real next-cursor request, IAAI Timed Auction fields, and seller extraction.
2. D1 counts from `/api/database` were `vehicles=0`, `snapshots=0`, `auction_history=0` before and after these GET checks; no unexpected count change was observed. This only verifies the observed read-only regression run, not future sync operations.
3. No product code was changed during the regression run. This handoff file records the production checkpoint update.
4. Data Sync Foundation remains the next design step. Review `ARCHITECTURE.md` → “Data Sync Foundation” and `docs/proposals/0002_provider_sync_foundation.sql`. The SQL is a proposal outside Wrangler's migrations directory, tested only in in-memory SQLite after `0000`/`0001`, and has **not** been applied anywhere.
5. Do not add a schedule/queue yet. First approve provider-source identity, per-source freshness/lease, idempotent page checkpointing, D1-first rollout conditions, and API rate budget. GET stays read-only and explicit protected sync remains the persistence trigger.
6. Written Apibara factual-data rights are documented in `docs/APIBARA_DATA_RIGHTS.md`: storage/history/snapshots/derived and commercial display are permitted by the owner-reported response. Permanent archiving/redistribution of original Copart/IAA photos is not approved. This does not establish rights under independent auction-platform terms.
7. Calculator Phase 1 research and Phase 2 local implementation are documented in docs/CALCULATOR_MODEL.md. Copart covers only explicitly selected, evidenced secured Pre-Bid profiles/bands; IAA schedule, forwarder quotes, buyer profile and customs validation remain open. Required unknown values block a total.
8. Calculator engine/rate configuration are local and not released. Do not commit/deploy until the full test suite and review pass. Next, obtain IAA schedules, quotes and customs-agent validation before expanding confirmed rate coverage.
9. Calculator Phase 2 local checkpoint: dedicated browser/Node engine and versioned configuration are loaded by car.html. Copart covers only the confirmed secured + Pre-Bid profiles after explicit selection; IAA and missing logistics/tax inputs remain unknown. Missing required values are never zero; UI FX is separate from customs/excise FX. New independent calculator tests are included. No commit, push or deploy has occurred.
10. Continue by obtaining IAA US fee examples, dated shipper quotes, buyer-profile decision, customs-agent validation, and NBP FX adapter requirements. Do not add unsupported fee tiers or call an estimate an official amount.
11. **CURRENT WORK / CONTINUE HERE — D1 Sync 2 Phase A DONE; Phase B D1 VERIFIED; Phase C SHADOW VERIFIED; Phase D STAGING PERSISTENT DISCOVERY VERIFIED; Phase E STAGING D1 READ VERIFIED.** Phase D retained 20 accepted Copart listings, 20 sources and 20 initial snapshots. Phase E staging read-only GETs verified catalog (20 known rows), filters (15 known makes), exact stored listing detail and initial snapshot history. Incomplete catalog/filter coverage is explicit. Latest staging deployment is recorded at the top of this handoff. Public API/frontends and production remain unchanged. **Next:** design bounded scope completion/backfill and refresh budgets before considering Phase F; do not present the current single page as a full catalog.
12. **Phase D operational record:** staging runner `staging/phase-d-discovery.cjs` is guarded to one Copart discovery page (`per_page=20`) and a maximum campaign budget of five, with a one-page guard that prevents a second call. It persists canonical source/listing summaries, an initial listing snapshot, run progress and cursor checkpoint atomically, then replays only the captured page in-memory. The completed run consumed 1/5 requests; raw payloads/media/history were not fetched or retained. Keep the staging records; no cleanup was requested or performed. Production `mtbid` and `rexbid-db` remain untouched.

## Accounts readiness checkpoint — 2026-09-29

- **Staging:** wcześniejszy Auth proof-of-fit i Accounts Phase 3 mają owner-confirmed real-browser PASS dla loginu/konta/sesji/cloud favorites/logout. Bieżący kod wdrożono na `rexbid-auth-test`, Version ID `916a2a0c-f5ad-4643-b886-927c8b2849c9`; smoke GET `/api/auth/config`=200 enabled, `/api/me`=401 anonymous i strony kont=200. W przeglądarce potwierdzono widoki login/reset/resend bez wysyłania maila ani logowania.
- **Production:** Auth **NOT PRODUCTION DEPLOYED**; proposal `0003_accounts_foundation.sql` **NOT APPLIED** do `rexbid-db`. `AUTH_ENABLED`, canonical origin i rate-limit binding nie są obecne w produkcyjnym `wrangler.jsonc`; brak pełnej konfiguracji oznacza fail closed.
- Bieżący kod ma jawne `/api/auth/config`, exact canonical/allowed origin, `AUTH_ENABLED`, deklarację `AUTH_D1_SCHEMA_VERSION=0003` ustawianą po ręcznej weryfikacji schematu, staging-bypass ograniczony do test host/flag, `Sec-Fetch-Site` cross-site rejection oraz wymagany Cloudflare limiter w trybie produkcyjnym.
- Refresh: per-isolate single-flight po refresh tokenie; przy race/niejednoznacznym błędzie BFF sprawdza nadal ważny access token i nie czyści ważnego cookie. To nie jest globalna blokada między isolate/colo; szczegóły i ograniczenie są w `docs/ACCOUNT_PRODUCTION_READINESS.md`.
- Dodano neutralny recovery/resend z ogólnymi komunikatami, PKCE recovery callback prowadzący do ustawienia nowego hasła, aktualizację hasła z próbą globalnego revoke i JSON export własnego profilu/favorites. Powtórny signup nie potwierdza istnienia konta. Automated flow PASS; prawdziwe recovery/resend email, callback, password update/global revoke, export download i multi-tab concurrency wymagają kontrolowanego staging testu.
- Konto delete pozostaje gated (brak Supabase service-role i zatwierdzonego procesu). Google OAuth ma adapter PKCE, ale provider credentials/linking nie są skonfigurowane.
- Dane, retencja, SMTP, produkcyjny validator/checklista i owner configuration: `docs/ACCOUNT_PRODUCTION_READINESS.md`, `docs/ACCOUNT_DATA_PRIVACY.md`.

### CURRENT WORK / CONTINUE HERE

Następny krok: ukończyć full suite, syntax checks i `git -c core.whitespace=cr-at-eol diff --check`; bieżące zmiany wymagają staging deploy i kontrolowanego browser testu recovery/resend/export oraz współbieżnej sesji. Nie aktywować produkcji i nie stosować `0003` do `rexbid-db`. Właściciel musi przed produkcją zapewnić zatwierdzony Supabase production project, canonical origin/callback allowlist, cookie secret, zatwierdzoną i zweryfikowaną D1 0003, Cloudflare Rate Limiting binding/progi, SMTP oraz decyzje privacy/retention/deletion.

## Infrastruktura kontrolowanego launchu — staging zweryfikowany, production nietknięta (2026-09-29)

Kod infrastruktury został przetestowany (`215/215`, diff-check i składnia PASS) i wdrożony wyłącznie na staging Worker `rexbid-auth-test`, D1 `rexbid-auth-test-db`, Version ID `9ce6f2ab-b7f4-4ab2-b31d-663089bd1f0b`. Po końcowej korekcie `/health` i `/ready` zwracają 200; `/ready` potwierdza staging D1/assets/provider-config/Auth-config bez wywołania Apibara. `robots.txt` staging blokuje `/` i ma noindex, `sitemap.xml` zwraca 404/noindex, prywatne API ma `private, no-store`, bezpieczne 404 działa, a oba door-estimator JS bez flagi są 404.

`/health` nie sprawdza zależności. `/ready` sprawdza D1, statyczny asset, obecność konfiguracji providera oraz Auth tylko jeśli włączone — bez requestu Apibara i bez ujawniania sekretów. Produkcyjny Auth pozostaje fail-closed, `0003` nie jest zastosowane na produkcji, estimator door-to-door domyślnie jest usuwany z produkcyjnego HTML.

Rzeczywista weryfikacja wykryła Cloudflare asset-first: bez `assets.run_worker_first` istniejący statyczny asset mógł ominąć kodowy guard. Konfiguracje production i staging mają teraz selektywne Worker-first dla `/`, `/*.html`, `/robots.txt`, `/sitemap.xml` oraz dwóch door-estimator JS; pozostałe pliki statyczne nadal są obsługiwane bezpośrednio przez Assets. Staging config nie ma flagi `REXBID_DOOR_ESTIMATOR_PROTOTYPE`; jego wrapper wymusza noindex i blokuje staging sitemap.

### CURRENT WORK / CONTINUE HERE — infrastruktura launchu

Staging smoke po selektywnym routingu Worker-first zakończył się PASS na Version `9ce6f2ab-b7f4-4ab2-b31d-663089bd1f0b`: root i HTML przechodzą przez Worker, robots blokuje cały staging host, sitemap zwraca 404, prototype bundles zwracają 404, health/readiness i private API mają właściwe nagłówki. Nie wykonano browser GUI testu ani żadnego Apibara requestu. Nie deployuj `mtbid`, nie migruj `rexbid-db`, nie uruchamiaj Auth produkcyjnie i nie rozpoczynaj Phase D bez osobnej zgody. Najbliższe zależności: domena, SMTP, limiter, backup/restore, monitoring i dokumenty prawne.


## Calculator V3 — rozszerzenie modelu door-to-door (2026-09-30)

- Calculator V3 rozszerza V2, nie usuwa transportowego engine, rate parsera, strict tax/fee logic ani matcherów. `calculateV3` udostępnia transport estimate, import subtotal i door-to-door; kompletna suma jest tworzona wyłącznie, gdy jawne są wszystkie wymagane kwoty, podstawy i datowany kurs prezentacyjny. Brak nie jest zerem.
- Partner transport pozostaje USD i configurable; wersja rate set jest przenoszona do danych linii. Profile Copart mają jawny wybór i status configurable, bo nie potwierdzono profilu konta Rex.Bid; IAA pozostaje unknown. Import/port/broker/dostawa PL i kursy są admin-ready, ale bez wartości domyślnych.
- V3 jest odseparowany przez `REXBID_CALCULATOR_V3_ENABLED`: staging config włącza tę funkcję, a Worker dodatkowo wymaga dokładnego hostu `rexbid-auth-test.tedn828.workers.dev`; Worker usuwa V3 asset/advanced fields i odmawia bezpośredniego pobrania V3 rates bez flagi. Dotychczasowy strict calculator pozostaje zachowaniem domyślnym.
- **CODE VERIFIED / AUTOMATED VERIFIED:** testy V3 sprawdzają profiles, unknown-vs-zero, tax bases, osobne FX, transport wariantów, pełny/niepełny stan i staging gate. **STAGING NOT DEPLOYED / REAL BROWSER NOT VERIFIED** w tym etapie. **Apibara requests = 0; produkcja nietknięta.**
- Szczegółowe założenia, urzędowe źródła i przykładowe subtotal w `docs/DOOR_TO_DOOR_COST_MODEL.md`; konfiguracja i aktualizacja stawek w `docs/TRANSPORT_RATE_MODEL.md`. Koszt pod dom nie jest jeszcze dostępny bez potwierdzonego profilu aukcji, wartości customs/VAT/excise, kursów i kosztów importowych/dostawy.

### Calculator V3 — końcowa weryfikacja stagingowa (2026-09-30)

- **CODE VERIFIED / AUTOMATED VERIFIED:** 268/268 testów, generator stawek `--check`, składnia modułów i `git diff --check` PASS. Generator potwierdza 610 lokalizacji oraz stawki morskie 1–4 auta w USD.
- **STAGING VERIFIED:** dry-run i deploy wskazywały wyłącznie Worker `rexbid-auth-test` oraz D1 `rexbid-auth-test-db`; końcowy Version ID `c34f0aa5-eefb-43be-85ea-6cd4ee161868`. Flaga V3 jest w staging config; Worker wymaga także dokładnego staging hosta. Konfiguracja produkcyjna nie ma flag V2/V3, a test potwierdza, że sama flaga na hoście produkcyjnym nie aktywuje V3.
- **REAL BROWSER DESKTOP VERIFIED:** istniejąca karta Copart LOT `97885965` / VIN `1N4AA6CV7LC367904`; render auta, 12 zdjęć, historia 20 zdarzeń, dane/title/seller/damage/Run & Drive/keys, lokalny favorite i widoczny panel V3. Partner match `fallback_zip`: ląd 295 USD, standard 4 auta: morze 575 USD, razem 870 USD; ostrożny 3 auta: morze 650 USD, razem 945 USD. Route ID nie jest wyświetlany. Brak JS errors w dostępnych logach konsoli.
- **REAL BROWSER MOBILE VERIFIED:** viewport 390×844; szerokość dokumentu 375 px, panel 355 px, bez poziomego przewijania/overflowu; szczegóły zamykają się i ponownie rozwijają.
- Stany A–D pozostały niekompletne przy brakach; stan E po jawnie wprowadzonych syntetycznych wartościach QA pokazał wyłącznie orientacyjny total 48 706 PLN standard / 48 987,25 PLN ostrożnie. Wartości testowe wyczyszczono; to nie jest oferta ani podatkowa wycena. Formularz wrócił do `Kalkulacja niepełna`.
- Naprawiono Worker-first dla extensionless `/car` (wymagany przez realne linki), dodano widoczne podsumowanie V3 poza zwiniętym kalkulatorem ścisłym i doprecyzowano źródło opłat: `Publiczna tabela Copart — profil konta Rex.Bid do potwierdzenia`.
- IAAI na realnej karcie nie zweryfikowano; automatycznie pozostaje `unknown` bez kwoty. W tej sesji nie logowano się, więc cloud favorites/Auth nie były ponownie testowane; wcześniejszy stagingowy login/konto/favorites pozostaje osobnym wynikiem. Podatki, kursy, port/broker i dostawa PL nadal wymagają rzeczywistych potwierdzonych danych.
- **APIBARA:** brak ręcznie wywołanych endpointów Apibara, discovery i backfill. Zwykłe załadowanie istniejącej karty jest provider-backed; przejścia/odświeżenia mogły wygenerować detail/history reads, ale dokładnej liczby upstream nie instrumentowano. Nie deklarować `0` całkowitych provider reads.
- **PRODUCTION:** `mtbid`, `rexbid-db` i migracje produkcyjne nietknięte; brak produkcyjnego deployu oraz brak commit/push.
