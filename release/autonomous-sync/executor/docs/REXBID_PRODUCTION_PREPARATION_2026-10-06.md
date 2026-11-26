> Bieżący etap: [Gotowość produkcyjna](PRODUCTION_READINESS_2026-10-06.md). Poniższy raport to wcześniejszy snapshot tego dnia; wzmianki o braku commitu zastępuje zatwierdzony lokalny checkpoint.

# REXBID — QA portalu i przygotowanie rexbid.pl

Stan: **PREPARED / NOT DEPLOYED / DNS UNCHANGED**. Aktualne wyniki poniżej zastępują wcześniejsze historyczne hipotezy o konfiguracji. Brak commitu/pusha, migracji, resetu MFA i wywołań Apibara.

## Potwierdzone QA

Właściciel potwierdził na osobnym koncie klienta: poprawne podpisy Klient/REXBID w obu panelach, widoczną zmianę etapu, ukryty plik wewnętrzny oraz poprawne pobranie i otwarcie pliku „Dla klienta”. To rzeczywisty test ręczny właściciela, nie nowy test agenta.

Wcześniejszy test agenta potwierdził zapis/odczyt obu nadawców w sesji klienta, brak dostępu do administracji i brak wycieku realizacji innego konta. Bieżący read-only D1: users2, favorites2, orders2, messages4, events3, files3 (client2/internal1), FK violations0. Testowe rekordy pozostają na stagingu. Nie skopiowano ich do produkcji.

Staging: `rexbid-auth-test`, D1 `acb3cb8e-69a2-459f-8a46-0f2f5b9004be`, Version `6da5587c-06f8-4e3f-9c04-73b00ae12561`. Health/ready200; Auth/config enabled; portal/config enabled i uploads_enabled=true; prywatne konfiguracje no-store. Zweryfikowany TOTP pozostaje bez zmian, czasowe flagi restartu nie występują w odczytanych bindingach. Prywatny bucket `rexbid-staging-private-files` pozostaje tylko stagingowy.

## Rzeczywista konfiguracja produkcji

Audyt 2026-10-06, Cloudflare Tedn828 / `7ff5a57444667c4eda2a6a7f0fc4120d`:

| Obszar | Wynik |
|---|---|
| Worker | `mtbid`, aktywny Version `351ac4e7-2175-4d51-813b-5f85d9527f64` |
| Binding D1 | `rexbid-db`, `971879fe-04ed-4e8c-9dc6-5306980bb872` |
| Migracje zapisane w D1 | 0000, 0001, 0002_provider_read_budgets |
| Dane legacy | vehicles0, snapshots0, auction_history0 |
| Budżety | 500/day; catalog250/detail150/history60/discovery0/media0 |
| Accounts/portal/Sync2 | brak tabel 0003/0006/0004; Auth OFF, portal endpoint404 |
| Sekrety Workera | tylko nazwa `APIBARA_API_KEY`; wartości nie odczytywano |
| R2 | jedyny widoczny bucket to stagingowy; brak produkcyjnego bindingu |
| HTTP workers.dev | Home/health/ready200, auth/config200 enabled=false |

Produkcyjna D1 ma 10 wierszy budżetów i 182 rezerwacje w eksporcie; to historyczne liczniki, nie liczba requestów tego sprintu. Nie wykonywano cars/detail/history ani nowego fetch do Apibara.

### Domena i poczta

Publiczne DNS rexbid.pl: NS `dns111.ovh.net` / `ns111.ovh.net`, A `213.186.33.5`, MX OVH (mx1/mx2/mx3.mail.ovh.net), SPF `v=spf1 include:mx.ovh.com -all`. Zapytanie `_dmarc.rexbid.pl` zwraca NXDOMAIN. Nie ustalono selektora DKIM i nie potwierdzono skrzynki kontaktowej. MX nie dowodzi, że konkretna skrzynka działa.

AKTUALIZACJA: Cloudflare API potwierdziło strefę rexbid.pl pending;9/9 zgodnych rekordów, brak Worker custom domains. Próby HTTPS rexbid.pl z tego środowiska nie zakończyły się odpowiedzią HTTP; nie uznajemy tego za diagnozę globalnej awarii TLS. Nie zmieniano NS/A/MX/TXT/HTTPS. Domena nie jest obecnie działającym originem tego Workera.

