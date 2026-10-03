# Gotowość kont Rex.Bid do produkcji

## Uzupełnienie przeglądu launch — 2026-10-03

Accounts nadal jest **STAGING VERIFIED / NOT PRODUCTION DEPLOYED**. Wcześniejszy login/account/cloud favorites E2E pozostaje wiarygodny. W tej sesji browser jest anonymous, więc nie powtórzono login/logout/merge/export/resend. Password recovery nie ponawiano z powodu wcześniejszych problemów z wysyłką i rate limit; wykonaj jeden kontrolowany stagingowy test dopiero po potwierdzeniu SMTP.

Do produkcji wymagane: zatwierdzenie domeny/originów, production Supabase project/key i cookie secret, ścisła redirect allowlist, production D1 migration 0003 (osobno zatwierdzona), Cloudflare rate limiter, custom SMTP z SPF/DKIM/DMARC, owner/legal-approved notices i E2E na finalnej domenie. Samo dodanie flagi nie może włączać Auth.

Stan dokumentu: 2026-09-29. Zakres: kod i procedura wydania. Nie stanowi zgody na aktywację produkcyjnego Auth.

## Status

- **STAGING VERIFIED:** Supabase Auth BFF, callback PKCE, HttpOnly cookie, login, `/api/me`, cloud favorites, merge, refresh i logout przeszły wcześniejsze owner-run real-browser E2E na odizolowanym `rexbid-auth-test` / `rexbid-auth-test-db`. Bieżący kod wdrożono na staging Version ID `916a2a0c-f5ad-4643-b886-927c8b2849c9`; smoke GET `/api/auth/config`=200 enabled, `/api/me`=401 anonymous, publiczne strony kont=200. W przeglądarce potwierdzono render loginu, widocznego neutralnego komunikatu potwierdzenia/ponowienia i formularza resetu.
- **PRODUCTION READY IN CODE (not a release approval):** wspólne normalne UI, feature gate, allowlist originów, reset hasła, ponowne wysłanie potwierdzenia, eksport danych i obsługa równoległego refreshu są przygotowane i pokryte testami offline. Recovery email/callback, resend, password update/revocation i pobranie exportu nie przeszły jeszcze realnego staging E2E.
- **NOT PRODUCTION DEPLOYED:** `mtbid` i `rexbid-db` nie mają aktywnego Auth; produkcyjne `0003_accounts_foundation.sql` nie jest zastosowane.
- **REQUIRES OWNER CONFIGURATION:** produkcyjny Supabase project/URL/key, losowy cookie secret, canonical origin/custom domain, exact allowed origins, Cloudflare rate-limit binding, Supabase redirect allowlist, SMTP.
- **REQUIRES LEGAL/BUSINESS DECISION:** privacy/terms, retention, konto deletion workflow, contact/privacy mailbox, okresy retencji logów i danych.

Brak dowolnego wymaganego elementu konfiguracji powoduje `GET /api/auth/config → {enabled:false}` oraz niedostępność Auth. Samo dodanie sekretów nie włącza Auth.

## Walidacja konfiguracji przed produkcją

BFF sprawdza przy każdym żądaniu:

1. `AUTH_ENABLED` musi mieć wartość `true`.
2. `AUTH_D1_SCHEMA_VERSION=0003` musi być ustawione dopiero po sprawdzeniu schematu docelowej D1; brak lub inna wartość wyłącza Auth.
3. `SUPABASE_URL` to HTTPS project root; `SUPABASE_PUBLISHABLE_KEY` jest obecny.
4. `REXBID_AUTH_COOKIE_SECRET` ma co najmniej 43 znaki losowego sekretu.
5. `AUTH_CANONICAL_ORIGIN` jest dokładnym HTTPS originem bez ścieżki, query ani fragmentu i odpowiada originowi żądania.
6. `AUTH_ALLOWED_ORIGINS` zawiera canonical origin i nie zawiera wildcardów.
7. `REXBID_DB` jest dostępne; operator musi wcześniej zweryfikować tabele z proposal 0003, a dopiero potem deklarować `AUTH_D1_SCHEMA_VERSION=0003`.
8. `AUTH_RATE_LIMITING_MODE=cloudflare` i binding `AUTH_RATE_LIMITER.limit()` istnieje. Staging-only bypass dopuszczalny wyłącznie na dokładnym staging host z flagą testową.
9. Callback URL znajduje się na Supabase Redirect URLs allowlist.
10. SMTP, strony prywatności/regulaminu oraz procedury usunięcia/eksportu przeszły kontrolę właściciela.

