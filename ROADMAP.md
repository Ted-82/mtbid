# Rex.Bid Production Roadmap

Status as of 2026-09-29: production Worker `mtbid` remains on the owner-confirmed provider-independent release `241cfe3e-663d-49c3-bd2b-b29e8f20cb80`; this sprint did not alter production. Staging Worker `rexbid-auth-test` uses only `rexbid-auth-test-db`, clean deployment after removal of the temporary Phase B route `05cc0435-eb7b-4f98-b012-9335d6055a64`. Accounts Phase 3 has owner-confirmed REAL BROWSER PASS on staging; production Auth is NOT DEPLOYED and migration `0003` is NOT APPLIED to production. Door-to-door estimator is a PROTOTYPE. Request-budget improvements are deployed to staging only. Items below remain work unless current status is explicitly recorded in `PROJECT_HANDOFF.md` or `ARCHITECTURE.md`; a page or button alone is not evidence of completion.

**D1 Sync 2:** Phase A **DONE**; Phase B **D1 VERIFIED**; Phase C **SHADOW VERIFIED** na staging `rexbid-auth-test-db` po jednym live request discovery; Phase D **NOT STARTED**. Czysta wersja stagingu po usunięciu tymczasowej trasy Phase C: `c3137145-5d14-4cb6-b888-51c092b25938`. `sync/d1-repository.js` nie jest podłączone do Workera/API. Produkcyjna `rexbid-db` nie była migrowana. Proposal 0004 pozostaje poza aktywnym katalogiem Wrangler i została zastosowana wyłącznie do stagingu.

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

### 5. Data rights gate

