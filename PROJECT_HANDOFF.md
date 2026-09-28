# Rex.Bid — Project Handoff

## Purpose

Rex.Bid is a Polish-language vehicle-auction discovery and research product for Copart and IAAI inventory. It helps buyers find a vehicle, inspect its auction listing and media, understand the source-reported condition and title data, review auction history, and estimate import costs. Rex.Bid presents source data; it does not place bids or guarantee that a vehicle can be registered in Poland.

## Repository and production checkpoint

- Repository: [Ted-82/mtbid](https://github.com/Ted-82/mtbid)
- Branch: `main`
- Owner-confirmed GitHub checkpoint: `1d917d0` (Provider Independence)
- Owner-confirmed deployed Worker Version ID: `241cfe3e-663d-49c3-bd2b-b29e8f20cb80`
- Local Git base when provider-independence work began: `80128cc` (`Document Rex.Bid architecture and production roadmap`)
- Provider Independence is deployed and production-regression checked at the version above; mark this architecture checkpoint **DONE**.
- Worker: `mtbid`
- Production URL: <https://mtbid.tedn828.workers.dev>
- Wrangler configuration file: `wrangler.jsonc`
- Cloudflare D1 binding: `REXBID_DB` → `rexbid-db` (`971879fe-04ed-4e8c-9dc6-5306980bb872`)
- Static asset binding: `ASSETS` → `./public`
- Current local checkout: `C:/Users/nowic/Desktop/stona_auta-www`, branch `main`; provider-independence work began from `80128cc` with clean working tree. The preceding docs claim `b25c452` as production checkpoint, not current Git HEAD.

The production checkpoint and owner acceptance above are supplied by the owner. Do not infer that a local edit is deployed until a later deploy confirms it.

## Product and technical overview

The Cloudflare Worker in `worker.js` serves the JSON API and static assets. The browser calls same-origin `/api/...` routes. The current upstream provider is Apibara. Wrangler binds the application D1 database as `REXBID_DB`.

Provider access has an adapter boundary in `providers/apibara.js`; it owns approved upstream operations, URL construction, the `X-API-Key` header from only `env.APIBARA_API_KEY`, timeout, manual redirects, safe transport errors, and Apibara-to-Rex normalization. `providers/contract.js` defines the canonical entities and provider registry. The Worker uses the registry and D1 persistence remains outside the adapter. This provider-independence refactor is deployed in Worker version `241cfe3e-663d-49c3-bd2b-b29e8f20cb80` (GitHub checkpoint `1d917d0`). Never print, copy, fixture, or commit secret values.

### Worker API routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/cars` | GET | Paginated listing/search; adapter-owned upstream filters; public `data`/`meta` response preserved for the current frontend. |
| `/api/car/:identifier` | GET | Vehicle detail by VIN or LOT. Direct lookup and fallback search both require an exact VIN/LOT match; never select the first approximate result. May include a D1 history summary via SELECT. |
| `/api/car/:identifier/history` | GET | Paginated Rex.Bid history events. Accepts `per_page` (adapter bounded, currently 20) and opaque `cursor`; response is no-store and separates `history`, `meta.next_cursor`, local `rex_history`, and snapshots. |
| `/api/filters` | GET | Proxies normalized filter metadata through the adapter, with a six-hour cache and optional source-supported narrowing. |
| `/api/database` | GET | D1 availability and row counts; read-only. |
| `/api/sync/vehicle/:identifier` | POST | Explicit persistence operation; requires a valid `Authorization: Bearer …` token from `REXBID_SYNC_TOKEN`. It is not a GET and is not a public browsing route. Confirm the secret is configured before relying on it operationally. |

Unknown non-API paths are served through `ASSETS`. Non-GET requests to normal API routes are rejected; OPTIONS supports CORS preflight.

### Current public assets

`wrangler.jsonc` publishes `public/`. The current public pages are:

- `public/index.html` — Home/discovery sections and full catalog view (`?catalog=1`), search, filters, URL state and load-more pagination.
- `public/car.html` — vehicle detail, gallery/media, auction module, details, history and import-cost estimate.
- `public/ulubione.html` — local favorites/watchlist.
- `public/konto.html`, `public/logowanie.html`, `public/rejestracja.html` — account-related UI. Supabase BFF proof-of-fit has passed a live E2E on isolated staging; the normal public account pages are not connected and production auth is not deployed.
- `public/jak-to-dziala.html`, `public/kontakt.html`, `public/o-nas.html` — informational pages.
- `public/rexbid-storage.js` — shared versioned local favorites store, including one-time legacy-key migration and cleanup of retired compare state while preserving favorites. Compare UI/product is removed per owner direction; do not restore it without a new owner decision.
- `public/rexbid-brand.css`, `public/rexbid-mobile-nav.js` — shared visual brand and mobile navigation.

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

## Owner UX/product decisions

- Product branding is `REX` white + `.Bid` yellow; “MTBid” is legacy technical naming only, not visible brand.
- Rex.Bid is an independent product, not a copy of Bid.Cars or DreamBid.
- Prioritize correct source facts and compact information hierarchy over decorative status labels or oversized blocks.
- No fake prices, auction times, seller names, document certainty, trust scores, bidding ability or import-cost guarantees.
- No vehicle comparison feature. Favorites remain important.
- Do not change calculator rates without current, dated sources and owner approval of assumptions.
- Do not begin a large product module during a documentation-only or checkpoint task.

## Known constraints / risks

- Apibara is the only real provider adapter. A provider registry, canonical Rex.Bid contract, and Provider B test double now exist locally; Provider B is not integrated and these changes are not deployed.
- Current public compatibility data fields intentionally retain the response shape used by existing frontend pages. The active adapter owns that compatibility serialization; a future adapter must implement it or a separately versioned stable API DTO before replacing Apibara.
- Some history payloads have only `{date, price, status, lot_number, platform}` and no seller or stable event ID. Fallback identity and price interpretation therefore have limits; never invent missing values.
- Apibara availability/rate limits affect uncached reads. Do not add automatic retries or fan-out requests casually.
- `REXBID_SYNC_TOKEN` is required for the explicit sync POST; verify its Cloudflare configuration before scheduling or manually invoking synchronization.
- D1 migrations are checked-in SQL. Never apply a migration to production without verifying the target binding/database and reviewing the exact pending migration.
- Accounts proof-of-fit is **DONE on staging only**. Worker `rexbid-auth-test` uses isolated D1 `rexbid-auth-test-db`; real verified-user login, HttpOnly session cookie, Rex identity mapping, favorite add/list/idempotency/delete/merge, refresh and logout passed owner-run E2E. Last verified staging D1 state: 1 mapped user and 1 test favorite (`lot:copart:99999999`); read-only counts query reported `rows_written=0`. Production auth is **NOT DEPLOYED**, normal public account pages are not wired, and `docs/proposals/0003_accounts_foundation.sql` is **NOT APPLIED** to production. Add production rate limiting, handle concurrent refresh rotation, confirm final-domain cookie settings/privacy/retention, and review account deletion/export before launch.
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
11. **CURRENT WORK / CONTINUE HERE — Accounts Phase 2A DONE, Phase 3 NOT STARTED.** The live staging E2E passed against Supabase project in Frankfurt and isolated Worker `rexbid-auth-test` / D1 `rexbid-auth-test-db`: existing confirmed account login returned HTTP 200, identity was verified and mapped, HttpOnly session cookie was set, favorite add/list/idempotency/delete/merge passed, refresh retained favorites, and logout cleared session access. After logout, `/api/me/favorites` required login. Read-only staging D1 check showed `users=1`, `user_favorites=1` (the retained fake LOT test row); the count query wrote zero rows. Production `mtbid` and `rexbid-db` were not touched. Production auth is NOT DEPLOYED; `0003_accounts_foundation.sql` is NOT APPLIED in production. The staging-only E2E page is `https://rexbid-auth-test.tedn828.workers.dev/auth-test.html`; do not link it from product pages. Next planned work, only after a separately scoped task: Accounts Phase 3 to connect normal registration/login/account pages to BFF routes, migrate guest favorites idempotently, and handle stale private UI after logout/401. Before production, review rate limits, refresh-token concurrency, final-domain cookie scope, privacy/retention, account recovery/deletion/export and a migration plan. The PKCE callback carries only the one-use authorization code in the URL; it is exchanged server-side, and auth tokens/credentials must never be logged or returned to page JS.
