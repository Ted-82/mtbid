# D1 Sync 2 — Phase G staging cutover gates

## Aktualizacja stanu katalogu — 2026-10-03

Późniejszy Product Milestone staging readback zastępuje starsze county poniżej: 260 Copart + 120 IAAI listing/source rows, 380 observed snapshots, 0 confirmed events/entities; media URL/thumb refs na 80 listingach (40/platform), oba niezależne scope partial z cursorami, users/favorites 1/1. To znany testowy podzbiór, nie pełny katalog. Produkcja pozostaje provider-backed.

Backup rehearsal staging export → disposable in-memory SQLite i count validation PASS; remote D1 restore nie został sprawdzony. Scheduled sync/Cron nie jest aktywny.

## Staging product milestone prep — 2026-10-01

- Offline code now maps catalog text search (VIN/LOT/title/make/model) and supported advanced filter parameters into the D1 repository. Tests require D1-only list requests not to call the provider; partial metadata remains known-rows-only.
- Media URL support requires the staging-only additive migration `migrations-staging/0005_listing_media_urls.sql` before deploying the updated writer. It stores validated HTTPS URL references only; no raw payload or binary media.
- Product-milestone backfill cap: 20 requests total, 10 per platform, maximum 4 pages per run at page size 20, retries disabled. A durable shared budget reservation and independent platform reservations protect the global cap under concurrent runners.
- **Local/offline preparation only:** 290/290 tests, syntax, config validator, rate generator and diff-check pass. Elevated staging dry-run PASS, with only the staging D1 and assets bindings. No migration/deploy or Apibara request occurred because Wrangler authentication expired. Last historical counts remain Copart 220 / IAAI 80, both partial; direct readback is required before any live run.
- After reauthentication: confirm exact staging account/config/binding, apply only staging 0005, dry-run and deploy only `wrangler.staging.jsonc`, verify D1 schema and counters, then use the authenticated staging panel. Do not start the panel before migration and deployed version are verified.

## Controlled partial staging mode addendum — 2026-10-01

The older gate text below describes a full-catalog cutover and remains the production/full-catalog gate. This addendum authorizes a **staging-only, explicitly partial** public API experiment: partial scopes may serve only known D1 listing rows and known-row filter values when every response says `catalog_complete=false` / `metadata_complete=false`; it must never advertise a full inventory or market-complete filters.

The wrapper is enabled only by all of: HTTPS, exact host `rexbid-auth-test.tedn828.workers.dev`, staging UI and host flags, D1 target `rexbid-auth-test-db`, and `REXBID_D1_PRIMARY_READS=true`. Production does not import the wrapper and production config has no true flag. Both Copart and IAAI coverage are reported even if the request filters to one platform.

### Per-route behavior

- `/api/cars` and `/api/filters`: D1 only, known rows only, with explicit global/platform partial metadata; no provider calls for these partial reads.
- `/api/car/:identifier`: unique and fresh D1 listing is returned directly. Missing/ambiguous/incomplete/stale record delegates to the existing provider-backed route; stale D1 may be merged with provider response as `hybrid`, preserving known values against null/empty provider fields.
- `/api/car/:identifier/history`: fresh D1 observed snapshots and confirmed events are distinct fields/kinds. Stale or missing history delegates to provider. A snapshot is never represented as a sale event.
- Logs include route template, read source, D1 hit/miss, freshness, fallback reason, cache mode and duration, with no VIN or account identifiers. Responses are `private, no-store` during validation.

### Rollback

Set `REXBID_D1_PRIMARY_READS=false` in `wrangler.staging.jsonc` and redeploy only with that config after confirming its Worker/D1 target. This bypasses the staging wrapper and restores the original provider-backed route without deleting D1. The flag-off delegation is covered offline; an online provider-backed smoke would make a provider request and is deliberately avoided unless separately approved. Restore the D1-first experiment by setting the flag to `true` and redeploying staging.

### Current assessment

Starting readback is 220 Copart + 80 IAAI listings, both partial with independent cursors. This is enough for known-record staging integration tests, not full-catalog representation. Staging deployment and read verification must be reported separately from offline tests. Production remains provider-backed until the original complete-catalog gates below and production operational gates are met.

Status: **PARTIAL STAGING CUTOVER VERIFIED; PRODUCTION NOT ACTIVATED**. Production `mtbid` / `rexbid-db` remain on the current provider-backed path.

## Preconditions

