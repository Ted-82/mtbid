# Rex.Bid Production Roadmap

Status reflects the owner-confirmed `b25c452` / Worker version `a1e0199f-97c4-4e93-99ab-96041327d5c7` checkpoint. Items below are work to do unless explicitly described as current behavior in `PROJECT_HANDOFF.md` or `ARCHITECTURE.md`. Do not treat a roadmap item as implemented merely because a page or button exists.

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

- Obtain and retain a clear answer from Apibara on storage, refresh, derived values, historical event retention, display/cache, customer access and deletion obligations.
- Until then, avoid expanding durable history retention or using stored data for a new resale/paid report product.

## NEXT — production foundations and useful workflows

### 6. Provider independence groundwork

- Approve the target adapter/canonical/API boundary in `ARCHITECTURE.md`.
- Define versioned vehicle/listing/history DTOs and provenance fields; write mapping contract tests around the existing Apibara payload before extracting modules.
- Define VIN-to-multiple-listings behavior, provider priority, freshness, conflict resolution, missing-field merge rules and outage fallback.
- Avoid broad rewrites. Migrate one endpoint at a time while keeping the current frontend response contract working.

### 7. Production synchronization lifecycle

- Verify `REXBID_SYNC_TOKEN` presence/configuration without revealing it; create/rotate only through a secret manager when authorized.
- Decide the actual trigger and ownership: authenticated manual operator action, scheduled Cron, queue, or a combination. Define freshness intervals per active/upcoming/closed listing, concurrency, rate budgets, backoff policy, checkpoint/cursor storage, idempotency and resumability.
- Add durable sync-run status only if required; use additive D1 migration, collision review and restore plan. A partially paginated run must never be marked complete.
- Prioritize active vehicles first, then recheck older closed events whose status/sale fields can change. Avoid re-fetching every record on every user GET.

### 8. Import-cost estimator — source-backed model

- Preserve current arithmetic until every changed assumption has an authoritative, dated source and tests.
- Research current Copart and IAA auction buyer fees, fee tiers, online/platform fees and membership/other relevant charges. Record source, currency, effective date and which auction buyer profile the estimate assumes.
- Model facility-to-port trucking separately from ocean freight/port fees and destination delivery. Provide route/port assumptions and ranges where quotes vary.
- Research customs duty, VAT and excise applicability by vehicle origin, fuel/engine/age and destination rules with qualified current sources. Make inputs explicit and version assumptions.
- Return an itemized “estimated import cost”, show the assumption date and uncertainty, and provide a breakdown; never label estimates as guaranteed payable totals or legal/tax advice.
- Add a configuration/version mechanism for changing rates without silently changing historical calculations.

### 9. Durable customer features

Build only after authentication, data model, privacy and account recovery are specified:

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
