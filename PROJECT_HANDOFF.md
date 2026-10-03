## Full functional stability + vehicle data flow sprint — 2026-10-03

- **Checkout:** repo `C:\Users\nowic\Desktop\stona_auta-www`, HEAD at start `a836b86 Complete Rex.Bid production pre-cutover audit` (newer than requested historical checkpoint `bd88ff1`). Existing untracked `.codex-wrangler-cache/` was preserved. No commit/push.
- **Root cause — staging vehicles appear absent from Home:** staging D1 has 380 known listings (Copart 260, IAAI 120), but both scopes remain partial and last success is stale (2026-10-01); the sample contains no current/upcoming eligible rows. `/api/cars` and `/api/filters` return HTTP 200 from D1, with explicit `catalog_complete=false`, `metadata_complete=false`, `scope_status=partial`, `read_source=d1`. Catalog defaults to `per_page`, not `limit`; frontend consumes the array envelope correctly. Exact VIN and LOT searches each returned one record when carried filters were cleared.
- **Staging UI bug fixed:** Home previously let expired Buy Now/Timed records leak into aisle results; it also did not require a future confirmed date for the Upcoming aisle. `marketAisleCars` now excludes ended/expired non-live items across aisles and requires a future date for Upcoming. Real-browser post-deploy Home shows clear empty states for all four aisles; partial staging data is not misrepresented as live inventory.
- **Staging deploy:** Worker `rexbid-auth-test`, Version ID `412cba70-b9dd-46fb-888f-e3784e5a0854`, D1 binding only `rexbid-auth-test-db` (`acb3cb8e-69a2-459f-8a46-0f2f5b9004be`). Wrangler dry-run confirmed the target. No D1 migration, discovery/backfill, or production action occurred.
- **Real browser verified (desktop):** Home and four empty aisles; catalog `/?catalog=1` displays 20 rows; exact VIN and LOT each produce one result; existing Copart LOT `64693505` and IAAI LOT `44251858` detail pages work; gallery images load (12 Copart, 13 IAAI sample URLs), lightbox opens/closes, history renders and labels provider history separately from Rex.Bid snapshots, Calculator V3 renders partial costs without inventing zeros, guest local favorite add/remove works. No browser console errors observed. Auth/cloud favorites were not re-tested because the browser was anonymous and no owner credentials were used.
- **Provider/D1 read path:** Home/catalog/filter reads use staging D1, with no catalog provider fallback. One controlled IAAI detail API request was captured in staging tail: D1 hit but stale, reason `d1_detail_stale`, hybrid fallback, upstream HTTP 200. Detail/history for the two real-browser cards also displayed provider-enriched data; their upstream request count was not captured, so total incidental browser-triggered provider calls is **NOT EXACTLY VERIFIED**. No discovery/backfill was run.
- **Production is currently broken for catalog API, not repaired/deployed:** read-only production `/api/cars` and `/api/filters` return HTTP 500 with the safe provider-unavailable envelope. Active production configuration has `REXBID_PROVIDER_BUDGET_MODE=required` but no global/operation daily limit variables, while production D1 only has legacy migrations 0000/0001 and lacks Sync budget tables. The budget guard therefore rejects the request before outbound provider fetch. Secret name `APIBARA_API_KEY` exists, but secret value/validity was not inspected. Production D1-first remains OFF. This is a production configuration/schema readiness blocker; no production hotfix or migration was performed.
- **D1 read-only state:** Copart 260, IAAI 120, total 380 listings/sources/snapshots; events 0; vehicle entities 0; media URL/thumb references on 80 rows (40 per platform); scopes partial with separate cursors; users/favorites 1/1; legacy vehicle/history rows 0. No media binaries are stored.
- **Verification:** full `node --test` 310/310 PASS; partner rates generator `--check` PASS; config validator PASS (production provider traffic still fail-closed, D1-first OFF, Cron OFF; staging targets exact D1); changed embedded script was exercised by behavioral tests. `git -c core.whitespace=cr-at-eol diff --check` PASS. Actual mobile viewport is **NOT VERIFIED** in this environment.
- **Changed files:** `public/index.html`, `tests/product-feedback.test.cjs`, this handoff, `ROADMAP.md`. Production and Accounts/Auth code unchanged. Public brand/domain decision remains open; no branding/domain change made.