- **OPEN LEGAL/DATA QUESTION:** Obtain written confirmation from Apibara for permitted cache duration, storage/retention (including old auction history), transformed/derived values, customer display/redelivery, redistribution/resale, and photos/media rights; clarify deletion or takedown duties and source-platform restrictions.
- Public [Apibara Terms](https://apibara.tech/en/terms) require key security and restrict abuse, limit bypass, resale of access against plan and representing data as guaranteed/official; they make the customer responsible for its application, requests, stored data and legal compliance. The public terms reviewed do **not** clearly specify a retention period or grant/deny long-term storage, redistribution of vehicle fields/history, or image rights. Do not infer permission from API availability.
- Apibara [pricing/API guidance](https://apibara.tech/en/pricing) recommends keeping keys server-side, caching fields that do not need real-time refresh, and reviewing obligations for displaying or redistributing third-party data/media. This is not a specific license for indefinite history or photo retention.
- Until clarified, do not expand durable history archival or start a paid vehicle-history/report product. Keep `raw_payload` retention subject to this decision.

## NEXT — production foundations and useful workflows

### 6. Provider independence groundwork

- **Provider Independence DONE/PRODUCTION:** `providers/apibara.js` owns transport, request specs/auth/timeouts/errors and source normalization; `providers/contract.js` defines versioned Rex canonical entities and adapter registry/validation. Production Worker version `241cfe3e-663d-49c3-bd2b-b29e8f20cb80` is deployed. Provider B exists only as a differently-shaped test fixture/mapper; it is not an integrated data source.
- Before release, review build/test results and ensure every public compatibility serializer preserves existing frontend behavior. Do not claim Provider B is production-ready.
- Define VIN-to-multiple-listings behavior, provider priority, freshness, conflict resolution, missing-field merge rules and outage fallback before registering a second provider.
- Current D1 keys are not source-namespaced. Prepare only an additive migration after rights and collision review; do not change current PKs or merge existing rows automatically.

### 7. Synchronizacja produkcyjna — PROPOZYCJA / NIEWDROŻONE

- Pełny projekt: `docs/D1_SYNC_2_DESIGN.md`; addytywny szkic pustego schematu: `docs/proposals/0004_d1_sync_2.sql`. Oba są poza aktywnym katalogiem migracji Wrangler. `0002_provider_sync_foundation.sql` to wcześniejszy, zastąpiony szkic — nie stosować go razem z 0004.
- Model tożsamości rozdziela encję pojazdu, źródło providera, lifecycle listingu i event historii. Istniejący `vehicle_key`, PK i wiersze pozostają nietknięte; bez masowego backfillu.
- Pipeline ma odkrywać canonical summaries przez endpoint listy, a szczegóły/historię odświeżać selektywnie. GET pozostaje read-only; sync nie uruchamia się przy przeglądaniu. Późniejszy, przełączany flagą D1-first zachowa obecny kontrakt odpowiedzi i użyje cursorów Rex.Bid.
- Budżety są scenariuszami matematycznymi, nie pomiarem ani zgodą planu: ok. 98/956/4 778 requestów upstream/dzień dla 1k/10k/50k listingów przy założeniach z dokumentu. Najpierw potwierdzić quota planu, naliczanie stron oraz prawa retencji.
- **OTWARTA BLOKADA PRAW/DANYCH:** nie rozszerzać trwałego przechowywania listingów, historii, snapshots ani mediów; bez backfillu i D1-first cutover do czasu pisemnej zgody na retencję, redystrybucję i usuwanie danych. Obecne raw JSON również wymaga przeglądu umowy.
- Phase A DONE; Phase B **D1 VERIFIED** na `rexbid-auth-test-db`. Phase C **SHADOW VERIFIED**: pojedynczy Copart list request, 20 provider records, 20 accepted, 0 rejected/ambiguous; real D1 readback, replay/idempotency, Fake Provider B, partial update, failure recovery i budget checks PASS. Tail wykazał `cleanup=true`; bezpośrednie county po cleanup potwierdziły Sync tables=0, `users=1`, `user_favorites=1`, legacy vehicle/history=0. UI chwilowo pokazało `cleanup: undefined` wskutek różnicy nazw pola; poprawiono helper raportowania i dodano regresję offline. Tymczasową trasę/przycisk/flagę usunięto, a czysty staging redeploy zakończono jako `c3137145-5d14-4cb6-b888-51c092b25938`. Phase D nie rozpoczęta. Produkcja nietknięta.
- Nie włączać Cron/Queues ani nie ustalać interwałów produkcyjnych, dopóki nie są potwierdzone limity dostawcy, limity konta Cloudflare i globalny request budget.

### 8. Import-cost estimator — source-backed model

- **Phase 1 research + Phase 2 calculator foundation implemented locally:** see docs/CALCULATOR_MODEL.md, public/rexbid-calculator.js, public/rexbid-calculator-rates.js, and public/car.html. No deploy or unconfirmed fee assumption was added.
- Copart's official US page confirms tiered fees and differences by clean/non-clean title group, secure/unsecure payment, online bid type, gate/environmental and conditional charges. The page presents multiple schedules; a buyer profile and source title code must be selected before a fee can be called confirmed.
- IAA's official US pages confirm a Buyer Fee Schedule and logged-in vehicle-specific Cost Calculator, but the public US fee page did not expose a readable complete numeric schedule in this research. Do not substitute Canadian rates, brokers, or blogs. Obtain account-specific IAA breakdowns.
- Facility→port, ocean freight, insurance, destination fees and inland Poland delivery have no verified universal rate. Collect dated route/vehicle-specific forwarder quotes and model their included/excluded items separately.
- Current official sources confirm Poland's 23% standard VAT and passenger-car excise categories/rates, with HEV/PHEV/EV distinctions and conditional exemptions. The actual customs code, vehicle origin/proof, customs valuation, tax base and customs exchange rate must be resolved for each scenario.
- TARIC/Access2Markets research found that US location is not proof of US origin; some listed CN codes may have a conditional 0% US-origin preference under Regulation (EU) 2026/1455 while a 10% third-country rate is shown for an example CN code. Always query the exact code, origin, date and proof conditions; never hardcode a universal 10% or 0% duty.
- Current calculator shows Kalkulacja niepełna and no total when a required amount, tax input, or dated UI FX rate is unknown. Copart covers only selected secured Pre-Bid profiles and documented price bands; IAA remains unpriced. Line items expose amount/null, currency, provenance, checked/effective date and confirmed/configurable/estimated/unknown status. Next: obtain IAA schedules, buyer profile, forwarder quotes and customs-agent validation; then populate versioned rates and an NBP-backed indicative FX adapter.
- The engine can show an estimated total only after all required amounts and a dated/source-backed indicative UI FX rate are provided. UI FX is not the legal customs/excise rate. No estimate is a guaranteed payable total or legal/tax advice.

### 9. Durable customer features

**Accounts Phase 2A Supabase proof-of-fit: DONE/PASS on isolated staging; production auth: NOT DEPLOYED.** Owner-run real E2E against the Frankfurt Supabase test project, Worker `rexbid-auth-test`, and D1 `rexbid-auth-test-db` passed verified existing-user login, BFF HttpOnly session, internal identity mapping, favorite create/list/idempotency/delete/guest merge, refresh, and logout. After logout favorite API access required login. Last read-only D1 verification: `users=1`, `user_favorites=1` (one fake LOT row retained from merge); count query reported `rows_written=0`. Raw connectivity/fetch-option staging diagnostics have been removed; safe request correlation/provider-stage diagnostics remain gated by staging configuration.

**Accounts Phase 3 UI — STAGING DONE/PASS; PRODUCTION NOT DEPLOYED.** The shared client is deployed to the exact staging host and owner-confirmed real-browser login/account/session/cloud-favorites flow passed. This sprint verified guest favorite rendering/removal and staging data pages. The client remains host-gated and uses same-origin BFF, guest-consent merge, account-scoped curated cache, and private-state clearing on logout/401/account switch. Before production, separately review/apply additive migration `0003` only after explicit approval and verified D1 target, configure production Auth secrets, enable rate limiting, review refresh-token races and final-domain cookie flags, and complete privacy, retention, recovery, deletion and export decisions. Never promote staging config, secrets, test UI, or test D1 into production.

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

- Build a sync/backfill plan for ended listings and repeat VIN events only after provider retention rights are confirmed.
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
- Confirm rights to ingest, cache, retain, transform, display and expose Apibara/Copart/IAA data under each applicable contract and platform terms.
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

1. Provider data rights/retention and report licensing are understood and documented.
2. Domain, HTTPS and contact email are live and monitored.
3. Account/security/privacy/terms decisions are implemented before persistent customer data is collected.
4. Sync is bounded, observable, resumable and does not label partial runs complete.
5. D1 backups and restore are tested; schema changes have reviewed migration/rollback plans.
6. API abuse limits, monitoring and incident response are active.
7. Current fees/import assumptions have dated sources or are clearly configured/labelled estimates.
8. Production API and owner visual/mobile acceptance checks pass.
