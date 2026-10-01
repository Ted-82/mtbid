# Rex.Bid Production Roadmap

## Latest multi-platform staging readback — 2026-10-01

- Staging `rexbid-auth-test` Version `5c887ebe-9477-47d1-92b6-5e36f638d40d` remains bound exclusively to `rexbid-auth-test-db`. No production deployment or Apibara call occurred in this readback.
- Read-only D1: Copart 220 listings/sources/snapshots; IAAI 80/80/80; duplicates 0; events/entities 0; users/favorites 1/1; legacy tables 0. Independent Copart/IAAI scopes are both partial and both have cursors; commits 11 and 4 respectively.
- IAAI `last_success_at` is populated while `last_complete_at` is null, which is correct for successful committed pages in a partial scope. Current campaign budget 4/12, IAAI 4/6, reservations/retries 0. Phase G API cutover is still OFF.
- **Next:** checkpoint this state, then resume IAAI at most 2 pages; verify D1 before any Copart resume. Full offline suite **277/277 PASS**; syntax and diff checks pass.

## D1 Sync multi-platform staging — 2026-10-01

- **CODE / AUTOMATED VERIFIED; staging runner deployed (Version `dcfc17fa-fc43-4234-b450-335e8d0b7c03`); IAAI live run NOT VERIFIED.** Shared manual runner supports independent Copart and IAAI scopes; no production API cutover or scheduled sync is enabled.
- New campaign is hard-limited to 12 calls total, at most 6 per platform; each click handles at most 2 pages; retries are disabled. This continuation has used 0 live Apibara requests. Prior Copart budget 8/10 remains historical and unchanged.
- Fresh direct staging readback: Copart 220 listings/sources/snapshots, partial with cursor and 11 page commits; IAAI 0 and scope not started; no duplicate listing/source keys; events/entities 0; accounts 1/1; legacy tables 0. New campaign budget is 0/12; prior Copart campaign budget remains 8/10. No live request was issued.
- Browser session is anonymous, so the protected IAAI action requires the owner to sign in to the existing test account and click once. Production Worker/D1 remain untouched.
- Before Phase G public API cutover, verify both platform reads and completeness explicitly. A partial or stale scope cannot be represented as a complete catalog; see `docs/D1_PHASE_G_CUTOVER.md`.

## Aktualizacja: robocze stawki transportowe partnera (2026-09-30)

- Właściciel potwierdził, że przekazane tabele partnera/importera są autorytatywnym roboczym źródłem stawek transportowych Rex.Bid do czasu ich aktualizacji. Wcześniejsze publiczne estymacje i benchmarki transportu są **superseded** i nie są źródłem cen produktu.
- Źródłowe tabele są zaimportowane przez `scripts/partner-transport-rates.cjs`: 610 lądowych rekordów oraz 4 poziomy frachtu 40'HC. Obie tabele zawierają `$`; rate set jest USD. `effective_from` i route-to-port mapping pozostają niepodane.
- Pipeline i audit są w `docs/TRANSPORT_RATE_MODEL.md`; generated rates są oddzielone od engine. Expected=4 auta, conservative=3; warianty wybierają niezależnie najniższą kompletną sumę land+sea, a ambiguous matches nie są rozstrzygane automatycznie.
- Staging/local fundament Calculator V2 jest zaimplementowany i łączy transport partnera ze strict calculator bez zmian jego tax/excise rules. Najnowszy staging deploy i QA opisano niżej; produkcja pozostaje bez zmian. Pełny koszt pozostaje incomplete do uzupełnienia aukcyjnych/importowych fees, customs/tax evidence, FX i PL delivery.

## Calculator V2 — QA stagingu 2026-09-30

