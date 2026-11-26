## 12.10.2026 — rexbid.pl uruchomione za zgodą właściciela

Publiczne https://rexbid.pl; www308 zachowuje path/query, HTTP301 doHTTPS. Worker rexbid-production-preflight **1cd69740-fda8-495a-a895-587f135cf077**, odseparowana D1c8a30088. Auth/portal/files/Cron/Sync/fallbackOFF. Staging **85a44ee5-5b9d-4a6d-ac35-1b7456535a12**, zachowane dane/MFA; mtbid351ac4e7 nietknięty. Delegacja blair/titan potwierdzona w OVH i pięciu odpowiedziach parent; DS0 na b/d/f/h/j, a timeout. Cloudflare active,13 wpisów (11 zachowanych zwykłych +2 managedWorker), poczta32/32PASS. Workers Paid aktywowany samodzielnie przez właściciela:5USD/mies.+usage, nie hard cap.

Naprawiono ujawniony w rzeczywistym QA błąd mobilnego menu (stara reguła ukrywała Jak to działa/Ulubione). **913/913 repo,47/47 celowane,31/31 final-domainHTTP/API PASS**; desktop/mobile, VIN/LOT, karty obu platform, galerie, częściowyV4, lokalne ulubione i kontakt sprawdzone. Fresh backup+readback; dane1817/3253/19044/1638/private0 zachowane,0 migracji i nowychApibara. Daty8–9.10 nadal wymagają kontrolowanego odświeżenia; nie udają danych live.

[Raport uruchomienia i konkretny rollback](PUBLIC_LAUNCH_QA_2026-10-12.md). Starsze wpisy poniżej są historią, w tym dawne „brak zgody/Free/pending”; nie wykonywać ponownie delegacji, tworzenia zasobów ani transferu danych. DNSSEC i produkcyjne konta/portal pozostają osobnym etapem. Treści prawne zachowały oznaczenie wersji do przeglądu, nie przypisano im prawnej akceptacji. Bez pusha.

---

## Aktualny stan12.10.2026 — techniczny pakiet publikacji ukończony

Odseparowany Worker/D1 gotowy w lokalnym pakiecie C:/Users/nowic/Documents/Codex/REXBID_PUBLICATION_PREP_20261012/candidate. Naprawiono produkcyjne robots/sitemap i /ready; katalog ma1817ofert/19044events/1638stanów, prywatne tabele0, FK/duplikaty0. Ponowny restore istniejącej kopiiPASS na obecnym komputerze. 912testówPASS +końcowy suite publikacji20PASS, dry-run repo/pakietPASS. Dashboard potwierdza WorkersFree; Paid5USD/mies.+usage, bez zakupu. Staging5079f5f9 zachowany, nie wdrażano zmian publikacyjnego entrypointu na staging. Apibara0, DNS/produkcja bez zmian. [Aktualny raport](PUBLICATION_TECHNICAL_QA_2026-10-12.md).

Zimbra i dane firmy są potwierdzone. Braki wspólnika nie blokują pierwszego częściowego katalogu. Pozostaje akceptacja dokumentów/retencji i konkretnego cutoveru, rekomendowany Paid przed ruchem oraz DS/TLS/smoke w zatwierdzonym oknie. Auth/portal/pliki/Cron/Sync/fallbackOFF. Starsze wpisy poniżej są historią; nie wykonywać ich ponownie.

---

## Bieżący stan — demo gotowe, publikacja do akceptacji, 8.10.2026

Staging **69d632c2-4f53-4d08-9602-6cd60de43d8e**, **824/824 repo + 14/14 partner PASS**, HTTP 19/19 i rzeczywisty desktop/mobile. [QA](FINAL_ACCEPTANCE_QA_2026-10-08.md), [scenariusz](PARTNER_DEMO_2026-10-12.md), [końcowa zgoda](FINAL_PUBLICATION_APPROVAL.md).

**DONE:** potwierdzone LLC/adres/wariant A w kompletnych tekstach; widoczne daty i historia obserwacji; poprawny powrót kontakt→katalog; zachowane V4/media/ceny/MFA. Dane 1638/1682 oraz prywatne county2/2/2/4/3 bez zmian. **Apibara: 0, STOP 56/1000**.

**OWNER/LEGAL REVIEW:** akceptacja warunków/prywatności i ręcznej retencji; ocena warunków obecnej korespondencji OVH→konsumencki Gmail, odbiorców i transferów. Nie jest to nakaz kupna usługi ani automatyczna ocena nielegalności Gmaila. Nie przypisywać mu niepotwierdzonego powierzenia. Pełna retencja dostawców nie jest własnym TTL. Dane firmy nie są już brakującym blockerem, NM Entity ID nie wykazano jako samodzielnej bramki katalogu.