Nie ma produkcyjnych bindingów Supabase. Bez dostępu administracyjnego do właściwego projektu nie potwierdzono, czy osobny projekt produkcyjny już istnieje ani jego Site URL, SMTP, templates, limity czy ustawienia recovery. Nie podstawiać projektu/sekretów stagingowych. Właściciel zachowuje istniejący działający TOTP stagingu; ewentualny nowy projekt produkcyjny wymaga własnego konta właściciela i jego konfiguracji MFA, bez resetowania stagingu.

## Właściwy profil wdrożenia

**`wrangler.rexbid-production.jsonc`** używa wspólnego `worker.js`, działającego provider-backed API i produkcyjnej D1. Ma domenę rexbid.pl, canonical/allowlist tego originu, V4 oraz `run_worker_first=true`. Nie wymaga pustego produkcyjnego Sync2 katalogu, nie zwraca globalnego503. Budżety pozostają500/250/150/60/0/0; Auth/portal/D1-first/sync OFF, brak Cron i R2, brak staging flags. Profil nie ma automatycznego migrations_dir.

Nowy `REXBID_PRODUCTION_UI_ENABLED=enabled` odblokowuje tylko V4 na dokładnym HTTPS rexbid.pl przy zgodnych deklaracjach produkcyjnej D1 i allowlist. Nie odblokowuje Auth/sync. Wspólny Worker jawnie odrzuca `/auth-test.html` i `/__staging/*` przed assetami. Staging wrapper nadal obsługuje własne chronione narzędzia.

**Nie wdrażać `wrangler.release.jsonc`**: to osobny wyłączony kandydat z `worker.production.js`, flagą disabled, zero provider budgets i wymogiem Sync2 danych. Pozostaje zachowany, nie jest profilem tego uruchomienia. Aktywny `wrangler.jsonc` i zdalny Worker nie zostały zmienione.

`node scripts/validate-production-site.cjs` sprawdza target, origin, entrypoint, budżety, izolację i nieaktywne funkcje. PASS oznacza poprawny przygotowany profil, **nie zgodę na deploy ani gotowy portal**. `launch_ready=false` pozostaje jawne do zamknięcia zależności.

## Aktywacja Accounts i portalu — osobny etap po zgodzie

Wartości i zależności bez sekretów: `config/rexbid-production-portal-plan.json`.