- **CODE VERIFIED / AUTOMATED VERIFIED:** 610 rekordów partnera generowanych deterministycznie; pełny test suite 259/259 PASS, importer `--check`, składnia i diff-check PASS.
- **STAGING VERIFIED:** Calculator V2 wdrożony tylko na `rexbid-auth-test` (`rexbid-auth-test-db`), Version ID `00b55a4e-9389-453b-8153-5621f3bc4c7b`. Produkcja i produkcyjna D1 nietknięte.
- **REAL BROWSER VERIFIED:** karta Copart LOT 97885965, galeria, historia, seller/title/condition i lokalny favorite działają. Po wykryciu `[object Object]` poprawiono bezpieczne rozpakowanie obiektu lokalizacji; ponowna przeglądarka potwierdziła ZIP fallback i wartości $295 land, $575/$650 sea, $870/$945 łącznie.
- **NOT VERIFIED:** rzeczywisty mobilny viewport i bezpośredni odczyt konsoli; pozostałe dopasowania (exact, unmatched, ambiguous) potwierdzone testami/offline, nie na kilku żywych kartach. Nie uruchamiano discovery Apibara.
- Pełny koszt pod dom pozostaje niekompletny; brakujące opłaty aukcyjne, podatki/odprawa i dostawa PL nie są zerowane. Przed promocją do produkcji wymagane są mobilne QA, przegląd checkpointu i osobna zgoda na produkcyjną zmianę.
- Door-to-door nadal jest **PROTOTYPE**; stare publiczne estymacje nie są źródłem cen. Szczegóły i wartości przekazane przez właściciela zapisano w `docs/CALCULATOR_MODEL.md`.
- Calculator V2 ma lokalny/staging fundament w `public/rexbid-transport-rates.js` + `public/rexbid-transport-engine.js`, exact deterministic matching, neutral route selection i osobne expected/conservative frachtu. Strict engine pozostaje niezmieniony; żadna zmiana nie została wdrożona.
- **CODED LOCALLY / AUTOMATED VERIFIED; STAGING NOT DEPLOYED.** Cenniki ląd/morze są zaimportowane w USD. Pełny koszt pozostaje niekompletny z powodu brakujących opłat aukcyjnych/importowych, dowodów podatkowych, aktualnego FX, kosztu dostawy w Polsce i `effective_from`; nazwy portów nadal nie są znane.

Status as of 2026-09-29: production Worker `mtbid` remains on the owner-confirmed provider-independent release `241cfe3e-663d-49c3-bd2b-b29e8f20cb80`; this sprint did not alter production. Staging Worker `rexbid-auth-test` uses only `rexbid-auth-test-db`; latest infrastructure deployment is `fc0820be-4bd4-464f-a08d-03ce81180030`. Accounts Phase 3 has owner-confirmed REAL BROWSER PASS on staging; production Auth is NOT DEPLOYED and migration `0003` is NOT APPLIED to production. Door-to-door estimator is a PROTOTYPE. Request-budget improvements are deployed to staging only. Items below remain work unless current status is explicitly recorded in `PROJECT_HANDOFF.md` or `ARCHITECTURE.md`; a page or button alone is not evidence of completion.

**D1 Sync 2:** Phase A **DONE**; Phase B **D1 VERIFIED**; Phase C **SHADOW VERIFIED**; Phase D **STAGING PERSISTENT DISCOVERY VERIFIED**; Phase E read model **CODE IMPLEMENTED / AUTOMATED VERIFIED / STAGING D1 READ VERIFIED** on final staging Worker Version `6e19e605-a9a1-4e69-babe-0e4a515316ee`. Staging GETs read 20 Copart rows, known filters, one detail and its one observed snapshot; catalog and filters correctly report partial coverage. The final history response retained compatibility keys, distinguished snapshots from auction events, and had private/no-store and noindex headers. Direct SELECT after reads confirmed 20 sources/listings/snapshots, zero events/entities/duplicates, one partial scope/run/page commit/budget/reservation, accounts 1/1, legacy 0/0/0, and no writes. Staging-only diagnostics do not alter public `/api/*` or frontend. No Phase E live Apibara calls. Production `rexbid-db` untouched; proposal 0004 remains outside production migrations.

**Phase F — controlled backfill/scheduling foundation:** code and automated tests passed; authenticated owner ran the staging manual resume once for 2 pages, consuming **2/5** Phase F Apibara requests. Direct read-only SELECT on `rexbid-auth-test-db` (`acb3cb8e-69a2-459f-8a46-0f2f5b9004be`) confirmed 60 sources/listings/snapshots (20 existing + 40 new), zero duplicate source/listing keys, one partial Copart scope with next cursor, two runs, three page commits, two budget rows and three finished reservations. Phase F budget is 2 consumed/5 max, 0 reserved, retry disabled. `users=1`, favorites=1, legacy tables=0/0/0; entities/events=0. Readback was read-only (`changed_db=false`, `rows_written=0`). No Cron/Queue/schedule is enabled. Public API remains unchanged; 60 rows are partial coverage and not a full catalog. Do not make further provider requests without a new budget approval.

**2026-09-30 controlled continuation / Phase G preparation:** staging Worker `rexbid-auth-test` deployed as Version `862a11a4-9761-4491-90c9-d64cf367e69d` from verified staging-only config, binding `rexbid-auth-test-db` (`acb3cb8e-69a2-459f-8a46-0f2f5b9004be`). Direct read-only D1 SELECT reconfirmed 60 Copart sources/listings/snapshots, 0 entities/events, 1 partial scope with cursor, no duplicates, accounts 1/1 and legacy 0/0/0. Coverage: 31 makes, years 1963–2025, 42 Buy Now, 0 timed, 0 future auction dates by calendar-date comparison. D1 SQL durations: catalog 0.606 ms, detail 0.279 ms, snapshot history 0.184 ms, filters 0.156 ms; no writes. UI GET returned HTTP 200 and exposes the new guarded runner. New campaign cap is 10 additional Apibara requests total, 0 retries; it does not reset/change Phase F 2/5. It resumes Copart only, max 2 pages per click; IAAI is excluded because the runner does not own a separate IAAI scope. Live Apibara requests in this pass = 0; the owner has not run the new campaign. Phase G public API cutover remains inactive. Continue via the authenticated staging UI and stop at complete scope or 10 requests; recommend more backfill first.

