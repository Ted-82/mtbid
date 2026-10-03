# Rex.Bid — checklista wdrożenia produkcyjnego

## Bramka domeny, Auth i SMTP — uzupełnienie 2026-10-03

- [ ] Zatwierdzić domenę, DNS zone, HTTPS, canonical origin, sitemap/robots przed zmianą originów.
- [ ] Ustawić Supabase Site URL i ścisłą listę callback/redirect URLs dla finalnej domeny; bez wildcardów.
- [ ] Skonfigurować zatwierdzony SMTP: SPF, DKIM, DMARC, From/Reply-To, confirmation/reset templates, limity oraz monitoring bounce/delivery.
- [ ] Opublikować wyłącznie owner/legal-approved privacy, terms, cookies i auction/calculator disclaimers; `docs/legal/*_DRAFT.md` są szkicami.
- [ ] Dla Accounts osobno zatwierdzić migration 0003, production Supabase/cookie secret/origins, Cloudflare Auth rate limiter i real-browser E2E. Brak dowolnego wymogu oznacza Auth OFF.
- [ ] Ustalić limity/alerty provider calls i fallbacków; nie aktywować Cron bez twardego budżetu.
- [x] Remote staging D1 export/import rehearsal do osobnej tymczasowej Cloudflare D1: schema/count/FK PASS; temporary DB/export removed.
- [ ] Potwierdzić szyfrowanie/retencję backupu oraz zatwierdzony production backup/restore plan. Staging rehearsal nie jest production restore rehearsal.

Ta lista jest wymaganym runbookiem. Sam fakt przejścia `node --test` nie oznacza zgody na deploy. Konta i D1 Sync nie są częścią zwykłego wdrożenia strony.

## Przed wdrożeniem

- [ ] Potwierdź branch, HEAD, czysty/uzgodniony diff i zakres plików.
- [ ] `node --test`, `git -c core.whitespace=cr-at-eol diff --check`, kontrola składni oraz `node scripts/validate-worker-config.cjs`.
- [ ] Odczytaj target produkcyjny z `wrangler.jsonc`: Worker `mtbid`, D1 `rexbid-db` / `971879fe-04ed-4e8c-9dc6-5306980bb872`, właściwy `ASSETS`.
- [ ] Porównaj `wrangler.staging.jsonc`: Worker `rexbid-auth-test`, D1 `rexbid-auth-test-db` / `acb3cb8e-69a2-459f-8a46-0f2f5b9004be`. Nigdy nie używaj configu staging do produkcji.
- [ ] Sprawdź sekrety przez obecność/binding, nie wypisuj ich. Auth musi pozostać fail-closed, dopóki nie ma kompletnej konfiguracji i zatwierdzonego limitera.
- [ ] Potwierdź, że staging-only routes/flags, Auth test UI, diagnostyka, Sync harness i estimator prototype nie są aktywne w produkcji.
- [ ] Zweryfikuj D1 migracje zdalnie tylko read-only; nie stosuj `0003` ani `0004` bez osobnej zgody i planu.
- [ ] Wykonaj backup D1 poza repo, zapisz checksum i punkt Time Travel. Sprawdź procedurę odtworzenia.
- [ ] Przejrzyj Worker dry-run bundle i assets: `npx wrangler deploy --dry-run --config wrangler.jsonc`.

## Wdrożenie i smoke test

- [ ] Wdrożenie `mtbid` wymaga odrębnej jawnej zgody właściciela. Nie wykonuj go w ramach stagingowego release.
- [ ] Po zgodzie wdrażaj dokładnie z `wrangler.jsonc`; zachowaj Version ID i log zmian.
- [ ] Smoke test: `/`, `/health`, `/ready`, `/api/cars` (pojedynczy request), `/api/filters` tylko gdy potrzebne, oraz jeden reprezentatywny detail/history lookup z uwzględnieniem budżetu Apibara.
- [ ] Sprawdź prywatne cache headers/noindex, security headers, brak Auth na produkcji, brak staging assets/flag i brak błędów JS.
- [ ] Nie wykonuj produkcyjnej migracji D1 w tej samej operacji co deploy Workera.

## Rollback i monitoring

- [ ] Trigger rollback: wzrost 5xx/502/504, błędny katalog/pojazd, brak wymaganych assets, naruszona izolacja staging/prod, prywatna odpowiedź cache'owana lub błąd security.
- [ ] Zatrzymaj kolejne wdrożenia; przywróć poprzednią wersję Workera z Cloudflare deployment history. Nie odwracaj D1 automatycznie.
- [ ] Jeśli problem dotyczy schematu, zachowaj logi i kopię, oceń kompatybilność; odtworzenie D1 wymaga osobnej decyzji.
- [ ] Monitoruj statusy/latency, błędy providera, Apibara 429 i request/day, `/ready`, błędy assets oraz security events. Logi nie mogą zawierać PII/secrets.
- [ ] Po 15–30 minutach wykonaj ponowny ograniczony smoke i potwierdź stabilność. Zapisz Version ID i wynik.

## Zatrzymanie wdrożenia

Nie wdrażaj, jeśli target Worker/D1 jest niejednoznaczny, testy nie przechodzą, backup nie jest potwierdzony, wymagane sekrety nie są skonfigurowane, Auth miałoby zostać przypadkowo aktywowane, albo wymagane prawa danych/zgody nadal są otwarte.

## Aktualizacja blocker-closure — 2026-10-03

- [x] Remote staging D1 backup/restore rehearsal do osobnej tymczasowej Cloudflare D1; schema/count/FK PASS; tymczasowy target usunięty po sprawdzeniu dokładnego ID.
- [ ] Przed produkcją zatwierdzić retencję, access control i szyfrowany storage backupu. Staging rehearsal nie odtwarza `rexbid-db`.
- [ ] Produkcyjne migracje: backup → proposal `0003` Accounts → proposal `0004` Sync → media fields (odpowiednik 0005, po 0004). Każda migracja w osobnym zatwierdzonym oknie.
- [ ] Zatwierdzić limity globalne i klas operacji; config ma `REXBID_PROVIDER_BUDGET_MODE=required`, a brak limitów/schema ma blokować fetch przed upstream.
- [ ] Cron/Queue pozostają wyłączone; najpierw bounded-run review, budgets, leases, failure alerts i rollback kill switch.
- [x] Provider/fallback telemetry and atomic fail-closed daily budgets: 310 automated tests pass; production/staging Wrangler dry-run builds pass. Changes are not deployed; complete a staging deployment/smoke before relying on runtime telemetry.

Runbook: `docs/PRODUCTION_CUTOVER_RUNBOOK.md`.
# Final staging review addendum — 2026-10-03

- Last reviewed staging release: `rexbid-auth-test` Version `6c70674f-c164-404f-afc0-b1984ffe5549`; production `mtbid` and `rexbid-db` were not used.
- Staging health/readiness, noindex, private cache, safe 404 and anonymous auth response passed. Product browser review covered Home/catalog/search, both platform detail pages, images/history, guest favorites and Calculator V3 desktop/mobile.
- Before production, additionally require: selected canonical domain and callback allowlist; production-only secrets and rate limiter; custom SMTP/deliverability; separately rehearsed remote D1 restore; approved migration list and backup; legal owner review; and a staging/production config diff proving no staging flags or binding can leak.
- Production remains a **STOP** until all owner/external gates above are signed off. Current staging evidence is not production approval.