1. Both Copart and IAAI discovery scopes have been read directly from the intended D1; scope keys, cursors, leases, runs and page commits are independent.
2. Every platform exposed as a complete catalog has `status=complete`, `cursor IS NULL`, and a valid `last_complete_at`. `partial`, `failed`, `stale`, missing, or unknown scopes never qualify as full coverage.
3. Listing/source identity and uniqueness checks pass independently per platform. No cross-platform merge by VIN; `vehicle_entities` requires trusted reconciliation.
4. Direct D1 readback validates list, detail, snapshot-only history and filters for each platform. Initial observed snapshots are not auction events or proof of sale/price-change history.
5. Missing/partial provider fields remain unknown and do not erase prior known values. No false zeroes, invented counts or fabricated filters.
6. Request caps, budget reservations, lease recovery, cursor replay, page atomicity and no-retry behavior pass offline tests and the bounded staging validation.
7. Accounts rows remain unchanged; no raw payload or binary photo archive is introduced.
8. The switch is guarded by exact staging host, staging D1 target and explicit staging-only configuration. Production config must not enable the switch, even if a flag is copied accidentally.

## Read-source behavior

- Default: current provider-backed public API, unchanged.
- D1 catalog and filters may be primary only when all included platform scopes are complete and within the configured freshness limit. Responses must include source and completeness metadata; partial data must be explicitly presented as partial if a separately approved diagnostic mode is used.
- A stored listing detail may be served from D1 without requiring a vehicle entity. A stale or incomplete detail may use provider fallback only through a bounded, explicit policy; never perform provider calls automatically for every page view.
- History distinguishes observed snapshots from confirmed auction events. A snapshot-only response must say so.
- Freshness metadata includes scope/record freshness and last successful synchronization. Stale D1 can be retained on provider outage, but must not be called fresh.
- Structured logs use `read_source=d1|provider|hybrid`, cache result, freshness class and safe fallback reason; no VIN, credentials, cookie or full request body.

## Rollback

The staging switch defaults OFF. Rollback is to set the staging-only D1-read flag OFF and redeploy `rexbid-auth-test`; no data deletion is needed to restore provider-backed reads. Never change production config or bindings as part of staging rollback.

## Current gate result (2026-10-01)

- Offline multi-platform runner/tests and staging deployment are verified. Staging Version `dcfc17fa-fc43-4234-b450-335e8d0b7c03` targets only `rexbid-auth-test-db` ID `acb3cb8e-69a2-459f-8a46-0f2f5b9004be`.
- Direct staging D1 readback: 220 Copart sources/listings/snapshots, partial scope/cursor, 11 commits; IAAI has 0 listings and no scope; events/entities 0; Accounts 1/1; legacy 0/0/0; no duplicate keys. Existing prior campaign budget 8/10 is unchanged; this continuation's campaign budget is **0/12** with no reservation.
- Browser session is Anonymous, so the authenticated IAAI run has not been started. No live Apibara request was made. Phase G public API cutover is not ready: coverage is partial and IAAI is absent. After owner login, run the bounded IAAI action first and read back D1 before any Copart resume.
- No staging public API cutover, production cutover, Cron, Queue or backfill was activated in this work.

## Latest partial staging cutover result — 2026-10-01

This result supersedes the earlier status/count notes above for the current checkpoint. The older notes remain as historical records of prior runs.

- Final staging Worker `rexbid-auth-test`: Version `a6569e87-47be-4039-af7c-cd36374afdde`; D1 only `rexbid-auth-test-db` (`acb3cb8e-69a2-459f-8a46-0f2f5b9004be`); `REXBID_D1_PRIMARY_READS=true` restored after rollback validation.
- Starting D1 remains 220 Copart + 80 IAAI sources/listings/snapshots, both partial with separate cursors. The 300 listings are only known rows. Events/entities 0; users/favorites 1/1; legacy 0/0/0.
- D1-first HTTP 200 verified for list, filters, IAAI detail, and fresh IAAI snapshot history. Partial completeness metadata is present. One Copart stale detail used hybrid fallback (`d1_detail_stale`). Rollback flag OFF restored the original provider-backed `/api/cars` response and was reverted ON afterward. Two provider-backed reads total; no discovery/backfill.
- Approximate external latency: list/filter/detail/history 470–1,100 ms; stale hybrid detail 728 ms. Worker-side D1 operation durations were ~0–2 ms, hybrid ~237 ms. Small smoke sample only.
- Browser verified Home/catalog and IAAI detail with the partial badge; no visual error was present. DevTools console/network panels were unavailable to the current browser-control surface.
- **Recommendation:** ready for extended staging D1-first testing over known partial rows. The production/full-catalog gate remains closed until coverage and production operational requirements are met.
- Automated: **285/285 PASS**, CJS syntax checks pass, partner generator check passes, staging Wrangler dry-run passes, and `git -c core.whitespace=cr-at-eol diff --check` passes.
# Product Milestone staging addendum — final media QA 2026-10-01