**2026-09-30 final Phase F continuation readback:** owner-reported last run advanced listings 180→220 (+40 listings and +40 initial snapshots, zero duplicates); direct read-only D1 SELECT confirmed `vehicle_sources=220`, `auction_listings=220`, `auction_listing_snapshots=220`, `auction_events=0`, `vehicle_entities=0`, 220 unique listing IDs/source keys, one Copart scope with `status=partial`, cursor present, `last_complete_at=NULL`, and 11 page commits. Campaign budget is **8/10 consumed**, no reservations outstanding and retry budget unused. `users=1`, `user_favorites=1`; legacy tables remain 0/0/0. Readback wrote zero rows. No Apibara calls were made during this verification (campaign total remains 8/10). The partial Copart sample is suitable for bounded D1 query/read-model tests, but not a public catalog cutover; recommendation remains **more backfill first**. The owner-directed stop at 8/10 is in force; no further backfill was run.

## NOW — stabilize the accepted product

### 1. Protect the working release

- Preserve exact VIN/LOT matching; `redirect: "manual"`; the existing Apibara client; D1 read/write boundary; listing/history cursor behavior; Home aisles/full-catalog transition; local favorites; gallery/lightbox/zoom/pan/HD/video/360; countdown; calculator; and the accepted seller/title/condition/history mappings.
- Keep `node --test` and `git diff --check` green. Expand fixtures only from observed/authorized data, strip unnecessary identifiers, and never put secrets in tests.
- Record a production smoke-test checklist for assets, filters, Copart/IAAI, exact VIN/LOT and history pagination. Observe mobile as well as desktop before approving a visual release.

### 2. Source-data correctness: Copart and IAAI

- Maintain a small, reviewed corpus with different source states and missing/partial fields from both platforms. Confirm source field path and meaning before adding normalization.
- Cover current bid vs `current_bid2_usd`, Buy Now, sale/final/last-sold prices, generic event `price`, zero/missing price, date-only/timestamp, finished vs upcoming, sold/not-sold/approval/pending, seller masking, document flags, keys/airbags/run condition and timed states.
- Add an operator-visible way to detect stale or failed reads through safe metrics/logs (no key, authorization header, or upstream error body). Add bounded upstream protection and alerting before raising traffic.
- Document cases where Apibara does not supply a stable event identifier or event-level seller. Keep deterministic fallback semantics and expose missing data as missing.

### 3. Timed Auction correctness

- Verify real Copart/IAAI examples and provider updates for `is_timed`, `timed_end_at`, `sold_timed`, `current_bid_usd` and `current_bid2_usd`.
- Confirm countdown expiry and status transitions when a timed event closes, is extended, is sold or is not sold. Do not imply Rex.Bid bidding capability.

### 4. Seller and title intelligence

- Keep full seller extraction precedence based on confirmed detail paths and reject masked/placeholder names. Do not transfer current seller into historical event records.
- Grow title-document guidance only from actual provider vocabulary plus explicit registration/export/pending flags. Keep three conservative informational states and a clear no-legal-guarantee explanation.
- Do not produce “trusted seller” ratings from seller type alone. If a risk/quality indicator is later requested, define explainable evidence, confidence and data provenance first.

### 5. Data rights — factual data cleared; original-photo archive restricted

- Owner-reported written Apibara.tech response recorded in `docs/APIBARA_DATA_RIGHTS.md` (reported 2026-09-29; original message date not supplied) permits storage after auction and after subscription, historical VIN/LOT/status/price/seller/specification/damage/title data, change tracking/snapshots, derived data, commercial display/features/analytics/alerts, media URLs, supported remote-image display, temporary technical caching and thumbnails.
- The response does not grant a separate copyright sublicense to permanently archive or redistribute original Copart/IAA photographs. URL retention, display, temporary cache and thumbnails are allowed from Apibara's side; permanent original-photo archive is NOT APPROVED by this response. A Rex.Bid watermark is not a license.
- Do not resell Apibara API access, publish API keys, expose unrestricted raw API access to third parties or represent data as guaranteed/official Copart/IAA data.
- This removes the Apibara-permission blocker for factual auction data/history/snapshots. It does not determine independent Copart/IAA terms, privacy obligations, operational limits or legal interpretation. Phase D has completed one bounded persistent staging discovery page; Phase E staging-only D1 read model is verified, while public D1 cutover remains NOT STARTED and permanent original-photo archiving remains gated.
- Zachowuj factual data zgodnie z zakresem pisemnej odpowiedzi. Nie zapisuj kluczy ani nie udostępniaj nieograniczonego raw API. URL-e zdjęć, wspierane zdalne wyświetlanie, tymczasowy cache i thumbnails są dozwolone ze strony Apibara; trwała kopia/redistribution oryginalnych zdjęć pozostaje niezatwierdzona.
## NEXT — production foundations and useful workflows