### Current next step

1. Stage-only bounded refresh/backfill after approving a request budget, then re-read freshness and current/upcoming coverage; keep completeness partial until pagination truly ends.
2. Prepare a separate production repair package for the missing provider budget caps and missing Sync budget schema; do not deploy until configuration, migrations, provider quota, backup, and owner approval are ready.
3. Recheck mobile viewport and owner-authenticated cloud favorites at a later review; do not infer these from automated tests.
# Rex.Bid — Project Handoff

## Final technical pre-cutover sprint — 2026-10-03 (stan aktualny)

### CURRENT STATE

- Checkout: `4e93be4 Prepare Rex.Bid production environment plan`. Zachowano nieśledzony `.codex-wrangler-cache/`; bez commit/push.
- **Production D1 READ-ONLY VERIFIED:** konto Tedn828 (`7ff5a57444667c4eda2a6a7f0fc4120d`), `rexbid-db` UUID `971879fe-04ed-4e8c-9dc6-5306980bb872`. Zastosowane dokładnie `0000_rexbid_base.sql` i `0001_auction_history_events.sql`. Tabele: `_cf_KV`, `d1_migrations`, `vehicles`, `vehicle_snapshots`, `auction_history`, `sqlite_sequence`; county legacy odpowiednio `0/0/0`; brak Accounts/Sync/media tables. Indeksy: `idx_vehicles_vin`, `idx_vehicles_lot`, `idx_vehicles_platform`, `idx_snapshots_vehicle`, `idx_history_vehicle`, `idx_history_date`, `idx_history_event_lookup` plus SQLite autoindexes. Legacy tables declare no foreign keys; `PRAGMA foreign_key_check` returned no rows. Żaden production write, migration, export ani deploy nie nastąpił.
- **Migration gap:** wymagane osobno zatwierdzone `0003_accounts_foundation.sql`, następnie `0004_d1_sync_2.sql`. Obecna proposal 0004 już zawiera `media_urls_json` i `media_thumbs_json`; nie stosować 0005 po niej.
- Production dry-run PASS: tylko `mtbid` + `rexbid-db`; D1-first=false, Cron brak, Auth settings/binding brak. Odczytano wyłącznie nazwę sekretu `APIBARA_API_KEY`, nie jego wartość. Budżety providera nadal fail-closed bez limitów i schematu Sync.
- **Staging telemetry/budgets:** `rexbid-auth-test` Version `df92bf78-e348-47bf-8b3a-f1ccf9144165`, wyłącznie D1 `rexbid-auth-test-db` UUID `acb3cb8e-69a2-459f-8a46-0f2f5b9004be`. `/health` i `/ready` 200; katalog/filtry HTTP 200 z `read_source=d1`, `catalog_complete=false`, oba scope partial; tail potwierdził D1 hit i `provider_fallback=false`. Anonimowe `/api/me`=401/no-store. Zero requestów Apibara/discovery/backfill.
- Staging D1 read-only: 380 sources/listings/snapshots; 80 rekordów ma URL-e i thumbnails; `users=1`, `user_favorites=1`. Wrangler raportuje 0005 pending mimo fizycznie obecnych obu kolumn — **nie uruchamiać `migrations apply`** przed uzgodnieniem historii.
- Początkowa propozycja produkcyjnych capów: 500/dzień (catalog 250, detail 150, history 60, discovery 30, media 10), suma 500. Nieaktywne; wymagają potwierdzonego quota Apibara i zgody właściciela. Retry off.
- **Produkcja nietknięta:** bez migracji, eksportu/backup, deployu, Auth, D1-first ani Cron.

### DONE

- Zdalny audit production schema/migration history/counts oraz config dry-run.
- Telemetry/budget code wdrożony na staging i zweryfikowany D1-only bez provider fallback.
- Runbooki migracji, backup, Auth i rollback zaktualizowane.

### OWNER ACTION (maks. 3)

1. Wybrać domenę kanoniczną i zatwierdzić domenę nadawcy/Resend.
2. Skonfigurować produkcyjny Supabase, SMTP/DNS, cookie secret, exact origins i Cloudflare limiter; sekrety wprowadzić wyłącznie w dashboardach.
3. Potwierdzić quota Apibara i zatwierdzić osobne okno na backup/restore rehearsal, migracje oraz ewentualny release.