**OWNER PUBLICATION APPROVAL:** nowy preflight/D1c8a… stored, tylko katalog/V4/localfav/contact. Auth/portal/files/Cron/Sync/fallbackOFF. TLS i finalnyDS/smoke dopiero w zatwierdzonym oknie; zero zmian DNS teraz. [Runbook](PRODUCTION_CUTOVER_RUNBOOK.md).

**LIMITATIONS:** poniedziałkowe sekcje bieżące mogą być puste przy starych obserwacjach; użyć scenariusza zapisanego katalogu. Nie wszystkie galerie sprawdzono. Kalkulator nie jest pełną ceną pod dom. Nowy panel/unread E2E bez sesji niewykonany; wcześniejsze ręczne potwierdzenia zachowane. Nie są wymagane do pierwszego zakresu bez kont.

---

## Historia — wcześniejsze dowody; bieżący stan opisano powyżej

## Nadrzędna gotowość — 8.10.2026 po danych podmiotu i DNS

**STAGING VERIFIED — OWNER/LEGAL APPROVAL REQUIRED.** Końcowy staging: **0dd0ea83-6777-4df8-a30b-7ba74a0664f3**. Pełny suite: **819/819 PASS**. Nowa kontrola HTTP: **12/12 PASS**, wraz z celowaną kontrolą desktop/mobile. Generatory, konfiguracja, składnia 152 JS + 12 inline, dry-run i diff: PASS.

Firma **REX AUTO CARGOLOOP L.L.C** jest wskazana w kontakcie, O nas, stopkach i szkicach. Poprawiono noindex dokumentów prawnych i aliasów stagingu. [Aktualny raport](COMPANY_PUBLICATION_REVIEW_2026-10-08.md) oraz [runbook](PRODUCTION_CUTOVER_RUNBOOK.md) mają pierwszeństwo przed starszymi licznikami 579/749 i planem pustego preflightu poniżej.

**DONE — dane i QA:** Katalog pozostaje częściowy.

| Zakres | Bieżący wynik |
| --- | --- |
| Oferty | 1638: 840 Copart / 798 IAAI |
| Snapshots / oferty z mediami | 1682 / 1363 |
| Active obserwowane 8.10 / starsze obserwacje | 1098 / 540 |
| Prywatne dane w publikacyjnej D1 | 0 |
| Staging users / favorites / orders / messages / files | 2 / 2 / 2 / 4 / 3, bez zmiany |
| Kampania / nowe wywołania providera | STOP, 56/1000 / 0 |

Właściciel, MFA, portal i recovery testowego klienta pozostają bez zmian.

**DONE — DNS:** Spośród 6 aktualnych NS IANA pięć odpowiedziało z AA = 1 i DS = 0 przez UDP/TCP, 13:41 CEST. a-dns timeout i IPv6 unreachable pozostają NOT VERIFIED. Pełne rekordy OVH oraz Cloudflare blair/titan: **12/12 zgodnych**, 13:44 CEST. Okres oczekiwania do 7.10, godz. 14:49 CEST minął. W faktycznym oknie ponowić aktualną macierz autorytatywnych odczytów. Kolejny eksport nie jest potrzebny bez zmiany strefy.

**BLOCKED:** Formalny adres, dane rejestrowe, jurysdykcja, administrator i retencja oraz przegląd prawny wymagają potwierdzenia. DNS/deployment wymaga osobnej zgody. Sama nazwa nie określa odpowiedzialności sprzedażowej. Podgląd szkiców nie jest zatwierdzonym regulaminem.

**PREPARED:** Nowy rexbid-production-preflight i odseparowana D1 c8a30088-70af-43a6-9a7f-c4018279d37d. Zakres: zapisany katalog, karty, galerie, historia obserwacji, V4, lokalne ulubione i kontakt. Auth, portal, pliki, Cron, Sync i automatyczny provider fallback są OFF. Przygotowano apex/www Custom Domains na nowym Workerze, HTTPS www → apex 308 z path/query, osobne HTTP → HTTPS, usunięcie parkingu i nieużywanego FTP, zachowanie 9 pozostałych rekordów OVH/Resend oraz plan TLS, DNSSEC i rollbacku. [Jedyny runbook](PRODUCTION_CUTOVER_RUNBOOK.md).

**LATER / NOT BLOCKING CATALOG:** Produkcyjne Auth, SMTP confirmation/recovery, MFA właściciela i dwukontowe unread E2E to osobne fazy. Off-device DR i kontrola kosztów R2 są wymagane przed plikami. Brak portu, kraju odprawy, zakresu frachtu i pakietu port/broker daje niepełną kalkulację. Nie dopisujemy fikcyjnej ceny. Potwierdzone 610 stawek lądowych, 24 morskie, terminale, mnożniki i BEV 150 USD są bez zmian.

Publiczny deploy, zmiany DNS, migracje i push: **0**.

---