### 6. Provider independence groundwork

- **Provider Independence DONE/PRODUCTION:** `providers/apibara.js` owns transport, request specs/auth/timeouts/errors and source normalization; `providers/contract.js` defines versioned Rex canonical entities and adapter registry/validation. Production Worker version `241cfe3e-663d-49c3-bd2b-b29e8f20cb80` is deployed. Provider B exists only as a differently-shaped test fixture/mapper; it is not an integrated data source.
- Before release, review build/test results and ensure every public compatibility serializer preserves existing frontend behavior. Do not claim Provider B is production-ready.
- Define VIN-to-multiple-listings behavior, provider priority, freshness, conflict resolution, missing-field merge rules and outage fallback before registering a second provider.
- Current D1 keys are not source-namespaced. Prepare only an additive migration after collision/identity review; factual-data permission from Apibara is documented, but do not change current PKs or merge existing rows automatically.

### 7. Synchronizacja produkcyjna — PROPOZYCJA / NIEWDROŻONE

- Pełny projekt: `docs/D1_SYNC_2_DESIGN.md`; addytywny szkic pustego schematu: `docs/proposals/0004_d1_sync_2.sql`. Oba są poza aktywnym katalogiem migracji Wrangler. `0002_provider_sync_foundation.sql` to wcześniejszy, zastąpiony szkic — nie stosować go razem z 0004.
- Model tożsamości rozdziela encję pojazdu, źródło providera, lifecycle listingu i event historii. Istniejący `vehicle_key`, PK i wiersze pozostają nietknięte; bez masowego backfillu.
- Pipeline ma odkrywać canonical summaries przez endpoint listy, a szczegóły/historię odświeżać selektywnie. GET pozostaje read-only; sync nie uruchamia się przy przeglądaniu. Późniejszy, przełączany flagą D1-first zachowa obecny kontrakt odpowiedzi i użyje cursorów Rex.Bid.
- Budżety są scenariuszami matematycznymi, nie pomiarem ani zgodą planu: ok. 98/956/4 778 requestów upstream/dzień dla 1k/10k/50k listingów przy założeniach z dokumentu. Najpierw potwierdzić quota planu, naliczanie stron oraz prawa retencji.
- **Prawa factual data:** potwierdzone przez Apibara według pisemnej odpowiedzi właściciela; szczegóły i granice są w `docs/APIBARA_DATA_RIGHTS.md`. Odrębna blokada pozostaje dla trwałego archiwum/redistribution oryginalnych zdjęć Copart/IAA oraz niezależnych obowiązków platformowych. Phase D wykonała jedną ograniczoną stronę discovery na stagingu i zachowała rekordy; Phase E staging read model jest zweryfikowany, natomiast odczyt publicznego katalogu z nowych tabel pozostaje NOT STARTED.
- Phase A DONE; Phase B **D1 VERIFIED**; Phase C **SHADOW VERIFIED**; Phase D **STAGING PERSISTENT DISCOVERY VERIFIED**. Phase C: 1 request, 20 accepted transient records, D1 cleanup potwierdzony. Phase D: 1 dodatkowy request, 20 zaakceptowanych i trwale pozostawionych listingów, 20 źródeł, 20 initial snapshots, 0 events i 0 raw/media; `scope=partial`, cursor/page commit zapisane, budget 1/5. D1 readback: entities 0 celowo (bez trusted reconciliation), sources/listings/snapshots 20, accounts 1/1, legacy tables 0. Phase D dane nie zasilają `/api/cars` ani frontend. Production nietknięta.
- Nie włączać Cron/Queues ani nie ustalać interwałów produkcyjnych, dopóki nie są potwierdzone limity dostawcy, limity konta Cloudflare i globalny request budget.

### 8. Import-cost estimator — source-backed model