### PRODUCTION CUTOVER ORDER

Wybór domeny → SMTP/Supabase/limiter → zaszyfrowany production export i odrębny restore rehearsal → zatwierdzone `0003` i readback → zatwierdzone `0004` i readback (bez 0005) → provider-backed deploy z Auth/D1-first/Cron OFF i zatwierdzonymi budgetami → smoke/monitoring → osobna aktywacja Auth → production D1 backfill/completeness check → osobna aktywacja D1-first → obserwacja → bounded scheduled sync jako ostatni krok.

## Production environment build — 2026-10-03 (kontynuacja od bd88ff1)

### CURRENT STATE

- Bazowy HEAD: `bd88ff1 Prepare Rex.Bid production cutover package`. Zachowano istniejące zmiany; `.codex-wrangler-cache/` jest wcześniej istniejącym, nieśledzonym katalogiem i pozostaje nietknięty.
- Produkcyjny target z lokalnego `wrangler.jsonc`: Worker `mtbid`, D1 `rexbid-db`, ID `971879fe-04ed-4e8c-9dc6-5306980bb872`. Staging target: `rexbid-auth-test` / `rexbid-auth-test-db`, ID `acb3cb8e-69a2-459f-8a46-0f2f5b9004be`.
- **Nie udało się uwierzytelnić Wrangler**: token Cloudflare wygasł; `whoami`, remote migration list i production D1 SELECT nie zostały ukończone. Nie twierdzić, że aktualne remote schema/county są znane. Żadna zdalna operacja produkcyjna nie została wykonana.
- `REXBID_D1_PRIMARY_READS=false`, produkcyjny Cron OFF, Auth fail-closed. Provider budgets mają tryb `required`, ale limity nie są ustawione, więc produkcyjny ruch providera fail-closed.

### DONE

- Konfiguracja i testy pilnują produkcyjnego D1-first OFF, Cron OFF oraz izolacji staging routes/identifiers.
- Przygotowano propozycję produkcyjnych provider caps, Resend/Supabase SMTP i domenowego cutoveru w `docs/PRODUCTION_CUTOVER_RUNBOOK.md`; nie utworzono usług ani sekretów.
- Lokalny Wrangler `4.145.0` zbudował production config przez `deploy --dry-run`: PASS, wskazując `mtbid`, `rexbid-db`/właściwy UUID i jawne `REXBID_D1_PRIMARY_READS=false`. `whoami` nadal nie działa z powodu wygasłego tokenu, więc konto i dostęp do zdalnej D1 pozostają niezweryfikowane. Dry-run nie wdraża.

### BLOCKED

- Read-only audyt zdalnej produkcyjnej D1, potwierdzenie historii migracji, schematu i countów czeka na re-auth Wrangler.
- Migration order wymaga ostrożności: proposal 0004 zawiera już `media_urls_json` i `media_thumbs_json`; nie stosować dodatkowo surowej migracji 0005 po takim 0004.
- Domena, produkcyjny Supabase, Auth limiter, SMTP/DNS, legal approval i uzgodnione provider quotas pozostają nieustawione.

### OWNER ACTION

1. Ponownie zalogować Wrangler w interaktywnym terminalu; po tym wykonać wyłącznie read-only audyt D1 i dry-run.
2. Wybrać finalną domenę/canonical host oraz zatwierdzić Resend jako SMTP wraz z nadawcą i DNS.
3. Zatwierdzić po audycie limity providera, strategię backupu/retencji i osobne okno na produkcyjne migracje/deploy.

### PRODUCTION CUTOVER ORDER

Read-only target/schema/migration audit → backup + restore rehearsal do odrębnej bazy → review i osobne zatwierdzenie 0003 → osobne zatwierdzenie 0004 (po sprawdzeniu kolumn mediów, bez duplikowania 0005) → konfiguracja domeny/SMTP/limiter/budżetów → staging E2E → owner approval → produkcyjne wdrożenie/flagowanie. Ta kolejność nie jest zgodą na cutover.

## Production blocker closure sprint — 2026-10-03 (local, not deployed)