## Historia — wcześniejsze dowody, nadrzędny stan powyżej

# REXBID — gotowość pierwszej publikacji

**Stan nadrzędny: 2026-10-07, po profesjonalnym dopracowaniu stagingu. PREPARED — OWNER APPROVAL PENDING.** Ten rozdział zastępuje wcześniejsze opisy pustego preflightu, brakującego API key i planu katalogu provider-backed dla nowego targetu. Starsze wpisy poniżej pozostają historią.

## CURRENT STATE

- **Wdrożony staging:** [rexbid-auth-test](https://rexbid-auth-test.tedn828.workers.dev), Version **4a6bfcf9-4ecb-43fb-8943-0b246d7bc484**. Pełny suite **749/749 PASS**, partner package osobno **14/14 PASS**, parity **125663/125663 PASS**; oba generatory, config validator, syntax **143 JS + 12 inline**, diff-check i publication dry-run PASS. Profil publikacji nie został wdrożony.
- Zachowano istniejący projekt i lokalne zmiany po checkpointcie `364b1d7`. Wdrożenie stagingowe obejmuje publiczny UX, czytelność Calculator V4/kontaktu i portal z trwałym oznaczeniem nieprzeczytanych wiadomości. Końcowy Version, testy, desktop/mobile oraz własne ograniczenia QA: [PROJECT_HANDOFF.md](../PROJECT_HANDOFF.md).
- Obecne `mtbid`, Version `351ac4e7-2175-4d51-813b-5f85d9527f64`, i `rexbid-db`, ID `971879fe-04ed-4e8c-9dc6-5306980bb872`, **bez zmian**. Nie wykonano ich deployu, migracji lub zapisów, DNS/delegacji/routingu ani pusha.
- Odseparowany `rexbid-production-preflight`: prywatna wersja `0a876baa-7b80-44ce-9d85-602ff8c82314`, workers.dev/preview OFF, brak publicznych custom domains. Metadane potwierdzają sześć sekretów, w tym **APIBARA_API_KEY obecny**. Nie odczytano wartości i nie sprawdzano dostępu do providera. W tym etapie **0 nowych requestów Apibara, 0 discovery/backfill, 0 nowych maili**.
- Odseparowana D1 `rexbid-production-preflight-db` / `c8a30088-70af-43a6-9a7f-c4018279d37d` ma ledger 0000/0001/0002/0003/0004/0006/0007. 0004 zawiera media columns, więc 0005 nie powtarzano. Nowy schemat/import wykonano tylko na izolowanej bazie; rexbid-db nie dostała Accounts/Sync2/portalu.
- Z rzeczywistych zapisanych danych przygotowano **579 publicznych sources/listings: 352 Copart / 227 IAAI**, 584 observed snapshots, events/entities=0. Media w 281 listingach, 8063 URL, duplikaty platforma/LOT=0, FK=0. **Users/favorites/orders/messages/files=0**. Nie skopiowano kont, realizacji, wiadomości, plików, MFA, kluczy ani operacyjnych cursorów/budżetów stagingu.
- Dwa snapshot scope są partial, bez cursorów i last_success/last_complete. Obserwacje źródłowe: **29 września → 5 października**, wszystkie starsze niż 24 h. Przyszły termin aukcji nie potwierdza świeżości. Nie oznaczono danych jako aktualnych ofert i nie poprawiano dat.
- Przygotowany `wrangler.production-publication.jsonc` używa `worker.publication.js`, **REXBID_PUBLIC_CATALOG_MODE=stored** i dokładnych bramek apex/www/D1. Cztery publiczne API czytają D1; cache maksymalnie 30 s, bez private/Cookie/Authorization. Brak/stare dane nie uruchamiają providera. Historyczne D1_PRIMARY_READS=false pozostaje OFF; nowa ścieżka stored jest jawna i ograniczona do nowego targetu.
- Pierwszy zakres zachowuje zapisany katalog, dokładny VIN/LOT/platformę, dostępne karty/galerie/obserwacje historii, Calculator V4, kontakt i guest favorites. **Auth/portal/files/Sync/Cron/discovery/media enrichment/provider fallback OFF**. Konta/MFA/portal/załączniki nadal działają na stagingu i nie są usuwane z kodu.
- Produkcyjny Supabase i SMTP przygotowane wcześniej: kkwbqzndildovbblbkcx, Site URL https://rexbid.pl, callback state=*, polskie szablony, ograniczony grant recovery, SMTP Resend. Final-domain delivery/confirmation/recovery i production owner/MFA **NOT VERIFIED**.

## DONE — dowody rozdzielone według źródła

| Obszar | Dowód / ograniczenie |
| --- | --- |
| Publiczny snapshot | Zdalny import i readback nowej D1; statyczna whitelista, źródłowe daty i dokładna tożsamość platforma/LOT zachowane. Nie dowodzi świeżości lub pełnego rynku |
| Portal unread | Addytywne staging 0007 po backupie; audience client/team wybiera serwer, klient tylko własna realizacja, zespół wymaga owner AAL2. Testy lokalne zachowania; ponowny rzeczywisty test dwóch kont tego etapu NOT VERIFIED |
| Dane stagingu | Readback po 0007: users=2 / favorites=2 / orders=2 / messages=4 / files=3, FK=0; dane i MFA zachowane |
| Recovery | **Właściciel ręcznie potwierdził rzeczywisty staging e-mail E2E osobnego testowego klienta**: nowe zapisane, stare odrzucone, nowe loguje. Nie testowano hasła właściciela |
| Portal klienta | Właściciel wcześniej potwierdził nadawców, etap, ukrycie internal i pobranie pliku klientowskiego. Nie przedstawiać tego jako nowego pomiaru agenta |
| Sejf | Pięć pozycji same-computer offline PASS, pełny keyring/aktywny ID, bez DPAPI; trzy dodatkowe sekrety tylko ręcznie zapisane. Drugie urządzenie NOT VERIFIED |
| Backup | Eksporty staging/preflight przed zmianą o 16:02 UTC oraz po seedzie/0007 o 16:27 UTC: checksum/DPAPI roundtrip PASS. Pełny lokalny SQLite restore późniejszych eksportów o 16:32 UTC: FK=0, county i izolacja PASS. To nie remote restore ani odzyskanie na drugim urządzeniu |
| DNS | Pełny eksport Cloudflare vs oba OVH 12/12 o 16:47:35 CEST; DNS API 403. Rekordy/delegacja bez zmian |
| DS | Zachowany udany parent DS=0 na obu o 15:52:30 CEST. Późniejsze UDP timeout, TCP b-dns SOA bez DS / a-dns błąd sieci: nie uzyskano pełnego powtórzenia. Przed delegacją ponowić oba |
| Provider secret | Obecność nazwy API key w metadanych PASS; wartość i upstream access NOT VERIFIED |

Własny końcowy smoke stagingu: **16/16 PASS** — health/ready i cars/filters 200, dokładny VIN/LOT po jednym oczekiwanym rekordzie, detail Copart/IAAI i history D1, brakujące auto 404, anonimowe me/portal 401. Remote readback o 16:43 UTC zachował użytkowników/dane i provider reservations=291, runs=32, page commits=45. To potwierdzenie braku nowych live calli w tym zakresie, nie dowód produkcyjnego API key. Rzeczywisty browser desktop/mobile obejmował katalog, search, obie karty, galerie/wideo, V4, kontakt i guest favorites; ekrany kont oraz zamknięty anonimowy portal sprawdzono bez credentiali. Nie powtarzano rzeczywistego loginu/MFA i nowych unread na dwóch kontach. Home zachowuje cztery sekcje z uczciwymi pustymi stanami, ponieważ obserwacje są stare. Screeny i dokładne wyniki: handoff.

## Ręczne dashboardy właściciela — 7 października 17:20–17:43 CEST

Resend Transactional Free: 2/3000 miesięcznie i 0/100 dzisiaj, oba pay-as-you-go OFF. Domena Verified, „Enable tracking metrics → Configure”, bez subdomeny trackingowej; to **nie jest osobne techniczne potwierdzenie obu Click/Open flags OFF**. Workers: 19/100000 dzisiaj, 918 w okresie, 0 USD. D1: odczyty 389/5 mln, zapisy 104/100 tys., 3,04 MB/5 GB, 5/10 baz, 0 USD. R2: Class A 15 / Class B 39, 519,36 kB, staging 3 obiekty / produkcyjny bucket 0, 0 USD. Apibara Basic: 4123/30000 wykorzystane, 25877 pozostałe, 4 dzisiaj.

To ręcznie odczytane dane dashboardów, **nie własne pomiary API i nie gwarancja przyszłych kosztów**. Seed/ruch mogą zwiększyć liczniki. Nie aktywowano nowego płatnego planu lub dopłat. Stored public reads nie używają Apibara; inne środowiska nadal zużywają wspólną subskrypcję. Limiter prób i alert kosztowy nie są account-wide billing capem.

## BLOCKED — rzeczywiste bramki pierwszej publikacji

1. **Akceptacja zakresu i treści:** review stagingu, dane podmiotu/legal/retencja i konkretne okno DNS/deploymentu. Brak zgody nadal blokuje publikację.
2. **Aktualność oferty:** 579 zapisanych rekordów jest sensowną próbką/testem, lecz nie potwierdzonym bieżącym lub pełnym katalogiem. Właściciel wybiera zapisany partial start albo osobno zatwierdzony bounded refresh przed startem. Obecny sprint nie miał prawa nowego fetchu.
3. **DNS/TLS/runtime:** konfiguracja gotowa, ale brak delegacji i publicznego runtime. Przed zatwierdzonym oknem fresh DS/DNS/readback/backup; później TLS/smoke/apex/www i DNSSEC.
4. **Późniejsze konta/portal:** produkcyjne SMTP E2E, jawne przypisanie production owner i osobne MFA/AAL2 po TLS. Bramka późniejszej fazy, nie wymaga migracji obecnej rexbid-db.
5. **Późniejsze pliki/DR:** produkcyjne Files OFF i brak R2bindingu do kosztowej bramki; off-device verifier oraz przenośny backup danych niewykonane. Staging prywatności/MFA nie osłabiano.

## LEGAL / kalkulator

Apibara factual/history/snapshots/derived/commercial rights są potwierdzone; „waiting for factual-data permission” nie jest blockerem. Store/display URL-e mediów dozwolone; permanent binary archive oryginalnych Copart/IAA zdjęć niezatwierdzone, watermark nie rozwiązuje praw. Brak guaranteed/official auction data oraz wiążącej wyceny.

Zachowane 610 stawek lądowych / 24 morskie, preferowane terminale, mnożnik gabarytowy wyłącznie lądowy i BEV 150 USD raz/auto. Brakujące opłaty pozostają unknown, wynik częściowy jest opisany. [Krótki formularz dla partnera](CALCULATOR_PARTNER_FORM.html): **port docelowy/kraj odprawy, zakres frachtu, cena i zakres port/broker/dokumenty** z walutą, jednostką, netto/brutto i datą. Nie prosić ponownie o dostarczone stawki. docs/legal/ pozostaje DRAFT — REQUIRES OWNER/LEGAL REVIEW.

## PRODUCTION CUTOVER ORDER / rollback

Review zakresu/legal → świeży backup i readback izolowanego targetu → świeży DS i osobna zgoda DNS → delegacja Cloudflare → active/TLS + zatwierdzony diff parkingowych apex/www/nieużywanego FTP i HTTP→HTTPS → deploy izolowanego stored-profile → smoke bez providera → obserwacja → Cloudflare DNSSEC + nowy DS w OVH. MX/SPF/Resend i forwarding kontaktu zachowane. Auth/owner/MFA/portal oraz pliki to osobne późniejsze zgody.

Rollback nowego Workera do jego zgodnego catalog builda lub wycofanie jego publicznych custom domains. mtbid Version 351ac4e7 nie jest wersją rollbacku nowego targetu. Nie DROP/down: częściowa migracja wymaga porównania ledger/DDL i addytywnej naprawy; utrata danych → osobna D1/restore/count/FK/reconciliation/zgoda rebind. NS rollback wymaga najpierw zgodnego DS/TTL. [Pełny jedyny runbook](PRODUCTION_CUTOVER_RUNBOOK.md), [backup](BACKUP_RECOVERY.md).

## Minimalne działania właściciela

1. Obejrzeć końcowy staging, wybrać zapisany partial start lub osobno zatwierdzony refresh i zaakceptować legal/dane podmiotu oraz dokładny zakres/okno delegacji+deploymentu. API key i dashboardów nie powtarzać.
2. Przekazać wspólnikowi krótki formularz brakujących kosztów; nie jest to zezwolenie na wymyślenie pełnej ceny.
3. Później, przed aktywacją kont/portalu: produkcyjne konto właściciela i testowy klient E2E na finalnym originie, osobne MFA, off-device kopia oraz kontrola kosztów plików.

Końcowe testy, Version ID, widoczne dowody i SHA lokalnego checkpointu podaje [handoff](../PROJECT_HANDOFF.md). Sekretów nie odczytywano z Bitwarden i nie zapisano w Git. Publiczna domena, obecna produkcja, DNS/delegacja i stagingowy MFA pozostają zachowane.

---

## Historia wcześniejszych kontroli — poniższe statusy nie zastępują aktualizacji powyżej

# REXBID — gotowość uruchomienia rexbid.pl

**Stan nadrzędny: 2026-10-07. PRODUCTION PREPARED / NOT ACTIVATED.**
Bieżący kod po checkpointcie `f9776eea26f3b56d904075efa5646693b750a5b2`; aktualny staging `24e5f914-0b9e-4222-95d6-5ccf8e9c44bb`. Wcześniejsze, sprzeczne statusy zastępuje ten dokument. Dawne Version IDs i liczby testów w raportach QA są dowodami historycznymi, nie aktualną konfiguracją.

## CURRENT STATE

- Działająca produkcja: `mtbid`, Version `351ac4e7-2175-4d51-813b-5f85d9527f64`, D1 `rexbid-db` / `971879fe-04ed-4e8c-9dc6-5306980bb872`. Read-only audit: migrations 0000/0001/0002, legacy business rows 0. Provider-backed katalog/V4 zachowane; Auth/portal/D1-first/Cron/Sync2/discovery/media enrichment OFF.
- Bazowy docelowy profil `wrangler.rexbid-production.jsonc` używa pełnego `worker.js`. **Nie wdrażać wyłączonego `wrangler.release.jsonc` zwracającego 503.**
- Nowa, odseparowana D1 `rexbid-production-preflight-db` / `c8a30088-70af-43a6-9a7f-c4018279d37d`: EU/EEUR, schema-only 0000 → 0001 → 0002 → 0003 → 0006, wszystkie business rows 0, FK violations 0. Nie importowano kont ani realizacji stagingu.
- Nowy pusty prywatny R2 `rexbid-production-private-files`: Standard, EEUR hint, r2.dev OFF, custom domains 0, CORS brak. **Załączniki nieaktywne**; brak potwierdzonej ochrony przed metered overages.
- Utworzono odseparowany Worker `rexbid-production-preflight`, final Version `57323c6d-170c-43d5-8c36-97bf1ae03f7a`. API metadanych potwierdza routes=[], workers.dev OFF, preview URLs OFF oraz osobne bindingi nowej D1/R2/limitera. Auth/portal/pliki OFF; runtime bez publicznego routingu **NOT VERIFIED**.
- Production Supabase **PROJECT / SETTINGS VERIFIED**: `kkwbqzndildovbblbkcx`, eu-west-1/Ireland, Free/spend cap ON. Site URL/callback/templates zapisane, SMTP ON, public Auth settings GET200. Połączono tylko niepubliczny preflight; final-domain mail/E2E i owner/MFA NOT VERIFIED. Staging Auth/TOTP/sekrety bez zmian.
- Pięć sekretów cookie/portal keyring/active key ID i niezależnego Supabase URL/publishable key zainstalowano **wyłącznie w niepublicznym preflight Workerze**, z zaszyfrowanym DPAPI backupem poza Git. API potwierdza binding `AUTH_RATE_LIMITER`, namespace `2026100601`, limit30/period60. Wersje istniejącego `mtbid` i stagingu oraz ich sekrety/MFA pozostają bez zmian; metadane nie zastępują runtime testu Auth.
- DNS OVH nadal authoritative, Cloudflare pending. Bez deployu obecnej produkcji, jej migracji/zapisów, DNS/NS/DS/routingu i bez pusha. Nowe requesty Apibara tego etapu: **0**.

## DONE — wykonane przygotowanie

| Obszar | Dowód | Zakres |
|---|---|---|
| Recovery | Właściciel potwierdził E2E na osobnym koncie testowego klienta; hasła konta właściciela nie testowano | **STAGING REAL EMAIL E2E VERIFIED — PASS** |
| Portal osobnego klienta | Właściciel: poprawni nadawcy, etap widoczny, internal file ukryty, client download/open działa | **STAGING OWNER VERIFIED — PASS** |
| Endpoint isolation | Wcześniejszy rzeczywisty QA: internal file/foreign order/foreign file denied | **STAGING VERIFIED — PASS** |
| MFA | Działający staging verified TOTP/AAL2 | Zachowany; nie resetowany ani kopiowany |
| Recovery limited grant | Cross-browser/replay/expiry/CSRF i brak dostępu do me/portalu z grant | **AUTOMATED VERIFIED**; osobny mail cross-browser NOT VERIFIED |
| Backups | Fresh prod/staging encrypted export `20261006T182151Z`, checksum/round-trip | **PASS**; prywatne kopie poza Git |
| Migracje na kopii | Restore produkcyjnego eksportu lokalnie + Accounts/portal | Schema/count/index/FK **PASS**; nie migracja obecnej produkcji |
| Nowe zasoby | Zdalny readback schema-only D1 i prywatnego pustego R2 | Przygotowanie odseparowane od działającego serwisu |
| Katalog/kalkulator | Provider-backed produkcja, V4, recovery/account styling zachowane | Bez przebudowy istniejących funkcji |
| Konfiguracja kont/poczty | Polski confirmation/recovery template, exact origin, SMTP/domain-restricted key instrukcja | Production mail/owner/MFA jeszcze nieweryfikowane |

Bazowy suite checkpointu recovery: **658/658 PASS**. Aktualny sprint: **668/668 PASS**, partner package **14/14 PASS**, syntax **131 plików + 5 inline scripts**, generatory/config validators i dry-runs PASS. SHA lokalnego checkpointu i szczegóły: [PROJECT_HANDOFF.md](../PROJECT_HANDOFF.md). Nie powtarzać wszystkich manualnych testów ani twierdzić, że syntetyczne testy dowodzą final-domain E2E.

[Recovery QA](ACCOUNT_RECOVERY_QA_2026-10-06.md), [historyczny portal audit](PRODUCTION_READINESS_2026-10-06.md), [Accounts](ACCOUNT_PRODUCTION_READINESS.md), [backup](BACKUP_RECOVERY.md).

## BLOCKED — warunki przed publikacją

1. **Production identity/config:** niezależny Supabase, Site URL, exact redirects, polskie szablony, SMTP i preflight Worker secrets są przygotowane. Pozostają final-domain E2E i zatwierdzenie publicznej aktywacji. Production owner wskazany jawnie po verified identity/D1 mapping, potem osobne MFA/AAL2. Nie pierwsze konto ani domysł na podstawie e-maila.
2. **DNSSEC/delegacja/TLS:** Usunięcie DS potwierdzono 6 października 14:49 CEST; świeży odczyt .pl 7 października 12:31 CEST ponownie zwrócił NODATA. Czekać **do 7 października po 14:49 Europe/Warsaw** i ponownie odczytać parent DS. Zmiana NS/routingu wymaga osobnej zgody.
3. **Activation approval:** obecne `rexbid-db` nadal tylko 0000–0002. Portal potrzebuje osobno zatwierdzonego **0003 → 0006**, fresh backup/readback oraz production deploy. Sync2 0004 nie jest prerequisite katalogu/portalu.
4. **Koszty plików:** R2 poza Free allowance jest metered. Nie ma potwierdzonego account billing hard cap; Files OFF do jawnej kontroli kosztów zgodnej z zakazem dopłat. Alert sam nie gwarantuje capu.
5. **Production E2E/operacje:** final-domain confirmation/recovery, owner/AAL2, client/file isolation, TLS, monitoring, incident ownership i vault restore dostępność. Staging PASS nie zastępuje tych produkcyjnych bramek.
6. **Review prawne i kalkulator:** zatwierdzenie draftów/legal/retencji/delete oraz jasnych ograniczeń pełnej ceny pod dom. Brakujące komponenty mają pozostać unknown, nie 0.

Oczekiwanie na DS nie blokuje konfiguracji Supabase/SMTP, przygotowania sekretów ani porównania stref. Dzisiejsze przygotowanie nie daje zgody na publikację.

## OWNER DECISION — działania skonsolidowane

**Możliwe dzisiaj:**

1. Zabezpieczyć niezależną kopię cookie secret/portal keyring/active key ID oraz produkcyjnego SMTP key i danych administracyjnych Supabase w prywatnym sejfie. Nazwy pól i przekazanie: [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md). Nie wysyłać wartości w czacie. DPAPI jest zależne od komputera/profilu.
2. Zatwierdzić legal/retention i zakres publikacji; pliki R2 pozostawić OFF do wdrożenia kontroli miesięcznej storage/ClassA/ClassB. Panel [Cloudflare R2](https://dash.cloudflare.com/7ff5a57444667c4eda2a6a7f0fc4120d/r2/overview): usage i billing alerts nie zastępują hard capu. Pierwszy pakiet partnera poniżej.

**Po 7 października 14:49 Europe/Warsaw:**

3. Ponowny odczyt DS na parent.pl i osobna zgoda na delegację/TLS. Eksport 12/12 już zamknięty — nie prosić o powtórny. Osobno zatwierdzić świeży backup, migracje 0003 → 0006 i deploy produkcyjny według runbooka; nie używać profilu release zwracającego 503.
4. Po zaakceptowanym uruchomieniu Auth na finalnym originie: właściciel sam tworzy i potwierdza nowe konto, jawnie potwierdza Supabase identity/D1 mapping, potem konfiguruje osobne MFA. Kontrolowane testowe konto klienta sprawdza confirmation/recovery (również inna przeglądarka); agent nie zna haseł/kodów. Panel [production Supabase](https://supabase.com/dashboard/project/kkwbqzndildovbblbkcx/auth/users).

Nie tworzyć ponownie Supabase ani klucza SMTP — właściciel wykonał oba kroki. Bez płatnych zmian, dopłat, pusha i automatycznej aktywacji. Szczegóły: [PRODUCTION_CUTOVER_RUNBOOK.md](PRODUCTION_CUTOVER_RUNBOOK.md).

## LEGAL / kalkulator / dane aukcyjne

- Apibara potwierdziła trwałe factual auction data/history/snapshots, normalizację/derived data i komercyjne użycie. **Waiting for factual-data permission nie jest blockerem.**
- URL-e mediów/display/technical cache/thumbnails dozwolone. Permanent binary archive/redistribution oryginalnych Copart/IAA zdjęć nie jest zatwierdzone; watermark nie rozwiązuje praw.
- Dane nie są gwarantowanymi oficjalnymi Copart/IAA data. Kalkulator nie jest wiążącą ofertą transportową ani urzędową wyceną podatków.
- Zachowano 610 land / 24 sea, preferred terminals, land-only mnożnik gabarytowy i BEV150 USD raz/auto. Nie pytać ponownie o dostarczone stawki.
- Pierwszy mały pakiet od wspólnika: **port docelowy + kraj odprawy; zakres frachtu; cena i zakres port/broker/dokumenty**. Potrzebne waluta, per auto/kontener, netto/brutto i data obowiązywania. Braki uniemożliwiają uczciwe przedstawienie pełnej ceny pod dom.
- `docs/legal/`: **DRAFT — REQUIRES OWNER/LEGAL REVIEW**. Retencja, usunięcie identity, recovery właściciela po utracie MFA i procedury wsparcia wymagają zatwierdzenia; reset hasła nie może usuwać MFA.

## EXTERNAL DEPENDENCY — Free i limity

| Usługa | Zakres Free | Ograniczenie startu |
|---|---|---|
| Workers/D1 | 100000 Worker requests/day; D1 500 MB/DB, 10 DB/account, 5 mln rows read i 100 tys. writes/day | Quota/CPU i dostępność monitorować; bez auto-upgrade |
| Supabase | 2 active projects, 500 MB/DB, 50000 MAU; pause po tygodniu nieaktywności | Dwa projekty istnieją; brak płatnych backup/PITR |
| Resend | 100/day UTC, 3000/month, 3 domains; wspólna pula staging+production | Tracking/delivery/spam headers do weryfikacji; osobny key nie zwiększa quota |
| R2 Standard | 10 GB-month, 1 mln Class A / 10 mln Class B miesięcznie | Metered poza Free; files OFF do kontroli kosztów |
| Apibara | Istniejąca subskrypcja; read caps 500/250/150/60, sync0 | Bez nowych live calls podczas przygotowania |

Źródła: [Workers/D1](https://developers.cloudflare.com/workers/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [Supabase](https://supabase.com/pricing), [Resend quota](https://resend.com/docs/knowledge-base/account-quotas-and-limits), [R2 pricing](https://developers.cloudflare.com/r2/pricing/). Free nie jest SLA; nie obiecywać braku przyszłych opłat za metered R2.

## Domena i poczta — potwierdzone / niewykonane

OVH nadal obsługuje MX/SPF i działający kontakt `kontakt@rexbid.pl → rexbid.kontakt@gmail.com`. Odczyt obu autorytatywnych NS 2026-10-07 o 12:31:50 CEST potwierdza pełne 12/12 rekordów z eksportu Cloudflare, w tym trzy Resend, MX 1/5/100 i SPF. Nowa wysyłka `no-reply@powiadomienia.rexbid.pl` przez Resend jest niezależna od OVH odbioru.

Cloudflare pending blair/titan, NS/DNS/routing bez zmian. Apex docelowo canonical; `www` GET/HEAD przekierowanie do apex z path/query, bez własnej sesji Auth. FTP nieużywany; nie pozostawiać go jako proxied aliasu nowego apex. TLS przed Auth, nowy Cloudflare DS po stabilizacji. [Pełna procedura](DNS_CUTOVER_REXBID_PL.md).

DMARC root/sub obecnie NXDOMAIN. Propozycja root `v=DMARC1; p=none; sp=none;`, sub `v=DMARC1; p=none;`; bez DNS zmian w tym etapie. Mail do spamu nie dowodzi konkretnej przyczyny — pełne Authentication-Results/Return-Path i Click/Open tracking NOT VERIFIED.

## PRODUCTION CUTOVER ORDER / rollback

1. Potwierdzić aktualność przygotowanych Supabase/SMTP/sekretów i porównania DNS; zabezpieczyć niezależną kopię kluczy w sejfie.
2. Po DS wait/fresh readback osobny DNS/TLS approval; oddzielnie production migrations/deploy approval.
3. Fresh backup → 0003/readback → 0006/readback, konta/portal/files OFF.
4. Deploy pełnego provider-backed Workera + V4 bez 503 wrappera, domena/TLS w uzgodnionym oknie; smoke.
5. Limiter/origin/secrets/schema verified → Auth owner-setup → jawny owner → MFA/AAL2 → final-domain confirmation/recovery.
6. Portal dopiero po E2E; pliki po cost-control. D1-first/Cron/Sync2 OFF do kolejnej osobnej fazy.

Rollback przede wszystkim flagami i zapisanym Worker Version. Po częściowej migracji STOP, flags OFF, compare ledger/DDL; nie DROP i nie destructive restore. Restore danych do nowego targetu z count/FK/keys/R2 manifest oraz reconcile nowych zapisów. Worker rollback nie odtwarza danych/MFA. [Runbook](PRODUCTION_CUTOVER_RUNBOOK.md), [backup](BACKUP_RECOVERY.md).

**Wniosek:** odseparowane przygotowanie i staging E2E wykonane; publikacja nadal wymaga wymienionych owner/config/DNS/legal/cost gates. Produkcja i DNS nie zostały aktywowane w tym etapie.
