# Rex.Bid — gotowość do kontrolowanego publicznego uruchomienia

## Final technical pre-cutover update — 2026-10-03

- **Production D1 READ-ONLY VERIFIED:** Cloudflare Tedn828; `rexbid-db` / `971879fe-04ed-4e8c-9dc6-5306980bb872`; only migrations 0000/0001; legacy counts `vehicles=0`, `vehicle_snapshots=0`, `auction_history=0`; Accounts/Sync/media schemas absent. No production mutation, export or deployment.
- **Production config preflight PASS:** dry-run targets only `mtbid` and `rexbid-db`; assets present; D1-first false; Auth OFF/fail-closed; Cron absent. Secret-name listing found only `APIBARA_API_KEY`; its value was not accessed. Production provider calls stay fail-closed without caps and Sync schema.
- **Staging telemetry STAGING VERIFIED:** Version `df92bf78-e348-47bf-8b3a-f1ccf9144165`; health/readiness 200; catalog/filters use D1 and state partial scope; tail confirms D1 hit and no fallback. No Apibara requests.
- Exact production migration gap is proposal 0003 then proposal 0004. Current 0004 includes media URL columns, so separate 0005 is not required. Staging Wrangler history says 0005 pending despite columns existing; reconcile before a future staging migration.
- Proposed initial hard cap: 500/day total (250 catalog, 150 detail, 60 history, 30 discovery, 10 media), inactive pending quota and owner approval.

## Aktualizacja finalnego przeglądu stagingu — 2026-10-03

Cel sprintu to release candidate do przeglądu właściciela, nie publiczny launch. Staging pozostaje `rexbid-auth-test` / `rexbid-auth-test-db`; produkcja jest nietknięta. D1-first, Calculator V3 i Accounts staging mają wcześniejsze weryfikacje opisane w handoffie. Bieżące lokalne poprawki UX mają 300/300 testów, ale muszą być wdrożone i ponownie sprawdzone przed oznaczeniem ich jako staging-verified.

Staging D1: 260 Copart + 120 IAAI, oba scope partial; media URL/thumb refs na 80 listingach; 380 snapshots; zero events/entities; users/favorites 1/1. Nie jest to pełny rynek. Scheduled sync nie jest aktywny.

Rehearsal backupu stagingu do disposable in-memory SQLite przeszedł count validation; remote restore i production restore pozostają nieweryfikowane.

Drafty privacy, terms, cookies/analityki, danych aukcyjnych i kalkulatora znajdują się w `docs/legal/`; wszystkie wymagają owner/legal review i nie są publikowane.

### Domenowy i pocztowy cutover — checklista właściciela

- [ ] Wybrać i zatwierdzić domenę Rex.Bid; potwierdzić Cloudflare zone, rekordy DNS i osobę wykonującą zmiany.
- [ ] Włączyć HTTPS oraz sprawdzić HTTP→HTTPS i host-only `__Host-` cookies.
- [ ] Ustawić canonical origin; zaktualizować canonical URLs, sitemap, robots, noindex stagingu i Supabase Site URL/Redirect URLs.
- [ ] Wybrać nadawcę SMTP i potwierdzić domenę nadawczą; opublikować SPF, DKIM i uzgodnioną politykę DMARC.
- [ ] Ustalić From/Reply-To, confirmation/reset templates, limity i właściciela monitoringu delivery/bounce/complaints.
- [ ] Po SMTP wykonać jeden kontrolowany test confirmation i password reset na stagingu; nie ponawiać żądań przy limitach dostawcy.
- [ ] Zatwierdzić privacy/terms/cookies oraz kontakt; draftów nie publikować jako finalnych.

### Synchronizacja automatyczna — status

Projektuj bounded scheduled discovery z niezależnymi Copart/IAAI scope, limitami per run i kampanię, atomowym budżetem, lease, checkpointem każdej strony, ograniczonym retry/backoff i osobnym budżetem selektywnego media URL enrichment. HOT/WARM/COLD pozostają konfigurowalnymi priorytetami. **Cron/Queue pozostaje wyłączone** do zatwierdzenia budżetu i monitoringu.

Stan na 2026-09-29. To przegląd infrastruktury i kodu, nie zgoda na produkcyjny deploy.

## DONE