- **Current checkout:** `def8b43 Prepare Rex.Bid release candidate staging`; existing local changes were retained. At sprint start the worktree already contained WIP edits to `providers/apibara.js`, `sync/d1-repository.js`, `worker.js`, `providers/request-budget.js`, plus the pre-existing untracked `.codex-wrangler-cache/`. Do not delete/cache-clean that path.
- **Remote restore rehearsal PASS:** staging D1 export was restored to separate temporary Cloudflare D1 `rexbid-restore-rehearsal-20261003-0809` (`6ed87387-7501-4a1c-8fa8-cdcc02c05779`), schema objects/counts/FKs compared, then only that temporary database and temporary export were removed. Staging source and production D1 remained untouched. See `docs/BACKUP_RECOVERY.md`.
- **Provider observability/budgets:** local code now emits safe per-real-fetch `rex.bid.provider_request` telemetry and per-public-read D1/fallback telemetry without VIN/PII. Atomic global + operation daily reservations fail closed before outbound fetch. Staging limits are proposed/configured in local Wrangler config: 500 global; catalog 250; detail 150; history 60; discovery 30; media 10. No provider requests were made and these edits were not deployed.
- Production config sets budget mode `required` without owner-approved cap values; provider traffic therefore intentionally fails closed until production schema/config/quotas are approved. Production Auth stays fail-closed; no production deploy/migration/Cron occurred.
- `docs/PRODUCTION_CUTOVER_RUNBOOK.md` consolidates restore, migration order, sync scheduler, SMTP comparison, domain cutover, rollback and owner actions. Legal drafts now explicitly identify non-official auction data, non-binding calculator estimates and third-party photos.
- **Automated verification:** `node --test` **310/310 PASS**; `scripts/partner-transport-rates.cjs --check`, `scripts/validate-worker-config.cjs`, ESM/CJS syntax checks and `git -c core.whitespace=cr-at-eol diff --check` PASS. Production and staging Wrangler dry-runs both built successfully and displayed only their exact configured Worker/D1 target. No staging deploy occurred; current staging remains historical Version `6c70674f-c164-404f-afc0-b1984ffe5549`.
- **Provider requests in this sprint:** 0 live Apibara requests. No reset mail, Auth live action, discovery, backfill, or scheduled execution was run.
- **Production status:** NOT DEPLOYED; migration `0003`, `0004`, and production media-column equivalent remain unapplied; provider budgets, final domain, custom SMTP, limiter, legal approval and cutover approval remain blockers.

## Final staging product review — 2026-10-03

- **Working checkpoint:** `6a69688 Complete Rex.Bid staging product milestone`; preserve local changes. Staging baseline Version `d86cef66-7683-42d6-8c75-32566f828a81`, Worker `rexbid-auth-test`, D1 `rexbid-auth-test-db` (`acb3cb8e-69a2-459f-8a46-0f2f5b9004be`). Production `mtbid`/`rexbid-db` was not targeted.
- Staging D1 last readback: Copart 260, IAAI 120; 380 sources/listings/snapshots; 0 confirmed events/entities; 80 listings have media URL/thumb references (40/platform); both scopes partial with separate cursors; users/favorites 1/1; legacy vehicle/history rows 0. No discovery/backfill/media enrichment is authorized in this review.
- Review found stale auction-date labels (generic open status presented as upcoming/live after its scheduled time), fabricated/dead account controls, an unconfigured contact form presenting a success state, and old English footer text. Local fixes are covered by regression tests; Home order is Current → Timed → Buy Now → Upcoming.
- **AUTOMATED VERIFIED:** `node --test` **300/300 PASS** after the fixes, syntax checks for changed JS, partner-rate generator `--check`, config validator and diff-check. Staging export was restored to disposable in-memory SQLite and counts matched (18 tables; users/favorites 1/1; sources/listings/snapshots 380; events/entities and legacy rows 0). It did not alter remote D1.
- Browser is anonymous. This pass cannot re-exercise login/logout/cloud merge/resend/export/recovery without owner credentials; earlier real-browser Auth login/account/favorites evidence remains valid. Password recovery is not retried because delivery previously failed/rate-limited; custom SMTP remains a production blocker.
- **Pending in this review:** staging deploy of these UI fixes and follow-up anonymous desktop/mobile browser checks. No production deploy/schema migration or Apibara calls. Scheduled sync remains disabled; only a bounded design is being prepared.

## Staging product milestone — przygotowanie lokalne (2026-10-01)

