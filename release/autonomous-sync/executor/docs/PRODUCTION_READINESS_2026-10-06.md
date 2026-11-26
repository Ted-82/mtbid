# REXBID — środowisko produkcyjne i pakiet publikacji, 2026-10-06

**PREPARED WITH ISOLATED RESOURCES — OWNER CONFIGURATION / PUBLICATION APPROVAL REQUIRED.**
Bieżący raport zastępuje wcześniejszą wersję tego dokumentu. Bazą kodu jest checkpoint `f9776eea26f3b56d904075efa5646693b750a5b2`, wraz ze zmianami tego sprintu. Nie zmieniono obecnej produkcji, stagingu, domeny, DNSSEC ani delegacji. Apibara: **0 nowych requestów**. Nie wysłano nowych wiadomości, nie zmieniono haseł lub MFA. Bez pusha i przenoszenia danych testowych.

## Aktualizacja nadrzędna — 2026-10-07

Produkcyjny Supabase **rexbid-production** (`kkwbqzndildovbblbkcx`, Ireland / Free) został skonfigurowany i połączony wyłącznie z niepublicznym preflightem. Site URL `https://rexbid.pl`, jeden dokładny callback `https://rexbid.pl/api/auth/callback?state=*`, Confirm email ON oraz pełne polskie szablony confirmation/recovery są zapisane i ponownie odczytane. SMTP Resend ON; rzeczywista wysyłka z tego projektu **NOT VERIFIED**.

Preflight Version **57323c6d-170c-43d5-8c36-97bf1ae03f7a**: brak publicznych tras, workers.dev i preview OFF. Osobne D1/R2/limiter i Supabase secrets; Auth/portal/files OFF. D1: wszystkie dane 0, FK 0, schemat 26 obiektów zgodny z kodem. R2: Standard, 0 obiektów, publiczny dostęp OFF. Public Auth settings HTTP 200 potwierdza projekt i publishable key; nie utworzono kont ani nie wysłano maila.

Pełny eksport Cloudflare porównano 7 października 12:31:50 CEST z oboma OVH: **12/12 PASS**, bez zmian DNS. Parent .pl: DS 0; przed delegacją nadal wymagany nowy odczyt **po 14:49 Europe/Warsaw** i osobna zgoda. MX/SPF i kontakt OVH zachowane.

Rzeczywisty recovery E2E dotyczy **osobnego konta testowego klienta na stagingu**, wynik potwierdził właściciel. Nie testowano hasła ani MFA właściciela. Aktualne testy i lokalny checkpoint podaje [handoff](../PROJECT_HANDOFF.md). Niezależna kopia kluczy w sejfie oraz globalna kontrola zużycia R2 nadal wymagają zamknięcia. Pliki produkcyjne pozostają OFF.

Obecna produkcja i staging bez zmian; Apibara 0, nowych maili 0, bez pusha. Szczegóły: [runbook](PRODUCTION_CUTOVER_RUNBOOK.md), [Accounts](ACCOUNT_PRODUCTION_READINESS.md), [backup](BACKUP_RECOVERY.md). **Poniżej zachowana historia 6 października; stare statusy Supabase/SMTP/DNS oraz Version IDs zastępuje niniejsza aktualizacja.**

## 1. Wykonane przygotowanie i realny stan

Audyt Cloudflare Tedn828 wykonano 2026-10-06 18:15 UTC; nowy Worker zweryfikowano 18:35 UTC. Używano wyłącznie bezpiecznych metadanych sekretów; wartości nie trafiają do raportów ani Git.

