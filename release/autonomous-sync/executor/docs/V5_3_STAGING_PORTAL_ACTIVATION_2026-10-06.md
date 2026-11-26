# V5.3 — aktywacja właściciela i portalu stagingowego

**AKTUALIZACJA 2026-10-06:** R2 aktywne, prywatne załączniki enabled na stagingu `1d9edf9e-9194-46b8-ae1a-10d4b136716b`; właściciel potwierdził 2FA, czasowy restart wyłączony. Historyczna blokada R2 poniżej jest zamknięta. [Aktualne testy i ograniczenia](V5_3_STAGING_PRIVATE_FILES_2026-10-06.md).

## Wykonane 2026-10-06

Właściciel potwierdził jedyne istniejące konto w stagingowym Supabase i jawnie zatwierdził przypisanie roli, konfigurację szyfrowania i prywatnych plików. Ponownie odczytano D1 i dopasowano konto do wcześniejszego odczytu (provider email, zweryfikowane, utworzone 28.09.2026 o 10:56:39 UTC). Nie przypisywano roli na podstawie e-maila Cloudflare.

- Konto Cloudflare: Tedn828, `7ff5a57444667c4eda2a6a7f0fc4120d`.
- Worker: **rexbid-auth-test**.
- D1: **rexbid-auth-test-db**, `acb3cb8e-69a2-459f-8a46-0f2f5b9004be`.
- Staging Version ID: **b4d44103-574e-47b4-94de-8b89e766a32b**.
- Poprzednie wydanie stagingu: `3753d454-0534-44e9-9dc1-904e758c7b8a`.
- Sekrety Cloudflare zainstalowane: `REXBID_OWNER_USER_ID`, `REXBID_PORTAL_DATA_KEYS`, `REXBID_PORTAL_ACTIVE_KEY_ID`. Wartości nie są zapisane w konfiguracji repo ani w tym raporcie.
- Klucz AES-256 wygenerowano kryptograficznie; keyring sprawdzono przez rzeczywisty moduł `portal/crypto.cjs`. Sekrety przesłano do Wrangler przez stdin, bez pliku z jawnymi wartościami i z sanitizacją logów.
- Kopia keyringu i przypisania właściciela: `.codex-wrangler-cache/staging-portal-keyring-20261006.dpapi`, zaszyfrowana Windows DPAPI **CurrentUser**, poza Git. Sprawdzono roundtrip przed uploadem. Odtworzenie wymaga tego profilu Windows; nie jest to przenośna kopia niezależna od komputera. Nie usuwać jej ani starych kluczy po pojawieniu się danych.
- `REXBID_PORTAL_ENABLED=enabled`, schema `0006`. Istniejące wymaganie AAL2 właściciela zachowane bez wyjątku stagingowego.
- `REXBID_PORTAL_FILES_ENABLED=disabled` do czasu aktywacji R2. Nie dodano fikcyjnego bindingu ani publicznego bucketa.

Nie modyfikowano produkcji, DNS, kont Supabase, danych Accounts/Sync ani migracji. **Nowe requesty Apibara w aktywacji: 0** (wcześniejsza integracja V5.3: 2 history calls, opisane osobno).

## Potwierdzone wyniki

- Pełne testy **613/613 PASS**.
- Validator konfiguracji, składnia 118 modułów / 11 inline, diff-check i staging dry-run PASS.
- Deploy wyłącznie staging PASS.
- `/health`, `/ready`: HTTP 200.
- `/api/portal/config`: HTTP 200, `enabled=true`, `uploads_enabled=false`.
- `/api/portal/me`, `/api/portal/orders`, `/api/portal/security` bez sesji: HTTP 401, `private, no-store`.
- Real browser `/administracja`: poprawny ekran logowania, koniec stanu ładowania, odnośnik powrotu po loginie. Zrzut `docs/qa/v5-3-local-staging-2026-10-06/portal-owner-activation-login.jpg`.
- Zalogowana konfiguracja TOTP, token AAL2 i operacje właściciela wymagają jednorazowej czynności właściciela. Nie wprowadzano haseł, kodów ani QR za właściciela.

## Zewnętrzna blokada R2

Ponowny odczyt R2 potwierdził Cloudflare **10042 — Please enable R2 through the Cloudflare Dashboard**. Samo uprawnienie Wrangler nie aktywuje tej usługi. Właściciel został poproszony o jeden krok: Cloudflare → Storage & databases → R2 → aktywacja usługi na koncie Tedn828. Cloudflare może wymagać danych rozliczeniowych. Nie akceptowano warunków ani nie wprowadzano danych płatniczych za właściciela.

Po potwierdzeniu aktywacji:

1. Sprawdzić właściwe konto i istniejące buckety.
2. Utworzyć oddzielny prywatny bucket stagingowy; wyłączyć publiczny r2.dev, nie dodawać custom domain ani publicznego CORS.
3. Dodać wyłącznie stagingowy binding `REXBID_PRIVATE_FILES`, włączyć `REXBID_PORTAL_FILES_ENABLED=enabled` i wdrożyć staging.
4. Sprawdzić prywatność, szyfrowany zapis/odczyt kontrolowanego pliku i odmowę pobrania bez sesji. Nie używać prywatnych rzeczywistych dokumentów do smoke testu.

Podstawowy portal oraz TOTP mogą działać bez załączników. Nie oznaczać R2/files jako VERIFIED przed tym sprawdzeniem.

## Instrukcja TOTP dla właściciela

1. Otwórz `https://rexbid-auth-test.tedn828.workers.dev/administracja`.
2. Wybierz **Zaloguj się do REXBID** i użyj potwierdzonego istniejącego konta. Link zachowuje powrót do administracji.
3. W sekcji **Ochrona panelu właściciela** wybierz **Skonfiguruj ochronę konta**.
4. W swojej aplikacji uwierzytelniającej dodaj konto przez skanowanie QR wyświetlonego na stronie. Klucz jest alternatywą, gdy skanowanie nie działa. QR, klucz i kody pozostają u właściciela — nie przesyłać ich w czacie ani na zrzutach.
5. Wpisz aktualny sześciocyfrowy kod w polu **Sześciocyfrowy kod z aplikacji uwierzytelniającej** i kliknij **Potwierdź dostęp właściciela**.
6. Oczekiwany komunikat: **Konto właściciela zostało zweryfikowane drugim składnikiem.** Dopiero potwierdzona przez serwer sesja `aal2` odblokowuje operacje administracyjne.

Jeśli konto ma już zweryfikowany TOTP, panel pokaże pole istniejącego kodu zamiast tworzenia kolejnego czynnika. Nie usuwać/resetować MFA w celu ominięcia tego kroku. Panel nie oferuje odzyskiwania utraconej aplikacji; wymaga ono bezpiecznej procedury po stronie właściciela i Supabase. Zabezpieczyć możliwość odzyskania aplikacji przed utratą urządzenia.

## Wyłączenie

Awaryjne wyłączenie portalu: `REXBID_PORTAL_ENABLED=disabled` w stagingowej konfiguracji i deploy **rexbid-auth-test**. Nie usuwać tabel, keyringu ani backupów. Produkcyjny profil pozostaje bez aktywacji portalu.