- Bazowy checkout: `32533d4`; staging-only zmiany są lokalne i nie zostały wdrożone. Ostatni znany stan staging D1 to 220 Copart + 80 IAAI listings/sources/snapshots, oba scope partial; counts nie zostały ponownie odczytane w tym przebiegu.
- Przygotowano kontrolowaną kampanię backfill `campaign-product-milestone-32533d4`: maksymalnie 20 nowych requestów Apibara łącznie, po 10 na platformę, maksymalnie 4 strony (20 rekordów/stronę) na pojedyncze uruchomienie, bez retry. Trwały wspólny budżet kampanii oraz osobne budżety platform zapobiegają przekroczeniu limitu przy równoległym starcie Copart/IAAI.
- Przygotowano staging-only, addytywne kolumny `media_urls_json` i `media_thumbs_json` (migracja `migrations-staging/0005_listing_media_urls.sql`). Repository przechowuje wyłącznie bezpieczne HTTPS URL-e, bez surowego payloadu i bez binarnych zdjęć; partial update pustymi listami nie usuwa wcześniej zapisanych URL-i. Migracja stagingowa NIE została zastosowana.
- D1-first list query obsługuje teraz search po VIN/LOT/title/make-model i przekazuje zaawansowane filtry do canonical repository. Partial scope nadal zwraca wyłącznie znane rekordy i metadata niekompletności.
- **AUTOMATED VERIFIED:** `node --test` 290/290, syntax checks, partner-rate generator `--check`, config validator i `git -c core.whitespace=cr-at-eol diff --check` PASS. Podwyższony dry-run Wrangler PASS i wskazuje wyłącznie staging D1 binding; nie wymagał uwierzytelnienia. **STAGING DEPLOY, READBACK, BACKFILL I REAL BROWSER QA: NOT VERIFIED** — `wrangler whoami` wykrył wygasłą sesję; nie wykonano żadnego live requestu Apibara w tej pracy.
- Następny krok po odnowieniu Wrangler: potwierdzić konto i dokładne staging bindings, zastosować wyłącznie migrację staging 0005, wykonać dry-run i deploy `wrangler.staging.jsonc`, sprawdzić /health oraz D1 readback, a następnie wykonać backfill z panelu stagingowego; monitorować licznik wspólnej kampanii i zatrzymać się przy 20/20 lub wcześniejszej kompletności scope.

## Staging public API D1-first cutover — 2026-10-01

- **STAGING VERIFIED.** Final Worker `rexbid-auth-test` Version `a6569e87-47be-4039-af7c-cd36374afdde` is bound only to `rexbid-auth-test-db` (`acb3cb8e-69a2-459f-8a46-0f2f5b9004be`) with `REXBID_D1_PRIMARY_READS=true`. Production `worker.js` and `wrangler.jsonc` remain provider-backed and contain no enable flag.
- `staging/d1-primary-reads.cjs` handles staging `/api/cars`, `/api/filters`, `/api/car/:identifier`, and history. Activation requires exact HTTPS host `rexbid-auth-test.tedn828.workers.dev`, staging UI/host/D1-target guards, and the flag.
- Listing and filter responses expose known D1 rows only and explicitly mark `catalog_complete=false`, `metadata_complete=false`, `known_rows_only=true`, plus global Copart/IAAI scope coverage. A platform query does not hide the other platform's partial scope.
- A fresh usable detail is served from D1; missing, ambiguous, stale, or incomplete detail delegates to the existing provider API. Stale detail is merged with provider fields without replacing known D1 values with null/empty values. History returns observed snapshots separately from confirmed auction events; stale/missing history delegates rather than inventing events.
- Current D1 freshness defaults: detail 24 hours, history 6 hours. These are staging controls, not production SLA. Responses bypass shared caching (`private, no-store`) while the cutover is being validated; account/auth responses remain private/no-store.
- Immediate rollback: set `REXBID_D1_PRIMARY_READS=false` in `wrangler.staging.jsonc` and redeploy only with `wrangler.staging.jsonc`; the wrapper then delegates to the original provider-backed `rexWorker`. No D1 data deletion is required. To restore D1-first, set it to `true` and redeploy staging after verifying target name/ID.
- Staging D1 starting inventory remains Copart 220 and IAAI 80 listings/sources/snapshots, both partial with independent cursors; events/entities 0; users/favorites 1/1; legacy tables 0. The 300 rows are a known subset, never a claim of full market coverage.
- `/api/cars` D1 read, `/api/filters`, IAAI detail, and fresh IAAI snapshot history returned HTTP 200 from D1. Responses identified both scopes as partial, kept `catalog_complete=false` and `metadata_complete=false`, and stayed `private, no-store`. The car page and Home rendered in the real browser; the exact-host badge showed `D1 catalog: partial`.
- Filter smoke after fixing query mapping returned D1-only results for Open, Buy Now, Timed and upcoming/without filters. No completeness claim is made; current scopes remain Copart 220 and IAAI 80, both partial with separate cursors.
- One stale Copart detail (age above 24h) used `hybrid` with `fallback_reason=d1_detail_stale`; fresh IAAI detail/history stayed D1-only. Provider fallback was not used for ordinary Home/list/filter reads.
- Rollback was deployed and checked on staging: with flag `false`, one `/api/cars` request returned the original provider-backed response; then the flag was restored to `true` and D1-first was redeployed. Total controlled provider-backed reads in this verification: **2** (Copart detail fallback and rollback list read); no discovery/backfill.
- External staging HTTP timings were ~470–1,100 ms for D1 list/filter/detail/history and ~728 ms for the stale Copart hybrid request. Worker-side logged duration was ~0–2 ms for D1 list/detail/history and ~237 ms for the hybrid route. These are a few smoke observations, not a benchmark. Browser console internals were not exposed by the available browser-control surface; no visible page failure was observed.
- Offline cutover tests cover guards, partial lists/filters, frontend filter semantics, both platform details, missing/stale fallback, snapshot/event distinction, D1 error fallback, and flag-off rollback. Full suite: **285/285 PASS**; syntax checks, partner data `--check`, and `git diff --check` pass.

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