`/api/auth/config` ujawnia tylko boolean `enabled`; nigdy nie zwraca wartości konfiguracyjnych. Produkcyjny `wrangler.jsonc` nie ustawia `AUTH_ENABLED`, deklaracji `AUTH_D1_SCHEMA_VERSION`, canonical origin ani bindingu limiter — domyślny stan to OFF. Deklaracja wersji schematu jest kontrolą wydania, nie automatycznym dowodem z D1; przed jej ustawieniem operator musi zweryfikować docelowe tabele. Nie włączaj tych wartości do czasu osobnej zgody na produkcyjną migrację 0003 i release.

### Wymagana konfiguracja Cloudflare (propozycja, nieaktywna)

Po utworzeniu Rate Limiting namespace w Cloudflare należy dodać binding `AUTH_RATE_LIMITER` w produkcyjnym environment, ustalić `namespace_id` oraz reviewowane progi per-operation. Cloudflare Rate Limiting jest lokalny do colo i eventual; to warstwa redukcji nadużyć, nie globalny licznik ani jedyna ochrona. Supabase pozostaje dodatkową warstwą limitów. Staging bypass nie może trafić do produkcji.

## Sesje i odporność na równoległy refresh

Cookie `__Host-rexbid_session`: AES-GCM payload po stronie Worker, `Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=30d`; brak `Domain`. Tokeny nie trafiają do JS, JSON, URL, localStorage ani logów. Cookie przepływu PKCE jest osobne, HttpOnly i krótkotrwałe.

W obrębie pojedynczego isolate Worker współdzieli równoległe odświeżenie tego samego refresh tokenu. Przy odpowiedzi błędnej po rotacji BFF weryfikuje nadal ważny access token i nie czyści działającego cookie. Jeśli walidacja/refresh jest chwilowo niedostępna, odpowiedź jest 503 bez czyszczącego cookie. Po stwierdzeniu nieważnego/wygasłego access tokenu sesja może zostać zamknięta.

**Ograniczenie:** Map/single-flight nie serializuje pracy pomiędzy różnymi isolate, colo ani kartami. Bez Durable Object/centralnej koordynacji nie ma globalnego locka. Projekt polega dodatkowo na mechanizmie reuse/rotacji Supabase; testy obejmują równoległe requesty w jednej instancji i race-safe zachowanie przy niejednoznacznym błędzie. Potwierdzić finalną politykę reuse interval w testowym/produkcyjnym projekcie przed uruchomieniem.

## CSRF, origin i metody

- Wszystkie zmiany stanu wymagają dokładnego `Origin` zgodnego z request origin; `Sec-Fetch-Site: cross-site` jest odrzucane.
- Origin requestu musi być canonical origin z konfiguracji.
- Callback PKCE jest wyjątkiem GET: chronią go encrypted flow cookie, jednorazowy state, code verifier, TTL i provider code exchange.
- Auth BFF nie używa CORS `*` z credentials; OPTIONS Auth nie daje dostępu.
- Klient nie może wybrać `user_id`; tożsamość pochodzi wyłącznie ze zweryfikowanej sesji.

## Rate limiting

Planowane klucze: IP + route dla signup/login/recovery/resend/callback/refresh/logout; Rex.Bid user ID dla favorites/password updates. Nie limitujemy loginu po samym e-mailu, aby napastnik nie mógł łatwo zablokować konkretnego konta. Fail-closed, gdy włączony produkcyjny Auth nie ma poprawnego bindingu/limitera. Worker nie przechowuje własnego trwałego licznika; progi, retencja i alarmy wymagają decyzji operacyjnej. Cloudflare limiter nie jest globalnie ścisły; zachować limity Supabase i monitorować 429.

## Reset hasła i potwierdzenie

- `/reset-hasla.html` działa w dwóch stanach: neutralne żądanie recovery albo ustawienie nowego hasła po zweryfikowanym callback PKCE.
- `/api/auth/recovery` i `/api/auth/resend-confirmation` zwracają neutralny komunikat niezależnie od tego, czy adres istnieje. Nie testowano realnej dostawy wiadomości w tym pass.
- Po zmianie hasła BFF próbuje Supabase global sign-out i zawsze czyści bieżącą lokalną sesję po sukcesie. Jeśli provider revoke nie powiedzie się, odpowiedź ujawnia tylko boolean `other_sessions_revoked`; klient i tak musi zalogować się ponownie.
- Właściciel musi skonfigurować i zweryfikować redirecty/SMTP przed realnym resetem. Potwierdzenie signup i resend nie mają równoległego kodu auth po stronie przeglądarki.

