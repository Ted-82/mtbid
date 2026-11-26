# Recovery i ekrany konta — staging, 2026-10-06

## Bieżący wynik

- **CODE VERIFIED / AUTOMATED VERIFIED / STAGING UI VERIFIED.**
- **REAL EMAIL RECOVERY E2E VERIFIED — PASS**, potwierdzone przez właściciela 2026-10-06 na stagingu, na oddzielnym koncie testowego klienta.
- Worker: `rexbid-auth-test`, końcowy Version ID `24e5f914-0b9e-4222-95d6-5ccf8e9c44bb`.
- D1: `rexbid-auth-test-db`, ID `acb3cb8e-69a2-459f-8a46-0f2f5b9004be`; prywatny bucket `rexbid-staging-private-files` zachowany.
- Produkcja, DNS/nameservery, poczta OVH, hasło i MFA właściciela bez zmian. Bez migracji, pusha i wywołań Apibara. Agent nie wysłał wiadomości ani nie zmienił rzeczywistego hasła.

## Rzeczywisty test właściciela — 2026-10-06

Właściciel wykonał i potwierdził pełny przepływ **na oddzielnym koncie testowego klienta**, na stagingowej wersji wskazanej powyżej. Określenie „test właściciela” opisuje osobę wykonującą test; nie oznacza resetu hasła konta właściciela portalu. Hasło oraz zweryfikowany czynnik MFA konta administracyjnego pozostały zachowane.

1. Wiadomość recovery dotarła.
2. Formularz umożliwił ustawienie nowego hasła.
3. Logowanie starym hasłem zostało odrzucone.
4. Logowanie nowym hasłem działa.

Źródło dowodu: bezpośrednie potwierdzenie właściciela w rozmowie. Agent nie odczytywał wiadomości ani nie wpisywał hasła. Nie zapisano adresu konta, linku recovery, tokenów lub haseł. Wynik zamyka stagingowy blocker rzeczywistego recovery. Nie potwierdza dostawy do Inbox zamiast Spam ani rzeczywistego replay/wygaśnięcia linku; te dwa zachowania pozostają pokryte testami automatycznymi. Włączenie recovery/Accounts w produkcji wymaga osobnego przygotowania i zgody.

### Rozdzielenie dowodów podczas przygotowania produkcji — 2026-10-07

| Scenariusz | Status |
| --- | --- |
| Rzeczywisty e-mail → nowe hasło → stare odrzucone → nowe działa na stagingowym koncie klienta | **OWNER-CONFIRMED REAL E2E PASS**, 2026-10-06 |
| Zmiana hasła właściciela lub reset jego MFA | **Nie wykonano i nie jest częścią tego testu** |
| Link otwarty w innej przeglądarce niż formularz prośby o reset | Mechanizm nie zależy od PKCE cookie przeglądarki wysyłającej; pokrycie automatyczne. Rzeczywisty wariant z dwoma przeglądarkami **NOT VERIFIED** |
| Produkcyjna konfiguracja Supabase/SMTP | Oddzielna kontrola ustawień; nie dowodzi wysyłki ani recovery na `rexbid.pl` |
| Rzeczywisty confirmation/recovery na docelowej domenie produkcyjnej | **NOT VERIFIED / NOT ACTIVATED**; jeden kontrolowany test po osobnej zgodzie, bez testowych kont kopiowanych ze stagingu |

Historia poniżej zachowuje suite 658/658 i Version ID z zakończonego sprintu recovery. Bieżący pełny suite przygotowania produkcji jest raportowany w aktualnym handoffie; nie należy przedstawiać historycznego testu pocztowego jako ponownie wykonanego. Samo otwarcie linku recovery nadal daje wyłącznie ograniczony grant do zmiany hasła, nie dostęp do panelu ani administracji.

Lokalny checkpoint obejmuje implementację recovery, szablon stagingowego Supabase, spójne ekrany konta, regresje i ten wynik QA. Nie obejmuje sekretów, prywatnych backupów ani danych kont. Bez pusha i bez kolejnego deployu.

## Diagnoza i granice dowodów

Obecny Site URL stagingowego Supabase i allowlista callbacku były poprawne. Custom SMTP było włączone, a dotychczasowy szablon recovery używał `ConfirmationURL`.