### Staging Product Milestone — media pipeline + final QA (2026-10-01)

- **STAGING DEPLOYED:** Version `33cbab87-506b-4714-81c6-455dc32a76d8`, deployed only with `wrangler.staging.jsonc`; binding is `rexbid-auth-test-db` (`acb3cb8e-69a2-459f-8a46-0f2f5b9004be`). Cloudflare account was Tedn828. Production Worker/D1 were not targeted.
- **Migration 0005:** applied remotely only to `rexbid-auth-test-db`. It adds nullable `media_urls_json` and `media_thumbs_json`; existing listings, snapshots and account rows were retained. Latest direct readback: 260 Copart + 120 IAAI listings/sources, 380 snapshots, 0 events/entities, `users=1`, `user_favorites=1`; duplicate listing/source identity count 0. Both scopes remain partial with cursors. Media URL/thumb arrays are populated on 40 listings per platform (80 total); 300 older listings have no stored media references.
- **Catalog regression fixed:** real D1 stores the canonical state in `auction_state` while `source_status` contains the provider's date text. The staging query adapter had applied the requested `lot_sub_status=Open` to both columns, making “Aktualne” empty. It now filters canonical state only unless an explicit `source_status` parameter is supplied. Automated regression now uses the real date-shaped source status. Real browser shows the expected 20 known open IAAI rows; no completeness claim is made.
- **Media pipeline root cause:** Apibara adapter already maps `media.items`/`media.thumbs` into canonical media, and the shared sync core/D1 repository/read repository/API preserve validated HTTPS references. Real D1 now has 40 media-bearing listings per platform, proving list/discovery→canonical→D1 persistence and readback for those records. The old `rawOrMediaStored=false` diagnostic conflated “no raw payload/binary image stored” with permitted URL references; it falsely implied no media references were persisted. Replaced locally with separate `rawPayloadStored=false`, `binaryMediaStored=false`, and media URL counts. Raw discovery bodies are intentionally not retained, so their original serialized provider fields cannot be inspected retrospectively. Browser QA then found a separate gallery bug: the car page treated canonical parallel `media.items` and `media.thumbs` as separate photos, so one Copart D1 record with 13+13 refs appeared as 26 images. The gallery normalizer now pairs URLs/thumbs by position.
- **Real browser:** Home loaded known D1 listings and retained the subtle partial badge. Before the gallery fix, the fresh Copart D1 record rendered 26 entries from 13 full URLs + 13 thumbnails; IAAI record rendered 17 from 17 full URLs + 16 thumbnails (imageKeys deduplicated). A narrow mobile-style viewport was legible with no horizontal overflow observed. After the gallery-normalizer change the site was redeployed; post-fix real-browser gallery count remains to be confirmed. Catalog showed a vehicle thumbnail, though visual confirmation that the sampled card was one of the media-populated rows is NOT conclusive. Calculator V3 remained explicitly incomplete without zero-filling. Desktop viewport and browser console/Network inspection were unavailable.
- **Data and request safety:** direct readback only; this continuation executed no discovery/backfill and intentionally initiated 0 Apibara requests. No raw provider payload or binary images were stored/downloaded. Public detail pages can use the existing guarded fallback for stale/missing fields; exact fallback-call count was not captured, so it is NOT VERIFIED. Fresh D1 media-bearing rows meet the D1-first freshness rule and do not need a provider call to render their gallery.
- **Validation/deploy:** 294/294 tests PASS before gallery fix; focused media-normalizer tests pass after the fix. Final full-suite run and staging deployment are pending the gallery fix. Prior staging deploy was Version `4ed7d98b-7ab9-41db-9f15-3f1e463b45dc`; its bindings identified only `rexbid-auth-test-db`. Production Worker/D1 remain untouched; no migration was run during this pass.
- **NOT VERIFIED:** the 300 older rows without media references were not enriched; no additional detail calls were made. Desktop viewport, catalog thumbnail visual confirmation, browser console/Network, and exact provider fallback count remain unverified. No authenticated actions were performed in this pass.
- **Continue:** if additional media coverage is desired, plan a separate bounded detail-enrichment budget by platform. Do not rerun discovery just to populate media; never persist original image bytes.

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