## Izolacja, eksport i usunięcie

`GET /api/me/export` eksportuje JSON bieżącego Rex.Bid usera i jego favorites; nie zawiera sesji, tokenów, sekretów ani danych innych kont. Konto page udostępnia przycisk pobrania.

Usunięcie konta **nie jest zaimplementowane/aktywne**. Proponowana sekwencja: recent-auth/reauthentication → potwierdzenie intencji → usunięcie/anonimizacja danych Rex.Bid i favorites (`ON DELETE CASCADE`) → usunięcie identity przez uprzywilejowany server-side Supabase Admin API → unieważnienie sesji → audyt bez PII. Supabase `service_role` nie jest skonfigurowany; wymaga odrębnej zgody i bezpiecznego sekretu backendowego. Nie usuwać stagingowego konta właściciela.

## Google i linking

Adapter ma PKCE Google authorize/callback, ale UI/credentials i produkcyjna konfiguracja nie są gotowe. Potrzebne są Google OAuth Client ID/secret w Supabase, callback allowlist i testy staging. Nie scalać provider identities automatycznie po samym e-mailu. Linking musi wymagać istniejącej, świeżo uwierzytelnionej sesji i jawnej operacji provider identity-link; konflikt email/password + Google wymaga osobnego scenariusza właściciela.

## Proposal D1 0003 — przegląd

`docs/proposals/0003_accounts_foundation.sql` tworzy wyłącznie `users` oraz `user_favorites`, z unikalnością `(auth_issuer, auth_subject)`, FK favorite→user `ON DELETE CASCADE`, PK `(user_id, favorite_key)`, check identity VIN albo LOT+platform i indeks `(user_id, created_at DESC)`. Nie przechowuje hasła, e-maila, tokenu ani pełnego auta. Nadaje się do saved-searches/alerts przez dalsze tabele FK, bez zmiany obecnych PK. Zastosowano ją tylko na testowej bazie staging. Produkcyjna baza bez zmian.

## SMTP — checklista właściciela

- [ ] domena nadawcy jest własnością Rex.Bid
- [ ] SPF obejmuje wybranego dostawcę i nie tworzy duplikatów rekordów
- [ ] DKIM podpisuje domenę nadawcy
- [ ] DMARC zaczyna od monitorowania, potem ma zatwierdzoną politykę
- [ ] From i Reply-To są obsługiwane i monitorowane
- [ ] confirmation i resend testują allowed redirecty/PKCE/expiry
- [ ] password reset testuje neutralność i callback na finalnej domenie
- [ ] limity mail/Supabase i Worker są ustawione
- [ ] bounce/complaint/delivery monitoring ma właściciela i procedurę
- [ ] nie włączać wysyłki produkcyjnej przed testem kontrolowanym i zgodą właściciela

## REAL BROWSER / pozostałe bramki

**REAL BROWSER VERIFIED:** wcześniejsze owner-run testy staging obejmują normalny login, konto, aktywną sesję i cloud favorites; wcześniejszy Auth proof-of-fit obejmuje signup/confirmation/callback/session oraz favorites. Po bieżącym deployu zweryfikowano render reset/login i formularz ponownego potwierdzenia bez wysyłania danych.

**NOT VERIFIED:** nie wysłano recovery/resend maila; nie sprawdzono callbacku recovery, zmiany hasła, global revocation, export download UX, współbieżności w wielu kartach/colo ani final-domain cookie. Produkcyjnego Auth nie wdrożono. Realny reset wymaga kontrolowanego działania właściciela na stagingowym koncie.
# Final staging product review — 2026-10-03

- Production Accounts remain **NOT DEPLOYED** and fail-closed. Production D1 migration `0003` remains unapplied.
- Staging anonymous account/login render and `/api/me` 401 no-store response were smoke-checked. Prior owner-run staging login/session/cloud-favorites/logout E2E remains valid evidence; this review did not repeat credentialed login or resend/recovery/export.
- Production gate remains: production Supabase project and exact canonical origins/callbacks, cookie secret, approved production D1 schema/migration, custom SMTP and SPF/DKIM/DMARC plus delivery monitoring, and production-grade rate limiting. Recovery/resend and multi-tab/concurrent refresh require controlled verification on the final origin before launch.
- Do not promote staging auth flags, host allowlists, bindings or diagnostic UI to production.