- **Strict calculator:** Phase 1/2 remains in `public/rexbid-calculator.js` and its rates file. Calculator V2 now provides USD partner land/sea amounts to the strict engine as configurable transport inputs when the user has not set a manual override; tax/fee math remains unchanged.
- Copart's official US page confirms tiered fees and differences by clean/non-clean title group, secure/unsecure payment, online bid type, gate/environmental and conditional charges. The page presents multiple schedules; a buyer profile and source title code must be selected before a fee can be called confirmed.
- IAA's official US pages confirm a Buyer Fee Schedule and logged-in vehicle-specific Cost Calculator, but the public US fee page did not expose a readable complete numeric schedule in this research. Do not substitute Canadian rates, brokers, or blogs. Obtain account-specific IAA breakdowns.
- Partner transport tables supersede prior public market estimates as Rex.Bid's working rate source. All 610 land rows and 1–4 car sea rates are imported from source files by a deterministic parser/generator; currency is USD. Neutral route-to-port mapping and `effective_from` remain unknown. Do not fall back automatically to old market values.
- Current official sources confirm Poland's 23% standard VAT and passenger-car excise categories/rates, with HEV/PHEV/EV distinctions and conditional exemptions. The actual customs code, vehicle origin/proof, customs valuation, tax base and customs exchange rate must be resolved for each scenario.
- TARIC/Access2Markets research found that US location is not proof of US origin; some listed CN codes may have a conditional 0% US-origin preference under Regulation (EU) 2026/1455 while a 10% third-country rate is shown for an example CN code. Always query the exact code, origin, date and proof conditions; never hardcode a universal 10% or 0% duty.
- Full-cost calculation must continue to show Kalkulacja niepełna and no total while mandatory auction/import amounts, legal tax inputs or dated UI FX are unknown. The known USD/PLN subtotals stay separate; source-configured partner values do not make the estimate complete.
- The engine can show an estimated total only after all required amounts and a dated/source-backed indicative UI FX rate are provided. UI FX is not the legal customs/excise rate. No estimate is a guaranteed payable total or legal/tax advice.

### 9. Durable customer features

**Accounts Phase 2A Supabase proof-of-fit: DONE/PASS on isolated staging; production auth: NOT DEPLOYED.** Owner-run real E2E against the Frankfurt Supabase test project, Worker `rexbid-auth-test`, and D1 `rexbid-auth-test-db` passed verified existing-user login, BFF HttpOnly session, internal identity mapping, favorite create/list/idempotency/delete/guest merge, refresh, and logout. After logout favorite API access required login. Last read-only D1 verification: `users=1`, `user_favorites=1` (one fake LOT row retained from merge); count query reported `rows_written=0`. Raw connectivity/fetch-option staging diagnostics have been removed; safe request correlation/provider-stage diagnostics remain gated by staging configuration.

**Accounts Phase 3 — wcześniejszy STAGING REAL BROWSER PASS; bieżący kod wdrożony na staging; PRODUCTION NOT DEPLOYED.** Wspólny klient odczytuje dostępność z BFF `/api/auth/config`, a nie z frontendowej stałej hosta. Właściciel potwierdził login/konto/sesję/cloud favorites/logout; bieżący deploy `916a2a0c-f5ad-4643-b886-927c8b2849c9` przeszedł GET smoke i przeglądarkowy render login/reset/resend. Realny recovery mail/callback/password update, export download i współbieżny refresh w wielu kartach nie są jeszcze zweryfikowane. Przed produkcją trzeba osobno zatwierdzić/zastosować addytywne `0003` po weryfikacji D1, skonfigurować sekrety i canonical origin, zadeklarować zweryfikowany schema `0003`, aktywować rate limiting, sprawdzić cookies, SMTP oraz decyzje privacy/retention/deletion. Nie przenosić staging config/secrets/test UI/test D1 do produkcji.

**Apibara request budget — staging deployed, production unchanged.** Current policy is documented in `PROJECT_HANDOFF.md` and `ARCHITECTURE.md`: four viewport-lazy Home queries (each 4 items, 60-second edge cache); one catalog call per user page; one detail lookup with Worker exact-search fallback on 404 only (30-second edge cache); one history page on vehicle entry plus one per explicit “older events” click (5-minute cursor-specific edge cache); dynamic visible/phase-aware refresh with single-flight; Auth/favorites issue zero Apibara calls. Automated checks use only mocks/fixtures. After the budget warning, no `/api/cars` or `/api/filters` live reads were made. One staging car smoke after the new deployment caused an estimated 2 upstream reads (detail + initial history) and rendered successfully. Earlier exact totals were not instrumented. Production remains unchanged.

Then build durable customer features with privacy, recovery and account lifecycle specified:

- customer accounts and secure authentication/session management;
- persistent, cross-device favorites migrated from local versioned storage with dedupe/consent/error recovery;
- saved searches with explicit filters and versioned query contract;
- user-controlled alerts for price/status/auction-time changes, with frequency limits, unsubscribe and delivery audit;
- customer database minimization, retention/deletion/export and access-control policy;
- account pages that clearly distinguish local device state from synced account data.

Do not introduce vehicle comparison; the owner rejected that feature.

### 10. Historical events and data quality operations

- Build the factual-data sync/backfill plan for ended listings and repeat VIN events under the permission recorded in `docs/APIBARA_DATA_RIGHTS.md`; keep permanent archiving of original Copart/IAA photos out of scope unless separately licensed.
- Track event source ID/fallback key, event date precision, latest source capture, raw payload version and normalization version.
- Audit existing collision candidates before any unique index or re-key. Never auto-delete/merge ambiguous history.
- Add reconciliation counters: fetched, normalized, inserted, updated, skipped, ambiguous, missing-data, failed. Keep identifiers and payloads out of routine logs where possible.

## BEFORE PUBLIC LAUNCH — trust, operations and compliance

### 11. Brand domain, DNS and email

- Choose and register the final Rex.Bid domain; do not invent a domain or contact mailbox before ownership is established.
- Configure Cloudflare DNS/custom domain, HTTPS, redirect/canonical host, certificate, HSTS policy where appropriate and renewal monitoring.
- Provision transactional/support email on the chosen domain. Configure SPF, DKIM and DMARC; verify deliverability and bounce/complaint handling before alerts/account email launch.
- Replace neutral contact placeholders only after mailbox ownership and monitoring are confirmed.

### 12. Security and abuse controls

- Verify secrets inventory and rotation procedures. Keep API credentials in Cloudflare secrets, distinct from browser config and source maps.
- Add rate limiting/quotas for expensive listing, detail, history, filter and sync requests. Protect the sync endpoint against brute-force/replay and constrain operator scope.
- Review CORS, URL/identifier validation, output escaping, content security policy, dependency advisories and D1 least privilege.
- Add privacy-conscious logging, error reporting and retention limits. Never log authorization/key values or full provider response bodies.
- Perform a focused security review before accounts or public notifications; include session/token storage, CSRF, authorization boundaries and account deletion.

### 13. Backup, recovery and monitoring

- Define D1 backup/export cadence, retention, encryption/access control and a restore drill. Verify the application database ID before backup/migration actions.
- Define rollback procedure for Worker assets/version and additive migrations; test restore against a non-production database.
- Add availability/error/latency metrics for Worker, Apibara status/rate limits, D1 errors, sync lag, pagination incompletion and notification delivery.
- Set alert thresholds and an owner/on-call runbook. Verify logs redact secrets and PII.

### 14. Privacy, terms, and data licensing

- Prepare privacy notice, terms of service, cookies/analytics notice where applicable, source-data attribution, estimate disclaimers and customer support/privacy contacts with legal review.
- State that auction data may be delayed/incomplete and that title/import classification is informational, not a legal/registration guarantee.
- Apibara factual-data permission is recorded in `docs/APIBARA_DATA_RIGHTS.md`; independently review Copart/IAA platform terms and original-photo copyright/storage before archiving media.
- Research legitimate vehicle-history report sources (including Carfax) and obtain written API, display, storage, customer disclosure and resale/redistribution terms. A publicly purchasable report is not proof of resale rights. Do not implement or resell until licensed.
- Define customer request workflow for access, correction, export and deletion, plus provider-source data removal obligations.

### 15. SEO, analytics and content quality

- Add canonical metadata, unique page titles/descriptions, robots/sitemap, structured vehicle data only where accurate, indexable category URLs and sensible handling of parameterized filter URLs.
- Review Core Web Vitals, image sizes/lazy loading, accessibility, keyboard navigation and localization.
- Select privacy-appropriate analytics only after consent/legal requirements are understood. Avoid sending VINs, account identifiers or sensitive search terms into analytics by default.
- Validate informational pages, contact path, error/empty/loading states and mobile navigation.

### 16. Launch acceptance and mobile QA

- Run production smoke checks for `/`, `/api/filters`, `/api/cars`, Copart, IAAI, exact VIN, LOT-only, history and next cursor.
- Check favorites, gallery images, lightbox/zoom/pan, HD, video, 360, timed countdown and calculator across desktop/tablet/mobile.
- Check API quotas/cost, cold start, cache behavior, load-more/repeated cursors, upstream outage behavior and accessible empty/error states.
- Have the owner inspect real desktop and mobile pages before public launch; do not treat automated tests as visual sign-off.

### 17. Admin/operator tooling

- Define roles and audit trail first. Provide least-privilege actions for sync/retry, data-quality inspection, customer support/deletion and provider status.
- Admin actions must not expose secrets or raw customer/provider data unnecessarily. Keep protected operational routes out of public navigation and test authorization.