Potwierdzony problem kodu: dotychczasowy callback PKCE wymagał flow cookie i verifiera z przeglądarki wysyłającej prośbę o reset. Brak prawidłowego cookie/state/code kierował na zwykłe logowanie z `auth=failed`. Ponadto frontend wybierał formularz hasła na podstawie zwykłego zalogowania i wskazówki w URL, zamiast odrębnego uprawnienia do recovery. To nie jest niezawodny przepływ linku otwartego w innej przeglądarce.

Nie zachował się pełny wynik callbacku konkretnego maila zgłoszonego przez właściciela. Nie potwierdzono, który warunek zawiódł w tamtej próbie, ani że link naprawdę wygasł. Nie przedstawiamy hipotezy brakującego cookie jako odczytanego wyniku historycznego requestu.

Żółte barwy pochodziły z rzeczywistego, starego CSS w plikach konta. Odczyt assets nie potwierdził hipotezy starego cache. HTML konta ma `private, no-store`; pliki JS/CSS są rewalidowane i mają wersje w URL.

## Nowy przepływ

1. `/api/auth/recovery` nadal zwraca neutralną odpowiedź bez ujawniania istnienia konta. Dotychczasowy PKCE dla starszych wiadomości pozostaje obsługiwany.
2. Zapisany szablon stagingowego Supabase, którego kopia znajduje się w `config/supabase-staging-recovery-email.html`, prowadzi przez `SiteURL` do `/api/auth/recovery/confirm` z `TokenHash` i stałym typem `recovery`.
3. GET nie konsumuje tokenu Supabase. Przygotowuje wyłącznie zaszyfrowany, ograniczony cookie `__Host-rexbid_recovery` i przekierowuje na `/reset-hasla.html?recovery=ready`. Skaner mailowy wykonujący GET nie zmienia hasła.
4. Cookie ma `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, bez `Domain`, TTL 10 minut. To czas lokalnego formularza, nie deklaracja czasu ważności maila w Supabase. Prawdziwą ważność tokenu sprawdza Supabase przy POST.
5. `/api/auth/recovery-session` ujawnia tylko boolean. `recovery_ready` oznacza przygotowanie lokalnego formularza; nie oznacza wcześniejszego zatwierdzenia tokenu przez Supabase.
6. Formularz wymaga nowego hasła i powtórzenia. Dopiero jawny, chroniony Origin/Sec-Fetch-Site POST weryfikuje token przez serwerowe `/auth/v1/verify`, typ zawsze `recovery`. Następuje walidacja identity oraz istniejącego konta D1 przed zmianą hasła.
7. Recovery nie tworzy zwykłej sesji: nie daje dostępu do `/api/me`, ulubionych, portalu, prywatnych plików ani MFA. ID użytkownika nie pochodzi z body lub e-maila wpisanego przez przeglądarkę.
8. Po sukcesie backend próbuje globalnego wylogowania w Supabase, raportuje rzeczywisty wynik i czyści lokalne cookies recovery/flow/session. Już wydane access JWT mogą pozostawać ważne do wygaśnięcia; nie obiecujemy natychmiastowego unieważnienia każdego JWT.
9. Jeśli Supabase zweryfikuje OTP, ale odrzuci nowe hasło, ograniczony zweryfikowany grant pozwala poprawić hasło w tym samym TTL bez ponownego zużycia OTP. Użyty/wygasły token kończy się bezpiecznym 401, bez dostępu do konta.

Mechanizm `TokenHash` jest opisany w [dokumentacji szablonów Supabase](https://supabase.com/docs/guides/auth/auth-email-templates). Implementacja serwerowa korzysta z POST `/verify`, nie z automatycznego GET exchange.

## UI i regresje

Logowanie, rejestracja, prośba o reset i nowe hasło używają wspólnego `public/rexbid-account.css`: granat/czerwień, jasna karta, czytelne pola i focus. Techniczne etapy nie są pokazywane w normalnym UI.

Podczas rzeczywistego QA naprawiono dodatkowo:

- ukrywanie głównych linków logowanie/rejestracja przez zbyt szeroki selektor skryptu nawigacji;
- poziomy scroll mobile: styl przycisków formularza nadpisywał szerokość przycisku menu; styl jest teraz ograniczony do `main`;
- utratę prawidłowej identity podczas wtórnej niedostępności favorites 503.

Nie zmieniono kalkulatora, sync, danych realizacji, ról ani czynników MFA.

## Wykonane sprawdzenia

| Rodzaj | Wynik i zakres |
| --- | --- |
| Automatyczne | `node --test`: **658/658 PASS**; syntetyczny provider, zmiana hasła, stare hasło odrzucone/nowe przyjęte, replay i wygaśnięcie tokenu, TTL/tamper, CSRF, restricted grant, retry po odrzuceniu hasła i wynik wylogowania |
| Browser automated | Rzeczywiste HTML/JS/CSS przez jsdom: async bootstrap, dwa pola hasła, walidacja, POST, sukces, użyty link, unavailable, zachowanie linków i szerokość menu |
| Real browser desktop | Cztery ekrany i przejścia między nimi, granat/czerwień, widoczny formularz nowego hasła przy syntetycznym przygotowanym grancie; bez wpisania/submission hasła |
| Real browser mobile | Viewport 390×844, cztery ekrany, menu otwiera/zamyka się, brak poziomego scrolla; po poprawce document width 375px, menu 44px |
| Konsola | 0 zarejestrowanych błędów konsoli w karcie QA |
| Smoke staging | health/ready 200, auth config 200 enabled=true, recovery-session 200 false bez grantu, me 401 bez sesji; invalid link 303 do resetu; clean URLs 200; JS/CSS zgodne bajtowo |
| Cache/CORS | Auth HTML/API `private, no-store`, no-referrer, noindex; Auth bez CORS `*`; callback usuwa credential z URL przed ładowaniem assets |
| D1 read-only | users=2, favorites=2 przed/po; końcowo orders=2/messages=4/files=3 zgodne z poprzednim stanem; `rows_written=0`, `changed_db=false` |
| Narzędzia | Oba generatory `--check`, validator konfiguracji, syntax checks, staging dry-run i diff-check PASS |
| Supabase UI | Nowy polski szablon zapisany i potwierdzony po reload; sender/SMTP/Site URL/redirect allowlista odczytane bez sekretów |
| Rzeczywisty e-mail | **E2E PASS — potwierdzenie właściciela:** wiadomość dotarła, nowe hasło zapisane, stare odrzucone, nowe działa |

Screeny i logi operatora są poza Git, w `Documents/Codex/recovery-qa-20261006`; żaden screenshot nie zawiera prawdziwego tokenu lub hasła. Syntetyczny grant QA usunięto bez wylogowywania właściciela/klienta.

## Dostarczalność

- Supabase SMTP włączone: `smtp.resend.com:465`, nadawca `no-reply@powiadomienia.rexbid.pl`, nazwa REXBID; minimalny odstęp per-user 60 sekund. Sekret nie był odczytywany ani zmieniany.
- Dwa autorytatywne serwery OVH potwierdziły pełne, identyczne wartości DKIM oraz obu CNAME dostarczonych przez Resend. MX/SPF domeny głównej zachowane.
- SPF występuje na celach aliasów `send`/`rsend`; nie należy dodawać ich do głównego SPF OVH na podstawie samego adresu From.
- `_dmarc.rexbid.pl` oraz `_dmarc.powiadomienia.rexbid.pl` zwróciły NXDOMAIN. Przyszła propozycja po oddzielnej zgodzie: monitoring `v=DMARC1; p=none;` dla subdomeny wysyłkowej, bez wymyślonego adresu raportów.
- Tracking linków/otwarć w Resend **NOT VERIFIED** — dashboard wymaga osobnego logowania. Dla maili Auth rekomendowane wyłączenie tracking, aby nie przepisywać linków; [zalecenie Supabase](https://supabase.com/docs/guides/auth/auth-smtp).
- Nie posiadamy nagłówków `Authentication-Results`/`Return-Path` dostarczonej wiadomości. Nie potwierdzamy SPF/DKIM/DMARC PASS dla tamtego maila ani konkretnej przyczyny spamu. Brak DMARC, reputacja i tracking nie są dowodem przyczyny pojedynczej dostawy.
- Plan Free zachowany. Bez wiadomości testowych agenta, płatnych usług, upgrade i zmian DNS.

## Rollback / dalszy test

Zmiana wymaga zgodnego kodu i szablonu. Rollback stagingu do poprzedniego Workera `6da5587c-06f8-4e3f-9c04-73b00ae12561` wymaga również przywrócenia poprzedniego szablonu recovery. Sama stara wersja Workera nie obsłuży nowej trasy. Kopia poprzedniego szablonu pozostaje poza Git w katalogu QA. Bez rollbacku D1, usuwania kont lub resetowania MFA.

Kontrolowany test właściciela został wykonany i potwierdzony. Nie wymaga powtarzania. Dostarczalność do Inbox, tracking Resend i konfiguracja produkcyjnego Auth pozostają osobnymi tematami; produkcyjny recovery nadal niewłączony.
