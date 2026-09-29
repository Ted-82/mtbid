# Rex.Bid — gotowość do kontrolowanego publicznego uruchomienia

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