| Zasób | Rzeczywisty stan |
|---|---|
| Obecny Worker `mtbid` | Version `351ac4e7-2175-4d51-813b-5f85d9527f64`, bez zmian |
| Obecna D1 `rexbid-db` | `971879fe-04ed-4e8c-9dc6-5306980bb872`; ledger0000/0001/0002; legacy0/0/0, budgets10/reservations182; brak Accounts/portalu/Sync2 |
| Staging `rexbid-auth-test` | Version `24e5f914-0b9e-4222-95d6-5ccf8e9c44bb`, bez zmian |
| Staging D1 | `acb3cb8e-69a2-459f-8a46-0f2f5b9004be`; users2/favorites2/orders2/messages4/files3; sources579/listings579/snapshots584; Copart352/IAAI227; media281; events0/entities0/duplicates0/FK0 |
| **Nowy Worker przygotowawczy** | **`rexbid-production-preflight`**, Version **`40fe6f1d-f0cb-4ca4-ab42-3d873c7052f0`**; brak routes, workers.dev OFF, preview OFF; nie jest publicznym wydaniem |
| **Nowa odseparowana D1** | **`rexbid-production-preflight-db`**, ID **`c8a30088-70af-43a6-9a7f-c4018279d37d`**, jurisdiction EU/EEUR; utworzono wyłącznie schemat0000→0001→0002→0003→0006; ledger5, wszystkie tabele danych0, FK0 |
| **Nowy prywatny R2** | **`rexbid-production-private-files`**, Standard, EEUR location hint; pusty, public r2.dev OFF, custom domains0, CORS nieustawiony |
| **Nowy limiter** | Binding `AUTH_RATE_LIMITER`, namespace `2026100601`, 30/60s w niepublicznym Workerze; wcześniej brak konfliktu na koncie |
| **Nowe klucze** | Niezależne CSPRNG cookie secret i portal keyring, active ID `production-20261006`; runtime encrypt/decrypt oraz seal/open PASS; zapisane w secret store nowego Workera i DPAPI poza Git |
| Produkcyjny Supabase | **Nie utworzono**; Free org ma jedno istniejące stagingowe środowisko. Formularz `rexbid-production` przygotowany, Europe, Data API OFF; wpisanie nowego hasła bazy i zatwierdzenie wymaga właściciela |
| Produkcyjny Resend key | **Nie utworzono**; przygotowana dokładna instrukcja osobnego Sending access/domain-restricted key, bez kopiowania stagingowego |

D1 przygotowawcza jest dowodem poprawnego pustego schematu, a nie kopią produkcji lub stagingu. Nie podmieniono bindingu obecnego mtbid. Przy przyszłej publikacji zatwierdzony profil nadal wskazuje obecne `rexbid-db`; zmiana tej strategii wymaga jawnej decyzji. Nowy Worker służy do odseparowania kompilacji, bindingów i nowych kluczy. Jest bez APIBARA/Supabase/owner secrets i nie obsługuje publicznego ruchu. Nie twierdzimy, że jego konto/portal lub katalog zweryfikowano produkcyjnie.

## 2. Profile, kod i izolacja

- `wrangler.rexbid-production.jsonc`: pełny `worker.js`, provider-backed katalog, karty i Calculator V4 dla `https://rexbid.pl`. **Nie używać starego `wrangler.release.jsonc` z wrapperem503.**
- `wrangler.production-preflight.jsonc`: dokładnie nowy Worker/D1/R2/limiter, bez publicznych tras. Rzeczywisty odczyt potwierdził izolację oraz niezmienione Version ID mtbid i stagingu.
- Auth/portal/files/D1-first/legacy sync pozostają OFF; Cron/Queue nie istnieją. Budżety provider-backed: global500/day, catalog250/detail150/history60/discovery0/media0. Suma klas read460; global500 jest dodatkowym limitem, nie pulą retry.
- Dodano validator preflight oraz regresje odrzucające publiczny routing, staging/current-prod bindings, nieprawidłowy namespace, sekrety w vars i przedwczesną aktywację.
- Produkcyjny Auth wymaga jawnego `REXBID_PRODUCTION_SUPABASE_PROJECT_REF` zgodnego z `SUPABASE_URL`, innego niż staging, oraz `AUTH_RECOVERY_MODE=email-token`. Brak/niezgodność = fail-closed przed upstreamem.
- Generator `prepare-production-portal.cjs` wymaga dowodów, nie zastępuje ich booleany wpisanymi dla uzyskania PASS. `--check` poprawnie raportuje brak gotowości aktywacyjnej.
- `www`: plan301 dla GET/HEAD do apex z zachowaniem path/query; state-changing requests na aliasie odrzucone. Auth cookies i dozwolony origin wyłącznie apex. Konfiguracja DNS/routingu nie została zastosowana.