### Final Product Milestone media QA — 2026-10-01 (supersedes pending status above)

- **STAGING ONLY:** final Worker `rexbid-auth-test`, Version `d86cef66-7683-42d6-8c75-32566f828a81`; Wrangler identity Tedn828 (`7ff5a57444667c4eda2a6a7f0fc4120d`), D1 `rexbid-auth-test-db` (`acb3cb8e-69a2-459f-8a46-0f2f5b9004be`). Dry-run/deploy bound only to staging. Production `mtbid`/`rexbid-db` were not touched.
- **Direct D1 readback after deployment:** 260 Copart + 120 IAAI listings/sources; 380 initial snapshots; 0 events; 0 physical vehicle entities; 80 listings with media URL arrays and 80 with thumbnail arrays (40 per platform); 0 duplicate provider/platform/provider-vehicle IDs; `users=1`, `user_favorites=1`. SELECT metadata: `changed_db=false`, `rows_written=0`. No migration, cleanup, discovery or backfill ran.
- **Media root cause/fix:** 80 existing rows prove URL references passed discovery canonicalization, persistence and D1 readback; 300 older rows contain no media refs. `rawOrMediaStored=false` only meant no raw payload/binary media and was misleading about URL refs. Gallery code counted 13 full URLs and their 13 paired thumbnails as 26 images. During extraction, a cache-busted browser load also exposed `isHttpUrl is not defined` because other car-page code still used that helper. Final code makes canonical `media.items` authoritative, pairs thumbs by index, and exports/reuses the shared HTTPS URL validator.
- **REAL BROWSER VERIFIED:** Copart LOT 73650295 now shows 13/13 images (not 26); IAAI LOT 44803631 shows 17/17. IAAI next-image and lightbox open/close passed. Home rendered known D1-backed current, Buy Now and upcoming sections with loaded thumbnails; Timed Auction had no rows in this partial sample. Catalog rendered 20 known D1 offers with remote images. Calculator V3 remained visibly incomplete without false zeroes. Guest favorite add/remove passed; state was restored to `Ulubione 0`.
- Desktop CSS viewport 1350×900 and mobile 375 px wide had no horizontal overflow. Mobile car card retained all 17 gallery entries and Calculator V3. Authenticated cloud favorites were not retested because the browser session was anonymous. Browser DevTools console/Network and exact automatic provider-fallback count were unavailable; do not claim an exact fallback count. The tested known detail rows were fresh D1 records.
- No Apibara discovery/backfill/detail-enrichment request was intentionally initiated: **0 intentional Apibara requests in this pass**. Remote URL references only; no original binary media stored. The 300 rows without URLs remain unenriched.
- **AUTOMATED:** `node --test` 299/299 PASS; partner rates generator `--check`, config validator, syntax checks and `git -c core.whitespace=cr-at-eol diff --check` PASS. No commit/push. Staging media/gallery portion is ready for checkpoint; this does not mean production launch readiness.
# Final staging release-candidate review — 2026-10-03 (supersedes earlier pending staging QA)

