# D1 Sync 2 — Phase G staging cutover gates

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