## 3. Konta, recovery, portal i wyniki QA

**Rzeczywisty ręczny recovery E2E stagingu: PASS, potwierdzenie właściciela.** Mail dotarł, formularz zapisał nowe hasło, stare odrzucono, nowe umożliwiło login. [Raport recovery](ACCOUNT_RECOVERY_QA_2026-10-06.md) zachowuje ten dowód; nie powtarzano maila.

| Sprawdzenie | Rodzaj i wynik |
|---|---|
| Poprawni nadawcy Klient/REXBID, etap widoczny, plik internal ukryty, client file download/open | Wcześniejszy rzeczywisty ręczny test właściciela na osobnym kliencie: PASS, zachowany |
| Internal file / cudza realizacja / cudzy plik | Wcześniejszy rzeczywisty staging GET404: PASS; bieżące behavioral isolation tests PASS |
| MFA właściciela | Działający staging verified TOTP/AAL2 zachowany; nie resetowano, nie kopiowano do produkcji |
| Recovery w innej przeglądarce, replay/expired/tampered grant, CSRF, brak prywatnego dostępu | Automatyczne testy rzeczywistego handlera z syntetycznym dostawcą: PASS |
| Nowe hasło / stare odrzucone | Ręczny staging E2E właściciela PASS + testy syntetyczne PASS |
| Login/reset/panel desktop i mobile | Bieżąca przeglądarka staging: formularze gotowe, spójne granat/czerwień, brak poziomego scrolla przy1280 oraz390×844, anonimowy panel pokazuje login gate; nie wykonywano nowego loginu lub maila |
| Zalogowany panel/AAL2 mobile w tym sprincie | NOT REPEATED — brak bieżącej sesji klienta/owner AAL2 u agenta; zachowane wcześniejsze dowody i pełne testy behavioral |
| Final-domain production Auth/portal/SMTP/MFA | NOT VERIFIED / NOT ACTIVATED |

Recovery email-token otwiera **ograniczony**, zaszyfrowany `__Host-rexbid_recovery`, TTL600s; Secure/HttpOnly/Lax/Path=/, bez Domain. GET nie konsumuje OTP ani nie tworzy normalnej sesji. Dopiero jawny POST z ochroną Origin/Sec-Fetch-Site i limiterem weryfikuje token, identity oraz istniejące konto D1. Grant nie uprawnia do panelu, ulubionych, plików lub MFA. Confirmation pozostaje PKCE/state/verifier, z wymaganiem tej samej przeglądarki. Nie mylić obu flow.

Produkcja wymaga niezależnego projektu Supabase, URL/publishable key w secret store, origin apex, potwierdzeń e-mail, aktualnych polskich szablonów oraz osobnego owner identity potwierdzonego przez właściciela. `REXBID_OWNER_USER_ID` oznacza właściwy ID konta aplikacji w D1; nie zakładać równości z UUID Supabase ani wybierać pierwszego konta. Administracja wymaga owner + verified AAL2. [Dokładne pola i SMTP](ACCOUNT_PRODUCTION_READINESS.md).

## 4. Poczta, DNS i oczekiwanie DNSSEC

