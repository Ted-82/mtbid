# Rex.Bid — checklista wdrożenia produkcyjnego

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