1. Produkcyjny Supabase: potwierdzony odrębny projekt; email confirmation ON, TOTP dostępny; Site URL `https://rexbid.pl`, redirect allowlist `https://rexbid.pl/api/auth/callback` obsługuje dynamiczne query state/flow. Bez wildcard innych domen i bez ręcznej zmiany formatu linków PKCE w mailach.
2. Secrets `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, nowy niezależny `REXBID_AUTH_COOKIE_SECRET` (losowe32B/base64url, minimum43 znaków). Nie tworzyć service-role dla zwykłego loginu/MFA. Cookie __Host-/Secure/HttpOnly/Path=/ bez Domain, existing SameSite policy i CSRF checks.
3. Wymagany `AUTH_RATE_LIMITER` oraz `AUTH_RATE_LIMITING_MODE=cloudflare`; namespace ID zostaje null do potwierdzenia wolnego identyfikatora. Nie używać staging-bypass. Progi i dostępność usługi sprawdzić przed aktywacją, nie kupowano planu.
4. Po świeżym backupie i osobnej zgodzie zastosować 0003 Accounts, następnie 0006 portal. Portal nie wymaga0004. Sprawdzić tabele, indeksy, FK, county i brak testowych rekordów. Deklaracje schema nie zastępują realnego SELECT.
5. Potwierdzić ID **produkcyjnego** konta właściciela w sekretach; role po serwerze, operacje owner tylko AAL2. Nowy niezależny keyring AES256GCM `REXBID_PORTAL_DATA_KEYS` / `REXBID_PORTAL_ACTIVE_KEY_ID`, zabezpieczony poza repo. Nie kopiować staging keyringu i danych testowych.
6. Utworzyć osobny bucket proponowany `rexbid-production-private-files`, Standard, binding `REXBID_PRIVATE_FILES`. Public r2.dev OFF, custom domains0, bez publicznego CORS. Sprawdzić szyfrowanie, pobranie owner/client, anonymous i obcy klient, internal visibility przed `REXBID_PORTAL_FILES_ENABLED=enabled`.
7. Włączyć Auth dopiero po SMTP/recovery/limiter, portal po schema/keyring/MFA i files po private R2. Do tego funkcje pozostają fail-closed. Nie importować staging users, orders, messages, files, budgets czy cookies; produkcyjne rekordy startują puste.

0004 Sync2 jest niezależnym późniejszym krokiem po zgodzie. Obecny proposal zawiera `media_urls_json`/`media_thumbs_json`, więc **nie dodawać0005 drugi raz**. Odtworzenie proposal0003/0006 i opcjonalnego0004 dwukrotnie na lokalnej bazie0000–0002 zachowuje stare PK/schematy/budżety i nie tworzy testowych kont. Niczego z tego nie zastosowano zdalnie.

## SMTP i odzyskiwanie

Resend jest preferowaną propozycją, nie skonfigurowaną ani kupioną usługą. Zweryfikowana domena nadawcza, rzeczywisty From/Reply-To, host `smtp.resend.com`, port465, user `resend`, hasło=dedykowany API key przechowywany tylko w Supabase. Rekordy DKIM/SPF/return-path wprowadzać dokładnie z panelu; nie zgadywać wartości i nie dodawać drugiego SPF dla tej samej nazwy. Zachować root MX OVH dla odbioru poczty, chyba że właściciel zatwierdzi inną usługę. DMARC wdrażać po analizie wszystkich nadawców.

Confirmation i reset wymagają jednego kontrolowanego E2E po SMTP: żądanie → dostarczenie → callback state/cookie/verifier → recovery session → formularz nowego hasła → aktualizacja i weryfikacja zakończenia sesji. Nie powtarzano realnego maila. Poprzednie błędy recovery nie zostały zamienione w PASS samym testem kodu. Default mailer Supabase nie jest produkcyjnym rozwiązaniem; aktualna dokumentacja wskazuje ograniczenia adresatów i niskie limity.

Utrata TOTP to osobny problem: password reset nie resetuje MFA. Wymagana zweryfikowana procedura dowodu tożsamości i dostępu właściciela do Supabase; żadnego publicznego bypassu, automatycznego kasowania verified factors ani produkcyjnego pending-restart.

Źródła sprawdzone2026-10-06: [Resend/Supabase SMTP](https://resend.com/docs/send-with-supabase-smtp), [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## Backup i odtworzenie

Wykonano read-only export obu D1. Chroniony katalog poza Git: `C:/Users/nowic/Documents/Codex/private-backups/rexbid/2026-10-06T11-26-28-268Z`. Pliki `.sql.dpapi` mają DPAPI CurrentUser, NTFS ACL tylko bieżący użytkownik/SYSTEM, SHA256 plaintext+encrypted w manifest. Plaintext tymczasowy usunięty po sprawdzeniu szyfrowania. Lokalny restore SQLite obu dumpów PASS; foreign_key_check0. Nie odtwarzano żadnej zdalnej bazy.

SHA256 produkcyjnego SQL: `6aa64c185783a6d3b94e28ec7a9e10eb1a47287d65a1915b801dbde82760c7b9`. Staging SQL: `e433d6827853dfa78a052071d41b9ff58cc6bd47568cdda36b78e87873009252`. Zabezpieczono3 obiekty staging R2 (519229B) z nagłówkiem RXBID1, dodatkowo DPAPI, bez odszyfrowywania obrazów/PDF i bez publicznego udostępnienia. Metadane/klucze obiektów są w chronionym dumpie; r2-object-map.json.dpapi zawiera zweryfikowane przypisanie oryginalnych object_key do plików kopii i ich SHA256.

Ograniczenie: DPAPI jest związane z tym użytkownikiem Windows, nie jest samodzielnym offsite disaster recovery. Właściciel powinien mieć niezależny bezpieczny backup historycznego keyringu i procedurę odzyskania stacji/profilu; klucze nie trafiły do tego raportu. D1/R2 backup nie kopiuje Supabase haseł/MFA i nie zastępuje backupu/procedury tego dostawcy. Nie ma produkcyjnego R2 do eksportu.

Przed przyszłą migracją/deployem wykonać świeży eksport (bieżący jest snapshotem QA). Procedura: `wrangler d1 export rexbid-db --remote --config wrangler.jsonc --output <prywatny-plik>` → hash → szyfrowanie → lokalny restore/count/FK → ewentualny import do **nowej odrębnej bazy** po zgodzie, nigdy staging backup do produkcji. R2 odtwarzać z zachowaniem object_key/AAD oraz wszystkich używanych key IDs.

## Kolejność uruchomienia i wycofania

1. Przygotować strefę/DNS/TLS i pocztę; zatwierdzić operatora, treści prawne i zasady retencji. Teraz DNS bez zmian.
2. Zweryfikować nowy profil, sekret Apibara, budżety, backup oraz produkcyjny Supabase/SMTP/limiter/private R2. Staging do dalszego QA pozostaje izolowany.
3. Po **osobnej zgodzie** wykonać konieczne addytywne migracje0003/0006; 0004 tylko jeśli uruchamiany Sync2. Sprawdzić puste nowe dane/legacy/budżety/FK.
4. Po **osobnej zgodzie** wdrożyć nowy profil domenowy provider-backed, konta OFF; smoke Home/catalog/search/detail/calculator/security/SEO/health/ready. Nie importować starych staging danych.
5. Włączyć Auth, sprawdzić confirmation/recovery/login/logout/export; potwierdzić owner MFA, dopiero potem portal/files. D1-first i Cron nadalOFF. Produkcyjny Sync/cutover wymaga oddzielnej decyzji i własnych danych, nie staging dumpu.

| Trigger | Wycofanie | Schema rollback |
|---|---|---|
| Home/API500, błędne ceny lub brak assetów | `wrangler rollback 351ac4e7-2175-4d51-813b-5f85d9527f64 --config wrangler.jsonc`; zweryfikować zachowane route/bindings, budgets i poprzedni workers.dev | nie |
| Problem custom domain/TLS | przywrócić zapisane poprzednie DNS/custom-domain routes przez zatwierdzonego operatora; Worker rollback nie cofa DNS | nie |
| Auth/recovery/MFA niedostępne | AUTH_ENABLED=false i portal/files disabled w profilu, kontrolowany redeploy; nie usuwać faktorów ani sekretów | nie |
| Wycieki widoczności/pliki | natychmiast portal/files disabled, zachować audyt/klucze/R2, naprawić i ponownie QA | nie |
| Błąd migracji/danych | STOP aktywacji, flagsOFF, diagnoza; nowy restore target po osobnej zgodzie, bez DROP tabel | brak destrukcyjnego down |
| Przyszły problem D1-first/Cron | flagD1-first=false, scheduleOFF, provider-backed z budżetami | nie |

Zachować manifest aktualnego wdrożenia, route/DNS i bindingów przed cutoverem. Rollback Workera nie przywraca utraconego keyringu, danych ani Supabase; nie usuwać starych kluczy przy rotacji.

## Wynik sprawdzeń i blokery

641/641 testów PASS (wcześniej637). Nowe regresje: profil bez503, izolacja staging tools, gate V4 HTTPS/target oraz addytywne migracje/replay. Oba generatory --check PASS (610 lokalizacji/24 sea rates, V4 rex-partner-v4-f0a67460b203286f). Validator nowego profilu, istniejących Workerów i zachowanego inactive release PASS. Syntax118 modułów/11 inline oraz2 nowe pliki PASS; diff-check PASS. Dry-run nowego profilu PASS (376.65 KiB, gzip78.42 KiB), bez deployu. Calculator parity125663 PASS; commercial profile valid/review_required i ready_for_cost_model=false, zgodnie z brakującymi danymi. Brak nowego deployu, staging Version nie zmieniony.

Blokery: domain zone/TLS; produkcyjny Supabase/secrets/limiter; SMTP i recovery E2E; produkcyjne schema0003/0006; private R2/keyring i ownerMFA; legal/retencja; potwierdzony profil opłat aukcyjnych, zakres frachtu/port UE/obsługa/import/PLdelivery/FXpodatkowy. Kalkulator ma610 lokalizacji, preferowane terminale, land multiplier i BEV150USD, ale brakujące koszty pozostają „do potwierdzenia”; znany subtotal nie jest wiążącą ceną pod dom. Upload magic/type/size validation nie jest antywirusem; quota storage i idempotencja utraconej odpowiedzi POST wymagają planu przed większym ruchem. Nie ma automatycznego maila o wiadomościach/etapach.

**Jeden następny krok właściciela:** dodaj `rexbid.pl` jako strefę w Cloudflare na koncie Tedn828 i zatrzymaj się przed zmianą nameserverów w OVH. Pozwoli to zweryfikować zaimportowane DNS, zwłaszcza pocztę, bez przenoszenia domeny ani publikowania serwisu. Nie zmieniaj jeszcze NS/MX i nie wysyłaj sekretów w czacie.