## POST-LAUNCH — measured expansion

- Tune cache TTLs, sync cadence and rate limits from observed traffic, upstream limits and data freshness goals.
- Add further vehicle analytics or paid tiers only after demand, licensing, calculation accuracy and support costs are known.
- Add notifications/digests and saved-search improvements based on customer feedback and opt-in rates.
- Consider another provider only after adapter contract, data-rights review, parity tests and conflict policy are ready.
- Review calculator assumptions, auction fee schedules, tax guidance and provider contract terms on a scheduled cadence; publish effective dates.
- Expand admin reporting, operational dashboards and data-quality sampling without collecting unnecessary customer data.
- Reassess SEO and analytics against conversion/support outcomes while preserving privacy and performance.

## Release gates

Do not call Rex.Bid production-ready for broad public launch until all of these are satisfied:

1. Apibara factual data rights are documented; original-photo archive rights and vehicle-history report licensing remain separately gated.
2. Domain, HTTPS and contact email are live and monitored.
3. Account/security/privacy/terms decisions are implemented before persistent customer data is collected.
4. Sync is bounded, observable, resumable and does not label partial runs complete.
5. D1 backups and restore are tested; schema changes have reviewed migration/rollback plans.
6. API abuse limits, monitoring and incident response are active.
7. Current fees/import assumptions have dated sources or are clearly configured/labelled estimates.
8. Production API and owner visual/mobile acceptance checks pass.

## Accounts production readiness — 2026-09-29

- **Staging verified:** wcześniejszy real-browser login/account/cloud favorites/logout. Bieżący kod wdrożono jako `rexbid-auth-test` version `916a2a0c-f5ad-4643-b886-927c8b2849c9`; GET smoke oraz przeglądarkowy render login/reset/resend PASS. Real-mail recovery/resend, callback, password update, export download i multi-tab refresh pozostają do kontrolowanego testu.
- **Production ready in code (candidate):** auth endpoint ma fail-closed feature/origin/DB/schema-version/secrets/rate-limit config, reset hasła neutralny na enumeration, PKCE recovery, eksport danych konta, explicit same-origin/Sec-Fetch protection i testowaną refresh single-flight ochronę.
- **Requires owner configuration:** produkcyjny Supabase URL/publishable key/cookie secret/canonical origin/redirect allowlist, Cloudflare Rate Limiting namespace+binding+progi, SMTP i właściwe privacy pages.
- **Requires legal/business decision:** retention, privacy/terms, konto deletion (wymaga uprzywilejowanego Supabase Admin mechanizmu; nie dodano `service_role`) oraz kontakt/privacy mailbox.
- **Not production deployed:** nie włączono produkcyjnego Auth, nie zastosowano `0003` do `rexbid-db`; staging-only flaga/bypass/diagnostics nie mogą być przenoszone do production. Zobacz checklistę `docs/ACCOUNT_PRODUCTION_READINESS.md` i inwentarz `docs/ACCOUNT_DATA_PRIVACY.md`.

## Infrastruktura kontrolowanego launchu — lokalna propozycja, NOT DEPLOYED (2026-09-29)

Lokalny diff dodaje `/health`, `/ready`, sanitizowane logi, security/cache headers, staging noindex, config guard i fail-closed guard dla door-to-door prototype. Nie wykonano deployu, D1 migracji ani Apibara requestów.

### Wymagane przed publicznym launch

1. Właściciel wybiera domenę/DNS/HTTPS; canonical, sitemap i Supabase callback aktualizujemy dopiero po zatwierdzeniu origin.
2. Apibara factual data permission is documented; original Copart/IAA photo archive remains unapproved. D1 Sync Phase D has one persistent staging page verified; Phase E diagnostic D1 reads are staging-verified, but public D1 Primary Reads/cutover has not started.
3. Zatwierdzić privacy, terms, cookies, retencję i proces eksportu/usunięcia konta.
4. Właściciel wybiera SMTP i konfiguruje SPF/DKIM/DMARC, From/Reply-To, confirmation/reset oraz monitoring dostarczeń.
5. Accounts production wymaga osobnej decyzji, produkcyjnego Supabase, origins/cookie secret, aktywnego Cloudflare rate-limit binding, przeglądu i odrębnego zastosowania migracji 0003. Auth pozostaje wyłączony; 0003 NOT APPLIED.
6. Wykonać restore rehearsal, ustanowić monitoring/alerty i zdecydować o public API limits.
7. Przejść `docs/PRODUCTION_DEPLOY_CHECKLIST.md`; każdy krytyczny punkt nierozstrzygnięty oznacza STOP.