- Oddzielne konfiguracje Worker/D1 dla `mtbid` i `rexbid-auth-test`; automatyczny guard wykrywa zamianę targetów.
- `/health` jest liveness-only; `/ready` bez live provider call sprawdza D1, asset, konfigurację providera i Auth tylko gdy Auth jest włączony.
- Security headers, no-store dla prywatnych HTML/API, noindex stagingu i podstawowy sitemap/robots.
- Produkcyjny Auth fail-closed; door-to-door estimator jest filtrowany z produkcyjnego `car.html`, staging-only test UI nie jest normalną nawigacją.
- Branded 404 i bezpieczny ogólny 500; bez stack trace w odpowiedzi.
- Neutralne event names i pola są opisane bez zewnętrznej analityki/PII.
- D1 Sync Phase A DONE, Phase B D1 VERIFIED, Phase C SHADOW VERIFIED; Phase D NOT STARTED. Dane Sync po testowym shadow run zostały wyczyszczone.
- Staging infra smoke po końcowym routingu Worker-first na Version `9ce6f2ab-b7f4-4ab2-b31d-663089bd1f0b` potwierdził `/health`, `/ready`, prywatne API no-store, bezpieczne 404, staging robots `Disallow: /` + noindex, staging sitemap 404 + noindex oraz oba prototype JS jako 404.

## BLOCKED

- Brak wybranego docelowego `REX.Bid` DNS/origin. Obecny origin workers.dev jest techniczny; sitemap/canonical trzeba zmienić po zatwierdzeniu domeny.
- Publiczne API nie ma aktywnego centralnego rate limitingu dla katalogu. Ustal limity i uruchom dopiero po decyzji oraz weryfikacji kosztu.
- Monitoring operacyjny, alerty i procedura dyżuru nie są potwierdzone produkcyjnie.
- Procedura backupu jest opisana, ale restore rehearsal i harmonogram kopii wymagają wykonania i zatwierdzenia.
- Produkcyjna D1 ma niezaaplikowane `0003`/`0004`; Auth i D1 Sync nie są wdrożone.

## OWNER DECISION

- Domena i DNS; polityka cookies/consent; prywatność/regulamin; czy i kiedy aktywować Accounts.
- Limitowanie publicznych tras i ewentualny płatny Cloudflare product.
- Harmonogram/retencja backupów i uprawnione miejsce ich przechowywania.
- Docelowe kanały kontaktu, wsparcie i procedura obsługi usunięcia konta.

## LEGAL

- Apibara factual vehicle/auction data, ended-auction history, snapshots, derived data and commercial display permission is recorded in `docs/APIBARA_DATA_RIGHTS.md`; this blocker is closed for those data. Permanent archiving/redistribution of original Copart/IAA photos remains NOT APPROVED by this response.
- Warunki przechowywania i prezentowania danych aukcyjnych Copart/IAA wymagają przeglądu.
- Polityka prywatności, regulamin, cookies, retencja, eksport/usunięcie konta i dane poza EOG wymagają decyzji prawnej.
- Koszty importu są częściowo prototypowe/konfigurowalne; nie mogą być przedstawiane jako oferta ani urzędowa kalkulacja.

## EXTERNAL DEPENDENCY

- SMTP produkcyjne: domena nadawcy, SPF, DKIM, DMARC, From/Reply-To, confirmation/reset templates, limity, bounce/delivery monitoring.
- Supabase produkcyjny: URL/key, callback allowlist, cookie secret, origin i limity. Nie konfiguruj service-role bez osobnej zgody.
- Dostawcy transportu/importu muszą przekazać aktualne cenniki i założenia.
- Przy docelowej domenie: DNS, HTTPS, redirect/canonical/sitemap, sender domain.

## Produkcyjne testy wymagane przed launch

- Restore rehearsal w stagingu, finalny backup i checklist review.
- Real-browser smoke dla Home/katalogu/pojazdu na docelowej domenie i desktop/mobile.
- Ograniczony API smoke i potwierdzenie budżetu Apibara.
- Weryfikacja `/ready`, monitoring i alarmy.
- Jeśli Accounts: osobna migracja zatwierdzona i przetestowana, limiter, SMTP, polityki prawne, E2E na stagingu oraz osobna zgoda na produkcyjny cutover.

## Neutralne event hooks (kontrakt, bez wysyłania)

Nazwy: `search_submitted`, `vehicle_opened`, `favorite_added`, `favorite_removed`, `login_succeeded`, `login_failed`, `calculator_interaction`. Dozwolone właściwości: typ akcji, platforma, kategoria wyniku, page type i anonimowy correlation ID. Zakazane: email, VIN/LOT, cookie/token, surowe filtry, dokładna cena zakupu i treść formularza. Brak zewnętrznego dostawcy analityki i brak emisji w tej zmianie.

## Top 10 blokad publicznego launchu