Latest staging deployment: `rexbid-auth-test` Version `4ed7d98b-7ab9-41db-9f15-3f1e463b45dc`, bound only to `rexbid-auth-test-db` ID `acb3cb8e-69a2-459f-8a46-0f2f5b9004be`. Staging migration 0005 is applied there only. Production remains on its existing provider-backed configuration.

The real-browser “Aktualne” empty-state defect was caused by filtering `source_status` (which is date-shaped in stored rows) as though it were the canonical auction status. The staging D1 adapter now maps `lot_sub_status` only to `auction_state`. Regression test and real UI verification pass; 20 known open rows are shown without claiming complete market coverage.

Latest direct readback: Copart 260 and IAAI 120 listings/sources, 380 snapshots, 0 events/entities, users/favorites 1/1, 0 duplicate source identities. Both scopes remain partial with cursors. URL/thumb fields are populated for 40 listings per platform (80 total); 300 older rows remain without URLs and were not enriched in this pass. No discovery/backfill/media-enrichment calls were initiated during final QA. Original binary images remain unarchived.

Media path verified on fresh D1 records in the real browser. Initial Copart gallery showed 26 entries for 13 full URLs + 13 matching thumbs, exposing that the previous gallery normalizer treated thumbnail renditions as additional images. IAAI gallery showed 17 entries because its imageKeys permit deduplication. A shared normalizer now pairs URL/thumb arrays; its behavioral test passes, and post-fix staging verification is pending. Diagnostic `rawOrMediaStored=false` was ambiguous: it meant no raw provider payload or binary image storage, not absence of media URL references. The local runner now reports raw payload, binary media, and stored URL counters separately. Raw discovery bodies are not retained, so the exact historical body for each record cannot be inspected.

NOT VERIFIED: desktop browser viewport, browser console/Network inspection and exact provider fallback-call count. A catalog listing card showed a vehicle image in the narrow mobile-style viewport; no broken thumbnail was observed. The older 300 rows with no URL references need separately bounded enrichment only if broader gallery coverage is an accepted goal. Production remains untouched. `node --test` passes 294/294; partner generator/config validator/syntax/diff checks pass. No discovery/backfill was run in this pass; browser-triggered fallback count was not instrumented.

## Final Product Milestone gallery QA — 2026-10-01 (supersedes pending status above)

Final staging deployment: `rexbid-auth-test` Version `d86cef66-7683-42d6-8c75-32566f828a81`; D1 only `rexbid-auth-test-db` (`acb3cb8e-69a2-459f-8a46-0f2f5b9004be`). Production `mtbid`/`rexbid-db` unchanged.

Read-only D1 state: 260 Copart + 120 IAAI listings/sources; 380 snapshots; events/entities 0; media URL and thumb arrays on 80 listings total (40 per platform); duplicate provider IDs 0; Accounts rows 1/1. Both scopes remain partial and results mean known rows only. 300 rows without media refs were not enriched.

Real browser: Copart LOT 73650295 has 13 images after pairing full/thumb variants; IAAI LOT 44803631 has 17. Home/catalog images load from known D1 rows; IAAI navigation/lightbox and temporary guest favorite add/remove pass. Desktop 1350×900 and mobile 375px show no horizontal overflow. Calculator V3 keeps missing charges incomplete. Timed Auction is empty in this bounded sample. Authenticated cloud favorites were not retested.

No discovery/backfill/detail-enrichment request was intentionally made (0 Apibara requests this pass). Exact automatic fallback count and DevTools console/Network remain NOT VERIFIED. `node --test` 299/299, rates generator/config validator/syntax/diff checks PASS. No production deploy or migration.
# Final staging product review — 2026-10-03

- D1-first remains staging-only on `rexbid-auth-test` / `rexbid-auth-test-db`. Latest Worker Version `6c70674f-c164-404f-afc0-b1984ffe5549`.
- Current staging data: 260 Copart + 120 IAAI known listings/sources; 380 snapshots; 80 rows with media URL/thumb metadata; 0 events/entities; both scopes partial and independently cursor-backed. This is not a complete catalog and filters are known-metadata only.
- Browser review confirmed Home/catalog exact VIN and LOT results, Copart/IAAI known detail, gallery/history and D1-backed images. History may use guarded provider fallback; exact fallback count is not instrumented/verified. Do not claim zero provider reads across full browser navigation.
- No discovery/backfill or scheduled sync in this review. Cron remains disabled. Production API remains provider-backed; no `mtbid` deploy or production migration occurred.
- Before production D1-first: broader validated population and completeness strategy, remote D1 restore rehearsal, query/load review, exact fallback observability/budget alerts, schema migration approval, production rollback switch, and owner approval. Partial scope must never advertise complete counts/filters.
