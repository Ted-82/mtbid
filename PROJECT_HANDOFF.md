# Rex.Bid — Project Handoff

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

- Product branding is `REX` white + `.Bid` yellow; “MTBid” is legacy technical naming only, not visible brand.
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
- The existing `public/car.html` calculator math/defaults remain illustrative and unchanged. Current auction fees, transport/freight, customs value, duty, VAT base, excise classification and legal FX need dated/versioned inputs before the result is marketed as a current landed cost.
- Rights to store, retain, derive from, or resell Apibara/history/report data need contract/licensing confirmation.

## CURRENT WORK / CONTINUE HERE

1. Provider Independence is **DONE** and production-regression checked on Worker version `241cfe3e-663d-49c3-bd2b-b29e8f20cb80`, corresponding to owner-provided GitHub checkpoint `1d917d0`. Read-only GET checks passed for `/`, `/api/database`, all three `/api/cars` variants, `/api/filters`, exact IAAI/Copart VIN lookups, exact LOT lookup, auction history with a real next-cursor request, IAAI Timed Auction fields, and seller extraction.
2. D1 counts from `/api/database` were `vehicles=0`, `snapshots=0`, `auction_history=0` before and after these GET checks; no unexpected count change was observed. This only verifies the observed read-only regression run, not future sync operations.
3. No product code was changed during the regression run. This handoff file records the production checkpoint update.
4. Data Sync Foundation remains the next design step. Review `ARCHITECTURE.md` → “Data Sync Foundation” and `docs/proposals/0002_provider_sync_foundation.sql`. The SQL is a proposal outside Wrangler's migrations directory, tested only in in-memory SQLite after `0000`/`0001`, and has **not** been applied anywhere.
5. Do not add a schedule/queue yet. First approve provider-source identity, per-source freshness/lease, idempotent page checkpointing, D1-first rollout conditions, and API rate budget. GET stays read-only and explicit protected sync remains the persistence trigger.
6. Written provider data-rights confirmation remains a blocker before expanding durable storage, backfilling history, or retaining additional photos/raw payloads. The proposal adds no raw payload/media copies and does not modify existing PKs or rows.
7. Calculator Phase 1 research and Phase 2 local implementation are documented in docs/CALCULATOR_MODEL.md. Copart covers only explicitly selected, evidenced secured Pre-Bid profiles/bands; IAA schedule, forwarder quotes, buyer profile and customs validation remain open. Required unknown values block a total.
8. Calculator engine/rate configuration are local and not released. Do not commit/deploy until the full test suite and review pass. Next, obtain IAA schedules, quotes and customs-agent validation before expanding confirmed rate coverage.
9. Calculator Phase 2 local checkpoint: dedicated browser/Node engine and versioned configuration are loaded by car.html. Copart covers only the confirmed secured + Pre-Bid profiles after explicit selection; IAA and missing logistics/tax inputs remain unknown. Missing required values are never zero; UI FX is separate from customs/excise FX. New independent calculator tests are included. No commit, push or deploy has occurred.
10. Continue by obtaining IAA US fee examples, dated shipper quotes, buyer-profile decision, customs-agent validation, and NBP FX adapter requirements. Do not add unsupported fee tiers or call an estimate an official amount.
11. **CURRENT WORK / CONTINUE HERE — D1 Sync 2 Phase A DONE; Phase B D1 VERIFIED; Phase C SHADOW VERIFIED; Phase D NOT STARTED.** Proposal `docs/proposals/0004_d1_sync_2.sql` is applied only to staging D1 `rexbid-auth-test-db` (`acb3cb8e-69a2-459f-8a46-0f2f5b9004be`); production `rexbid-db` has not been migrated. Phase C request `e62bf910-74b3-4386-a7ab-4a01be9fef6e` returned HTTP 200, `stage=complete`, with exactly one Apibara request: one Copart discovery page, 20 provider records, 20 canonical accepted, 0 rejected/ambiguous. Real D1 readback, replay/idempotency, Fake Provider B, partial update, failure recovery and budget checks passed. No detail/history/media/raw payload was fetched or persisted. Tail recorded `cleanup=true`; the UI’s `cleanup: undefined` was a property-name mismatch (`cleanupPass` vs `verified`), not a cleanup failure. Direct D1 SELECT after cleanup confirmed all 11 Sync tables at 0 rows, `users=1`, `user_favorites=1`, legacy `vehicles=0`, `vehicle_snapshots=0`, `auction_history=0`. The temporary Phase C endpoint/button/flag have been removed from the staging wrapper; clean redeploy Version ID is `c3137145-5d14-4cb6-b888-51c092b25938`. `sync/d1-repository.js` remains unconnected to Worker/API; public `/api/cars`, Home, car page and Accounts did not read shadow data. Production `mtbid`/`rexbid-db`, production migration, commit and push remain untouched. Written provider rights/retention confirmation is still required before durable discovery or rollout. Do not start Phase D.

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