- `kontakt@rexbid.pl` → OVH → `rexbid.kontakt@gmail.com`: ręcznie potwierdzony odbiór zachowany.
- Wysyłka `no-reply@powiadomienia.rexbid.pl`, Resend Free, region Irlandia. Staging Custom SMTP zostało skonfigurowane przez właściciela; recovery doręczono, wcześniejszy mail trafił do spamu. Bez pełnych Authentication-Results/Return-Path nie przypisujemy przyczyny spamu.
- Pełne DKIM i dwa CNAME Resend sprawdzono na **obu** autorytatywnych OVH18:16UTC: zgodne. Root MX1/5/100 oraz `v=spf1 include:mx.ovh.com -all` zachowane.
- Cloudflare zone istnieje/pending; odczyt records i DNSSEC przez obecny token zwraca403/code10000. Dawne9/9 zgodne; właściciel potwierdził12 po importowaniu3Resend i CNAME DNS only. **Pełnego nowego12/12 oraz DKIM Cloudflare nie potwierdzono.** Potrzebny pełny eksport, nie ucięty screenshot.
- DMARC apex i subdomeny: NXDOMAIN na OVH. Propozycja po review: `_dmarc.rexbid.pl` `v=DMARC1; p=none; sp=none;`, osobno `_dmarc.powiadomienia.rexbid.pl` `v=DMARC1; p=none;` z relaxed alignment. Nie dodano DNS ani nie wymyślono `rua`. Tracking dla linków Auth proponujemy OFF; aktualny odczyt Resend tracking NOT VERIFIED.
- DS usunięto6października14:49CEST; ponowny odczyt rodziców .pl18:16UTC: authoritativeNOERROR/NODATA, DS0. **Nadal czekamy do7października po14:49 czasu polskiego, z nowym odczytem DS przed delegacją.**
- NS OVH nadal bez zmian. Plan apex/www/nieużywanegoFTP/TLS i ponownego DNSSEC: [DNS runbook](DNS_CUTOVER_REXBID_PL.md). Najpierw pełna zgodność stref, potem osobna zgoda, delegacja, TLS, a dopiero po aktywacji CF nowy DS wygenerowany przez CF wpisany w OVH.

## 5. Backup, migracje i wycofanie

Świeże read-only eksporty18:21UTC, chronione ACL owner/SYSTEM oraz DPAPI CurrentUser:
`C:/Users/nowic/Documents/Codex/private-backups/rexbid/production-environment-20261006T182151Z`.

- Production SQL SHA-256: `6aa64c185783a6d3b94e28ec7a9e10eb1a47287d65a1915b801dbde82760c7b9`.
- Staging SQL SHA-256: `5f71fa63f8458690d5f468c68d1948acf76505a3821f5ab93b2f8ca0f2044bf2`.
- DPAPI roundtrip obu eksportów PASS; plaintext usunięty wyłącznie ze sprawdzonego katalogu. Świeży staging restore w pamięci: zgodne business counts, FK0.
- Na rzeczywistym produkcyjnym eksporcie lokalnie0003→0006: stare schema/PK/indeksy/rekordy zachowane; nowe Accounts/portal0, FK0; wymuszony błąd006 rollback PASS, replay PASS, kontrolowana częściowa006 recovery PASS.
- Nowa zdalna, pusta D1: schema-only0000–0003+0006 readback PASS. Nie importowano eksportów danych do niej.
- Istniejąca kopia11:26UTC zachowuje3 już zaszyfrowane obiekty R2 i materiały źródłowe; checksum/header potwierdzony. Nie jest to nowa kopia R2 z18:21.
- Klucze produkcyjne mają zabezpieczoną kopię DPAPI. **DPAPI wymaga tego profilu Windows; potrzebna osobna bezpieczna kopia w sejfie właściciela/off-device.** Nie wysyłać plików backupu/keyring w czacie ani Git.

Po osobnej zgodzie brakujące migracje obecnej produkcji to **0003 Accounts, potem0006 portal**. Sync2 nie jest potrzebny do provider-backed katalogu/Accounts/portalu.0004 dopiero dla osobnego cutoveru; proposal ma media columns, więc nie powtarzać0005. Nie uruchamiać zbiorczo proposals jako production migrations.

