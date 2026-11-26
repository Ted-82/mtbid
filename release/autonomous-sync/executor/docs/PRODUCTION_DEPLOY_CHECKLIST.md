## 12.10.2026 — rexbid.pl uruchomione za zgodą właściciela

Publiczne https://rexbid.pl; www308 zachowuje path/query, HTTP301 doHTTPS. Worker rexbid-production-preflight **1cd69740-fda8-495a-a895-587f135cf077**, odseparowana D1c8a30088. Auth/portal/files/Cron/Sync/fallbackOFF. Staging **85a44ee5-5b9d-4a6d-ac35-1b7456535a12**, zachowane dane/MFA; mtbid351ac4e7 nietknięty. Delegacja blair/titan potwierdzona w OVH i pięciu odpowiedziach parent; DS0 na b/d/f/h/j, a timeout. Cloudflare active,13 wpisów (11 zachowanych zwykłych +2 managedWorker), poczta32/32PASS. Workers Paid aktywowany samodzielnie przez właściciela:5USD/mies.+usage, nie hard cap.

Naprawiono ujawniony w rzeczywistym QA błąd mobilnego menu (stara reguła ukrywała Jak to działa/Ulubione). **913/913 repo,47/47 celowane,31/31 final-domainHTTP/API PASS**; desktop/mobile, VIN/LOT, karty obu platform, galerie, częściowyV4, lokalne ulubione i kontakt sprawdzone. Fresh backup+readback; dane1817/3253/19044/1638/private0 zachowane,0 migracji i nowychApibara. Daty8–9.10 nadal wymagają kontrolowanego odświeżenia; nie udają danych live.

[Raport uruchomienia i konkretny rollback](PUBLIC_LAUNCH_QA_2026-10-12.md). Starsze wpisy poniżej są historią, w tym dawne „brak zgody/Free/pending”; nie wykonywać ponownie delegacji, tworzenia zasobów ani transferu danych. DNSSEC i produkcyjne konta/portal pozostają osobnym etapem. Treści prawne zachowały oznaczenie wersji do przeglądu, nie przypisano im prawnej akceptacji. Bez pusha.

---

## Aktualny stan12.10.2026 — techniczny pakiet publikacji ukończony

Odseparowany Worker/D1 gotowy w lokalnym pakiecie C:/Users/nowic/Documents/Codex/REXBID_PUBLICATION_PREP_20261012/candidate. Naprawiono produkcyjne robots/sitemap i /ready; katalog ma1817ofert/19044events/1638stanów, prywatne tabele0, FK/duplikaty0. Ponowny restore istniejącej kopiiPASS na obecnym komputerze. 912testówPASS +końcowy suite publikacji20PASS, dry-run repo/pakietPASS. Dashboard potwierdza WorkersFree; Paid5USD/mies.+usage, bez zakupu. Staging5079f5f9 zachowany, nie wdrażano zmian publikacyjnego entrypointu na staging. Apibara0, DNS/produkcja bez zmian. [Aktualny raport](PUBLICATION_TECHNICAL_QA_2026-10-12.md).

Zimbra i dane firmy są potwierdzone. Braki wspólnika nie blokują pierwszego częściowego katalogu. Pozostaje akceptacja dokumentów/retencji i konkretnego cutoveru, rekomendowany Paid przed ruchem oraz DS/TLS/smoke w zatwierdzonym oknie. Auth/portal/pliki/Cron/Sync/fallbackOFF. Starsze wpisy poniżej są historią; nie wykonywać ich ponownie.

---

# REXBID — checklista przygotowanej publikacji

**2026-10-07. OWNER APPROVAL PENDING; nie wykonano deployu, zmian DNS ani migracji.**

Nadrzędny i jedyny aktualny zakres: [PRODUCTION_CUTOVER_RUNBOOK.md](PRODUCTION_CUTOVER_RUNBOOK.md). Target nowego wydania to rexbid-production-preflight / D1 c8a30088-70af-43a6-9a7f-c4018279d37d. mtbid, rexbid-db / 971879fe-04ed-4e8c-9dc6-5306980bb872, staging i jego MFA pozostają poza zakresem.

## Preflight

