# D1 Sync 2 — Phase G staging cutover gates

Status: **NOT ACTIVATED**. This document is a checklist for a separately approved staging-only public API cutover. Production `mtbid` / `rexbid-db` remain on the current provider-backed path.

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