## CURRENT STATE

- Latest staging Worker: `rexbid-auth-test`, Version `6c70674f-c164-404f-afc0-b1984ffe5549`; exact staging D1 binding `rexbid-auth-test-db` (`acb3cb8e-69a2-459f-8a46-0f2f5b9004be`). No production deploy, production D1 migration, discovery, or backfill was performed in this review.
- Staging D1 read-only counts: Copart 260 and IAAI 120 sources/listings; 380 snapshots; events/entities 0; 80 listings have media URL/thumb metadata; duplicate provider identities 0; users/favorites 1/1; legacy vehicle/history rows 0. Both scopes remain partial with separate cursors. These are known staged records, not a complete market catalog.
- Health/readiness, staging noindex, private cache headers, safe 404 and anonymous `/api/me` were smoke-checked. `/ready` reported D1/assets/provider configuration and enabled staging Auth without exposing secrets.
- A staging export imported into disposable in-memory SQLite matched 18 tables and key counts. This verifies export/import semantics only; remote Cloudflare D1 restore to a separate D1 remains unverified.
- Product UI browser review passed for Home, VIN/LOT search, platform catalog, Copart/IAAI D1 detail, images/gallery, history, guest favorite add/remove, Calculator V3 incomplete-state handling, login form render and anonymous account state. Desktop/mobile widths had no horizontal overflow; no JS console exceptions were observed on reviewed pages. Final browser QA found and fixed the auction-location state selector reading auction state (`finished`) instead of branch state; final IAAI card now shows `PA`.
- Prior owner-run staging Auth E2E for login/session/cloud favorites/logout remains evidence. This pass did not repeat credentialed login, account export, resend, recovery, or authenticated favorites; those flows are not newly verified here.

## DONE

- Staging D1-first and bounded multi-platform data path remain enabled; Home/catalog/fresh known details were observed using D1. Both platform scopes partial; completeness is not claimed.
- Calculator V3 displays partner transport estimates with standard/conservative scenarios and leaves unknown costs incomplete rather than zero-filled.
- Legal policy drafts exist under `docs/legal/` and require owner/legal review.
- Automated suite and operational validators are to be rerun at this final checkpoint; see current task report.

## BLOCKED / OWNER ACTION

- Do not launch production Accounts until production Supabase project/origins/secrets, custom SMTP and deliverability, production limiter, and migration `0003` are approved and tested. Production `0003` remains unapplied.
- Select and own the canonical Rex.Bid domain before DNS, canonical/sitemap and Supabase callback changes. No domain/DNS changes were made.
- Owner/legal review is required for legal drafts, privacy/retention, auction data presentation, and provider/auction-site terms. Apibara permits factual data/history/URL storage; permanent archival of original Copart/IAA photos is not approved.
- Validate remote Cloudflare D1 restore to a separate test D1; the SQLite rehearsal is not a remote restore rehearsal.
- Exact provider fallback count, full DevTools Network export, password recovery/resend, account export download, and authenticated multi-tab refresh behavior were not verified in this pass. History may use controlled provider fallback; do not claim zero upstream reads for browser QA.
- Scheduled sync is not activated. Any future schedule needs explicit bounded per-platform budgets, observability/alerts, leases and a disable switch; no Cron was enabled here.

## PRODUCTION CUTOVER ORDER

1. Owner/legal decisions, canonical domain and final legal content.
2. Production-only config/secrets/limiter and SMTP; validate fail-closed behavior.
3. Backup and separate-DB remote restore rehearsal; approve and validate production migration plan (`0003` Accounts and any separately approved sync schema).
4. Staging parity smoke, browser QA, privacy/security review and bounded monitoring rehearsal.
5. Owner approval, then a separate production deploy/migration change with rollback trigger and post-deploy smoke. Never promote staging bindings or flags by accident.