- [x] Lokalny VerifyVault PASS pięciu pozycji według właściciela, bez DPAPI; pełny keyring i active ID zgodne.
- [x] SMTP key, hasło DB i API key zapisane ręcznie; bez technicznej weryfikacji.
- [ ] Odzyskanie na drugim urządzeniu i przenośny backup danych.
- [x] Odseparowana D1: schema 0000/0001/0002/0003/0006, wiersze biznesowe 0, naruszenia FK 0; bez importu stagingu.
- [x] Produkcyjne Site URL, callback i ustawienia SMTP ponownie odczytane; hasła nie były odczytywane.
- [x] Udany odczyt parent DS: 7 października **15:52:30 CEST**, DS 0, delegacja OVH, po zakończeniu okna oczekiwania. Późniejsze timeouty nie stanowią nowego dowodu.
- [x] Pełne porównanie DNS: 7 października **16:47:35 CEST**, 12/12 rekordów zgodnych z każdym z dwóch NS OVH. Źródłem Cloudflare był eksport z 7 października 10:21:12; live API zwróciło 403. TTL Auto/3600 jest udokumentowaną różnicą.
- [ ] APIBARA_API_KEY obecny w nowym Workerze; potwierdzona pozostała quota całego konta i miesiąca oraz inni konsumenci. Trzy odrębne D1 mogą dopuścić łącznie **460 legacy + 570 staging + 460 nowy = 1490 requestów/dzień**; nie jest to wspólny limit konta.
- [ ] Aktualne plany i usage Cloudflare/Resend/Supabase zweryfikowane; brak płatnych zmian i overages. Resend Free ma wspólną pulę stagingu/produkcji; tracking Click/Open OFF.
- [ ] Legal, retencja, zakres deployu i zmian DNS zaakceptowane przez właściciela.
- [ ] Świeży backup, checksum, manifest i wersja nowego Workera przed oknem; świeży DS bezpośrednio przed delegacją.
- [x] Lokalny suite 688/688; pakiet partnera osobno 14/14; oba generatory --check; walidatory konfiguracji; składnia 136 JS/11 inline; diff-check i oba dry-run — PASS. Późniejsze zmiany wymagają powtórzenia kontroli; nie jest to dowód runtime ani zgoda na deploy.

Lokalne polecenia generatora, szablon boolean evidence i wymagane dowody dla każdej fazy znajdują się w sekcji 4 runbooka. true wpisywać wyłącznie po faktycznym dowodzie lub zgodzie; generator nie zatwierdza publikacji i nie przyjmuje wartości sekretów.

## Po jawnej akceptacji

- [ ] Przygotować nowy build prywatnie; bez migracji obecnej bazy.
- [ ] Delegacja OVH → blair/titan, Cloudflare active i nowe parent NS. W zatwierdzonym diffie Cloudflare: parkingowe rekordy A apex/www i nieużywany FTP CNAME oraz **HTTP → HTTPS dla apex/www**. MX/SPF i trzy rekordy Resend zachowane.
- [ ] Custom Domains apex/www wskazują nowy Worker; certyfikaty/TLS poprawne. HTTP → HTTPS skonfigurowane osobno w Cloudflare po zgodzie. **HTTPS www → HTTPS apex 308 dla GET/HEAD** realizuje wrapper, z zachowaniem path/query. Mutacje aliasu odrzucone, bez cookies i pętli przekierowań.
- [ ] Smoke katalogu/V4: do 10 rzeczywistych requestów dostawcy, mniej przy niższej dostępnej puli; bez discovery/retry. Zapisać działającą wersję katalogu nowego Workera jako rollback.
- [ ] Po osobnej akceptacji auth-setup: nowe konto właściciela, jawne mapowanie issuer/subject → D1 users.id, confirmation/recovery klienta również w innej przeglądarce. Auth pozostaje OFF do tego etapu.
- [ ] Po dowodach identity i E2E: owner-setup oraz osobne produkcyjne MFA/AAL2 właściciela. Zwykłe API portalu nadal zamknięte; bez resetu stagingowego MFA.
- [ ] Portal-no-files dopiero po pełnych bramkach i osobnej zgodzie; sprawdzić izolację klientów/realizacji oraz private, no-store. Załączniki OFF, brak bindingu R2.
- [ ] Monitoring quota/5xx/delivery; mały smoke po 15–30 min. DNSSEC Cloudflare i nowy DS po stabilizacji, z kontrolą parent DS i validating resolver. DMARC tylko jako osobny zatwierdzony diff.

**Nie stosować 0003/0004/0005/0006 do obecnej produkcji w tym pakiecie.** Nowa D1 ma już 0003/0006; Sync2, D1-first i Cron pozostają OFF. Nie używać wrangler.release.jsonc zwracającego 503. Rollback, TTL/DS i restore po incydencie według runbooka; bez DROP i podmieniania bindingu na starą D1. Rollback kodu dotyczy wersji tego samego nowego Workera, nie historycznej wersji mtbid.