1. Zatwierdzona domena REX.Bid, DNS, HTTPS i aktualizacja callback/canonical/sitemap.
2. Independent Copart/IAA platform terms and permanent original-photo storage/redistribution rights; Apibara factual data permission is documented.
3. Zatwierdzone privacy, terms, cookies, retention oraz procedury konta/export/delete.
4. Produkcyjny SMTP z domeną nadawcy, SPF/DKIM/DMARC i delivery/bounce monitoring.
5. Decyzja o uruchomieniu Auth oraz production Supabase/sekrety/allowlist.
6. Osobno zatwierdzona migracja D1 0003 i backup/rollback; dziś NOT APPLIED.
7. Cloudflare Auth rate-limit binding oraz strategia limitów dla publicznych API.
8. Test odtworzenia backupu i zatwierdzona retencja/kontrola dostępu do kopii.
9. Produkcyjny monitoring, alerty, ownership i incident runbook.
10. Potwierdzone źródła/opłaty kalkulatora; door-to-door prototype pozostaje niewidoczny w produkcji do zatwierdzenia.

## Limity API — propozycja do zatwierdzenia (nieaktywna)

| Trasa | Klucz/scope | Początkowy limit do testu | Uwagi |
|---|---|---:|---|
| `/api/cars` | IP/colo + route | 60/min | Współdzielone cache; test burst i normalnego scroll/pagination |
| `/api/filters` | IP/colo + route | 20/min | Długi cache; zwykłe użycie powinno być znacznie niższe |
| `/api/car/:identifier` | IP/colo + route | 30/min | Nie umieszczać identyfikatora w logowanym kluczu |
| `/api/car/:identifier/history` | IP/colo + route | 10/min | Kosztowniejsze; nie łączyć z automatycznym page prefetch |
| `/api/auth/*` | istniejący per-operation IP/user scopes | ustalić per operację | Wymagany binding przed Auth production; nie blokować po samym emailu |

To są wartości startowe do obciążeniowego testu i strojenia, nie zatwierdzone SLA. Cloudflare Rate Limiting ma ograniczenia per colo/eventual; użyć cache, Supabase limits, alertów i stopniowego rollout. Nie dodano namespace/bindingu ani nowej płatnej zależności w tej zmianie.
# Final owner-review status — 2026-10-03

## DONE — staging evidence

- Latest staging Worker `rexbid-auth-test` Version `6c70674f-c164-404f-afc0-b1984ffe5549`, bound to staging D1 only. Health/readiness, noindex, private API cache, safe 404 and anonymous `/api/me` smoke passed.
- Desktop/mobile real-browser review covered Home, catalog, exact VIN/LOT, Copart/IAAI detail, galleries, history, guest favorites and Calculator V3. Known D1 records render without claiming complete market coverage. A branch-state display bug was fixed and regression-tested.
- Staging data remains partial: 260 Copart + 120 IAAI listings, 380 snapshots, 80 media URL/thumb records, zero events/entities, users/favorites 1/1. No production data touched.
- Calculator keeps unconfirmed auction/import/tax/logistics charges incomplete; it does not present missing costs as zero or a guaranteed door-to-door quote.

## BLOCKED / OWNER DECISION / EXTERNAL DEPENDENCY

- Production is **NOT DEPLOYED**. Production Accounts remain fail-closed; migration 0003 is not applied to production.
- Canonical domain and DNS/HTTPS/canonical/sitemap/Supabase redirect URLs are not selected or changed.
- Production Supabase project, cookie secret/origins, custom SMTP and verified sender (SPF/DKIM/DMARC), delivery monitoring and production rate limiter need owner configuration and validation.
- Remote staging Cloudflare D1 restore rehearsal **PASS**: export was imported into a separate disposable remote D1 and schema/count/FK checks passed. Before production, still define encrypted backup storage/retention and run a production-target rehearsal only under a separately approved plan; never restore over `rexbid-db` during rehearsal.
- Legal drafts in `docs/legal/` require owner/legal review. Confirm terms for auction-site data independently; Apibara permission does not license permanent redistribution of original Copart/IAA photographs.
- Scheduled provider sync is not activated. Local fallback/provider telemetry and fail-closed budgets pass automated tests but are **not deployed** in this sprint. Exact browser-triggered fallback count and full DevTools Network evidence remain unverified; history may invoke controlled provider fallback.

## Production domain checklist

After owner selects the domain: Cloudflare DNS ownership/proxy and HTTPS; Worker custom-domain mapping; canonical and sitemap host; production robots policy (do not inherit staging noindex); Supabase Site URL and exact callback/redirect allowlist; email sending domain with SPF/DKIM/DMARC, From/Reply-To and delivery monitoring; then staging-equivalent smoke and owner approval. Do not buy a domain or change DNS without explicit approval.
# Zamknięcie blockerów — stan po review 2026-10-03

## DONE