Rollback: wyłączenie Auth/portal/files i powrót do poprzedniej zatwierdzonej wersji Workera; addytywny schema pozostaje. Przy częściowej migracji STOP, read-only ledger/schema/FK/counts, porównanie ze źródłami; `IF NOT EXISTS` nie naprawia błędnych constraintów. Przy utracie danych restore najpierw do **nowego** targetu i walidacja, potem jawnie zatwierdzona zmiana bindingu. Odtworzenie SQL bez R2 i zgodnych kluczy nie odtworzy załączników. [Backup/rehearsal](BACKUP_RECOVERY.md), [kolejność i rollback](PRODUCTION_CUTOVER_RUNBOOK.md).

## 6. Kalkulator: zachowane dane i pierwszy pakiet od wspólnika

610lokalizacji land/24sea, USD, preferred terminals Savannah/Elizabeth/Houston/LosAngeles/Indianapolis/Montreal; land-only mnożniki0.8/1/1.5/2; BEV150USD raz na pojazd; standard4/ostrożny3auta — bez zmian. Rate set `rex-partner-v4-f0a67460b203286f`. Znana sprzeczność Albany/Elizabeth310vs325 zachowuje conflict flag.

| Brakujące dane | Wpływ |
|---|---|
| **Port docelowy + kraj odprawy** | Bez tego nie potwierdzamy pełnego łańcucha importowego i podstaw podatków |
| **Zakres i wyłączenia przekazanego frachtu** | Zapobiega pominięciu lub podwójnemu liczeniu usług |
| **Cena i zakres pakietu port/broker/rozładunek/dokumenty** | Potrzebne waluta, per-auto/kontener, netto/brutto, ważność; full-cost pozostaje incomplete |
| Prowizja/dostawaPL, profile Copart/IAAI, właściwyFX i klasyfikacja podatkowa | Kolejne nieustalone składniki, nie automatyczne0 |

Pierwszy pakiet od wspólnika obejmuje tylko pierwsze3wiersze. Nie prosimy ponownie o już dostarczone stawki. `known subtotal` pozostaje niepełnym szacunkiem; benchmark BidCars nie jest źródłem dopisywanych kosztów.

## 7. Testy i koszty/limity

**665/665 node --test PASS**, partner package14/14PASS; oba generatory `--check` PASS610/24/version unchanged; config validator, production-site/preflight, składnia131plikówJS+5inlineHTML, production i preflight Wrangler dry-run oraz diff-check PASS. Portal activation validator poprawnie raportuje NOTREADY; commercial validator review_required/niepełny koszt. Nie traktujemy tego jako awarii ani gotowości do publikacji. Bieżący read-only smoke stagingu: 11/11 oczekiwanych statusów (health/ready/config/recovery-session/strony200; me/orders/clients401), private,no-store i brak CORS* dla Auth/portalu; no-referrer/nosniff/frame-ancestors none/noindex PASS. Nie ma dostępu anonimowego do danych panelu.