Statusy launch: `docs/LAUNCH_READINESS.md`; backup/restore: `docs/BACKUP_RECOVERY.md`.


## Calculator V3 — status implementacji lokalnej (2026-09-30)

- **DONE in code:** rozszerzenie V2 o trzy poziomy (transport, import subtotal, door-to-door), nieznane koszty jako brak danych, osobne currency/provenance/status i warianty standard/ostrożny. Staging-only gate jest domyślnie wyłączony w production.
- **AUTOMATED VERIFIED:** V3 testy i pełny test suite; szczegóły w `docs/DOOR_TO_DOOR_COST_MODEL.md`.
- **NOT STAGING VERIFIED / NOT REAL BROWSER VERIFIED:** nie wykonano deployu w tym etapie; nie pobrano auta ani nie wykonano requestu Apibara.
- **Nadal blokuje pełny koszt pod dom:** potwierdzony profil Copart dla Rex.Bid, właściwy cennik IAA, import agent inputs/TARIC/origin, udokumentowane customs/excise/VAT bases, datowane odrębne UI/customs/excise FX, oferty port/broker/unloading/documentation/insurance/other import oraz dostawa w Polsce.
- Następny krok: checkpoint kodu po review, a potem osobno zatwierdzony staging deploy i browser verification bez żądań providera (np. używając istniejących, już pobranych danych albo lokalnego fixture). Produkcja i produkcyjna migracja nie wchodzą w zakres.

## Calculator V3 — końcowa weryfikacja stagingowa (2026-09-30)

- **CODE VERIFIED / AUTOMATED VERIFIED / STAGING VERIFIED:** Version `c34f0aa5-eefb-43be-85ea-6cd4ee161868`, tylko `rexbid-auth-test` + `rexbid-auth-test-db`; 268/268 testów, generator, składnia i diff-check PASS.
- **REAL BROWSER DESKTOP VERIFIED / MOBILE VERIFIED:** Copart LOT 97885965; 12 zdjęć, 20 history events, dane auta i lokalny favorite bez regresji. Dla location `Long Island (NY)`, ZIP match: $295 land; standard $575 sea = $870, ostrożnie $650 sea = $945. Viewport 1366×900 i 390×844 bez poziomego scrolla; szczegóły działają; console errors = 0.
- Widoczne V3 rozdziela składniki i nie pokazuje pełnej sumy, gdy brakuje danych. Po jawnych syntetycznych QA inputs pełny stan pokazał orientacyjnie 48 706 PLN / 48 987,25 PLN; po teście wyczyszczono wartości.
- **NOT VERIFIED:** real-browser IAAI; automatyczny kurs FX; właściwy profil konta Copart; realne podstawy podatkowe; port/broker/obsługa/dokumentacja i transport w Polsce; cloud Auth/favorites w tej sesji. Pełny koszt pod dom wciąż zależy od tych danych.
- Usunięto regresję widoczności V3 na extensionless `/car`, podsumowanie V3 przeniesiono do widocznej części strony, a opłata Copart ma jawny opis publicznej tabeli z niepotwierdzonym profilem Rex.Bid.
- Brak bezpośrednich requestów, discovery lub backfill Apibara. Zwykłe browser detail/history load może użyć providera; dokładnego upstream countu nie instrumentowano. Produkcja nietknięta.
- Rekomendacja: checkpoint Calculator V3 po review. Nie oznacza to gotowości pełnej wyceny ani produkcyjnego włączenia.
# Staging public API D1-first — 2026-10-01

- **STAGING VERIFIED** on final Worker Version `a6569e87-47be-4039-af7c-cd36374afdde`, bound only to `rexbid-auth-test-db`; the staging D1-first flag is restored to `true`.
- Exact staging host + staging UI flag + expected D1 target + `REXBID_D1_PRIMARY_READS=true` are all required. Production config/code remain provider-backed and cannot activate this path by copying the flag alone.
- Partial listing/filter results are allowed only as explicitly incomplete known-row data. Current scopes are Copart partial (220) and IAAI partial (80), each with its own cursor; neither yields a complete-catalog claim.
- Real staging smoke verified D1 catalog/filters, IAAI detail/history, and one stale Copart hybrid fallback. Rollback with the flag OFF restored the existing provider-backed list response and was followed by redeploy with the flag ON. Two provider-backed reads total; no discovery/backfill.
- Browser Home/catalog and IAAI detail rendered with the `D1 catalog: partial` badge. Timed/Buy Now/upcoming route semantics were tested after query mapping was fixed. Console internals were not accessible through the browser-control API.
- Full suite **285/285 PASS**; production remains unchanged.
- Production cutover remains blocked on complete/operationally accepted scopes, verified rollback/monitoring and a separately approved production migration/deploy plan.