- Staging export → osobna zdalna Cloudflare D1 → schema/count/FK comparison: PASS; testowa baza i pliki tymczasowe usunięte.
- Lokalny kod bezpiecznej per-request telemetrii providera oraz D1/fallbacków i atomowego globalnego/per-operation request budgetu przechodzi testy; nie wdrożono go w tej turze. Produkcyjne limity nadal wymagają zatwierdzenia.
- Kolejność migracji i rollback opisano w `docs/PRODUCTION_CUTOVER_RUNBOOK.md`.

## BLOCKED

- Production D1 migracje 0003/0004/0005 nie są zastosowane. Production Auth/D1-first/Cron nie są włączone.
- Produkcyjne provider budget caps nie zostały wybrane; production config wymaga `required` i fail-closed bez capów/budżetowego schematu.
- Remote staging restore rehearsal przeszedł. Pozostają szyfrowanie/retencja backupów produkcyjnych oraz zatwierdzona procedura backupu/restore dla `rexbid-db`.
- Recovery email/custom SMTP, final-domain redirect i delivery monitoring nie są zweryfikowane.

## OWNER DECISION / EXTERNAL / LEGAL

- Wybrać domenę i canonical host; SMTP dostawcę/nadawcę; production Apibara caps i retry policy; aktywację kolejnych migrations/Auth/D1-first/sync.
- Przejrzeć legal drafts. Danych aukcyjnych nie przedstawiać jako gwarantowanych/oficjalnych Copart/IAA. Kalkulator to niewiążący szacunek; fotografie są third-party media.
- Apibara zgodziła się na trwałe factual/history/snapshot data i komercyjne wykorzystanie; archiwizacja binarnych oryginałów zdjęć pozostaje niezatwierdzona.

Szczegóły, checklisty i maksymalnie pięć działań właściciela: `docs/PRODUCTION_CUTOVER_RUNBOOK.md`. Ta aktualizacja nie jest zgodą ani rekomendacją na produkcyjny deploy.
# Production build update — 2026-10-03

## DONE

- Production config jawnie trzyma `REXBID_D1_PRIMARY_READS=false`; Cron nie jest skonfigurowany, Auth pozostaje fail-closed, a brak provider capów z `REXBID_PROVIDER_BUDGET_MODE=required` blokuje upstream requesty.
- Validator offline potwierdza separację `mtbid`/`rexbid-db` i `rexbid-auth-test`/`rexbid-auth-test-db`, flagę D1-first OFF i Cron OFF. To walidacja plików, nie zdalny audyt.
- Przygotowano Resend/Supabase, domenę, migracje, backup i obserwowalność w `docs/PRODUCTION_CUTOVER_RUNBOOK.md`.

## BLOCKED

- Production D1 read-only schema/migration/count audit **NOT VERIFIED**: Cloudflare Wrangler token wygasł; `whoami` nie przeszedł. Nie wykonano żadnego production SELECT, migration, deploy ani zmiany sekretu.
- Lokalny production Wrangler dry-run zakończył się PASS i wskazał `mtbid` / `rexbid-db` oraz D1-first OFF. To build/config check, nie zdalna autoryzacja. `whoami` nadal wymaga re-auth; przed remote audit ponownie uwierzytelnić konto.
- Provider limits, limiter, finalna domena, production Supabase, SMTP i legal review wymagają konfiguracji/zatwierdzeń; przykładowe limity z runbooka są nieaktywne.
- Proposal 0004 już dodaje media columns; migracji 0005 nie wolno dublować bez zmiany/inspekcji schematu.

**Wniosek:** brak zgody ani gotowości do production cutover. Pierwszym krokiem właściciela jest re-auth Wrangler; kolejnym bezpiecznym działaniem będzie wyłącznie read-only D1 audit.
# Production catalog recovery — 2026-10-03

## Stan potwierdzony

- Produkcyjne `/api/cars` i `/api/filters` zwracają HTTP 500; bezpośredni read-only audit wykazał migracje tylko 0000/0001, brak tabel budżetowych i 0 legacy vehicle/history rows. Runtime wymagający D1-backed provider budgets zamyka publiczny read przed upstream fetch.
- Minimalny kod naprawczy jest przygotowany lokalnie: migracja addytywna `0002_provider_read_budgets.sql`, read-only caps 500 global/250 catalog/150 detail/60 history/0 discovery/0 media, sync writes jawnie OFF. To nie jest wdrożone. Produkcja pozostaje w aktualnym stanie 500.
- Do przywrócenia produkcyjnego katalogu wymagane jest zatwierdzenie i zastosowanie 0002 oraz osobny Worker deploy. Produkcyjna D1 i Worker nie zostały zmienione.
- Staging public read zwraca 200 z D1, ale katalog jest partial/stale (260 Copart + 120 IAAI); bez refresh nie stanowi bieżącego feedu.