| Usługa | Limity i faktyczny zakres tego sprintu |
|---|---|
| [Cloudflare Workers Free](https://developers.cloudflare.com/workers/platform/pricing/) | 100krequests/day,10msCPU/request; utworzono1niepubliczny Worker, bez ruchu. Plan billing API403, nie potwierdzono billing niezależnie; nie aktywowano płatnego planu |
| [D1 Free](https://developers.cloudflare.com/d1/platform/limits/) | 10baz,500MB/baza,5GBłącznie; teraz5małychbaz, nowa pusta. Nie zmieniono obecnej produkcji |
| [R2 Standard](https://developers.cloudflare.com/r2/pricing/) | free10GB-month/1MclassA/10MclassB; nowy bucket0obiektów. **R2 jest metered ponad allowance i nie daje gwarantowanego hard billing cap.** FilesOFF do potwierdzenia monitorowania/capów; niczego płatnego nie aktywowano |
| [Supabase Free](https://supabase.com/docs/guides/platform/billing-on-supabase) | 2aktywnychprojektów; UI1projekt, nowe miejsce dostępne;500MBDB/50kMAU, brak produkcyjnego SLA. Projekt nieutworzony przez wymagane credential handoff |
| [Resend Free](https://resend.com/docs/knowledge-base/account-quotas-and-limits) | 100wysyłek/dayUTC,3000/month,3domeny; wspólna pula staging/prod, osobny klucz nie zwiększa quota.0nowychmaili; nie aktywowano dopłat/upgrade |

To pakiet do **zatwierdzenia publikacji**, nie deklaracja działającej produkcji z kontami/portalem. Brak nowych zewnętrznych requestów Apibara i brak nowych recovery e-maili.

## 8. Lokalny checkpoint i pliki

Checkpoint kodu/pakietu: `30903c1efbcd4ed6afed612217e382cffa25d7f0` — Prepare isolated RexBid production environment and launch package.23 pliki, bez sekretów i prywatnych backupów. Encrypted Git bundle24437566B, checksum+DPAPI roundtrip+bundle verify+restore do nowego bare repo+fsck+cztery blob checks PASS (18:46UTC). Bieżący checkout zachowany. Końcowy commit dokumentacyjny zapisuje ten dowód i również otrzymuje chronioną kopię.

Zmiany: auth/routes.js; trzy aktualizacje fixtures kont/MFA/portalu oraz testy production-portal; prepare-production-portal.cjs; nowe rehearse-production-migrations.cjs/validate-production-preflight.cjs i ich regresje; wrangler.production-preflight.jsonc; plan i manifest zasobów w config; polskie confirmation/recovery templates; PROJECT_HANDOFF/ROADMAP i istniejące readiness/Accounts/DNS/backup/cutover dokumenty. Calculator V4, katalog, galerie, historia i kod portalu nie zostały przebudowane.

## 9. Działania właściciela w kolejności

### Dzisiaj, bez DNS i publikacji

1. [Otwarty formularz Supabase](https://supabase.com/dashboard/new/jqxarfynpxregyvgcfty): project name `rexbid-production`, region `Europe`, **Enable Data API OFF**; samodzielnie wpisz **Database password** i zatwierdź **Create new project** na Free. Nie wysyłaj hasła. Po utworzeniu podaj wyłącznie informację, że projekt gotowy; dalsza konfiguracja URL/templates/secrets ma gotową instrukcję.
2. [Resend API Keys](https://resend.com/api-keys): nowy klucz `rexbid-production-smtp`, **Permission: Sending access**, **Domain: powiadomienia.rexbid.pl**. Wpisz go bezpośrednio w production Supabase **Emails→SMTP Settings→Password**; pozostałe pola: smtp.resend.com/465/resend/REXBID/no-reply@powiadomienia.rexbid.pl. Bez przesyłania klucza. Sprawdź domain Tracking i Free limits zgodnie z checklistą.
3. [Cloudflare DNS](https://dash.cloudflare.com/7ff5a57444667c4eda2a6a7f0fc4120d/rexbid.pl/dns/records): **Advanced→Export DNS records**, pobierz pełny plik12rekordów do porównania DKIM/MX/SPF/CNAME. Sam eksport nie zmienia DNS. W sejfie właściciela przygotuj również niezależną kopię nowych kluczy/backupów oraz decyzję o retencji, legal review i kontroli kosztów R2.

### Dopiero7października po14:49 czasu polskiego

4. Ponowny DS oraz pełne porównanie stref, potem **osobna zgoda** na delegację/DNS/TLS. Nie klikać nameserverów teraz. [Dokładny runbook](DNS_CUTOVER_REXBID_PL.md).
5. Po gotowym Supabase/SMTP/sekretach/backupie i review: **osobna zgoda** na migracje obecnej produkcji i publikację; provider-backed smoke najpierw, następnie owner-setup Auth, osobno potwierdzona production identity/MFA i realne confirmation/recovery, na końcu portal/files. D1-first/Cron/Sync pozostają osobnym etapem. [Runbook](PRODUCTION_CUTOVER_RUNBOOK.md).

**Najbliższy pojedynczy krok: utworzyć produkcyjny projekt Supabase w przygotowanej karcie.** Zasady computer-use wymagają przekazania właścicielowi wpisania i zatwierdzenia nowego credentialu. Pozostałe przygotowanie wykonano bez oczekiwania na ten krok.
