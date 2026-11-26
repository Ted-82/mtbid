# MFA — zatwierdzona rekonfiguracja jednego oczekującego TOTP

**AKTUALIZACJA:** właściciel potwierdził udaną weryfikację 2FA. W wydaniu `1d9edf9e-9194-46b8-ae1a-10d4b136716b` usunięto czasowe uprawnienia restartu; POST restart-pending zwraca 404. Zweryfikowany czynnik zachowany. Poniższa instrukcja restartu jest historyczna i nie obowiązuje. [Bieżący stan](V5_3_STAGING_PRIVATE_FILES_2026-10-06.md).

## Dowód i zgoda właściciela

Właściciel przekazał wynik rzeczywistej próby: `factor_state HTTP 200`, `challenge HTTP 200`, `verify HTTP 400 / Supabase 422 / mfa_verification_failed`; zweryfikowane TOTP 0, oczekujące 1. To potwierdza odrzucenie kodu weryfikacji, a nie niedostępność MFA. Sam status nie rozstrzyga, czy problemem był niewłaściwy klucz w aplikacji, czas urządzenia czy inna przyczyna niedopasowania kodu.

Właściciel jawnie zezwolił na usunięcie wyłącznie tego jednego niezweryfikowanego TOTP na stagingu, po ponownym sprawdzeniu właściciela i faktorów. Jakikolwiek zweryfikowany czynnik wymaga przerwania operacji. Skanowanie nowego QR i potwierdzenie kodu wykonuje właściciel.

## Wdrożenie i bieżący wynik

- Worker **rexbid-auth-test**, Version **b5200dc0-a934-4665-a838-c3c5799b76fd**.
- Poprzednia wersja `6d654598-11e5-47ab-887e-6f45e9cb7acb`.
- D1 `rexbid-auth-test-db`, ID `acb3cb8e-69a2-459f-8a46-0f2f5b9004be`.
- Asset `rexbid-owner-mfa.js?v=eec0cf23a9a9` zgodny bajtowo z lokalnym plikiem.
- **Rzeczywistego czynnika jeszcze nie usunięto.** Dostępna agentowi przeglądarka ma sesję anonimową. Nie odczytano sekretu, QR ani kodu właściciela i nie wykonywano live enrollment/unenroll/verify. Przygotowano jeden przycisk działający w jego zalogowanej sesji.
- Konto, hasło, rola i sekrety portalu nie były zmieniane; nie migrowano D1. Zdalny SELECT: `users=1`, `user_favorites=1`, `rows_written=0`, `changed_db=false`.
- Produkcja i DNS bez zmian. Apibara 0. Working tree zachowany, bez resetu/commitu/pusha.

## Ograniczona operacja

Nowy `POST /api/portal/security/restart-pending`:

1. Wymaga dokładnego HTTPS origin stagingu, dotychczasowych flag Auth oraz osobnej jawnej flagi `REXBID_OWNER_MFA_PENDING_RESTART=enabled`.
2. Okno zgody: istniejący czynnik utworzony nie później niż **2026-10-06 09:14:04 UTC**, operacja dostępna do **2026-10-07 09:14:04 UTC**. Okno nie może przekraczać 24 godzin. Nowy TOTP utworzony po granicy zgody nigdy nie kwalifikuje się do ponownego usunięcia przez tę operację.
3. Wymaga sesji AAL1 potwierdzonej kryptograficznie i przez Supabase, zweryfikowanego konta D1 wskazanego istniejącym `REXBID_OWNER_USER_ID`, same-origin/CSRF i istniejącej kontroli częstotliwości Auth.
4. Wymaga pełnej, nieuciętej listy czynników: dokładnie jeden czynnik, typ TOTP, `unverified`, wiarygodny `created_at`, zero zweryfikowanych czynników dowolnego typu. Nieznany stan oznacza odmowę.
5. Ponownie sprawdza właściciela i czynniki; adapter jeszcze raz weryfikuje identity i aktualną listę bezpośrednio przed `DELETE /auth/v1/factors/:factor_id`. Nie używa service-role ani AAL2. [Supabase wymaga AAL2 przy usuwaniu zweryfikowanego czynnika](https://supabase.com/docs/reference/javascript/auth-mfa-unenroll).
6. Usuwa tylko wskazany, ponownie zatwierdzony identyfikator. Brak pętli, retry lub zbiorczego unenrollmentu. Po odpowiedzi Supabase odczytuje stan ponownie i wymaga zera czynników, aby potwierdzić sukces. Czyści wyłącznie cookie poprzedniego challenge, nie konto/rolę/hasło/sekrety portalu.
7. Nie ma transakcji obejmującej zewnętrzny odczyt i DELETE Supabase. UI blokuje równoległe akcje w bieżącej karcie i instruuje, aby nie weryfikować MFA jednocześnie w innej karcie. Testy pokrywają zmianę na verified podczas obu kontroli przed usunięciem. Nie twierdzimy, że REST zapewnia globalną blokadę innych klientów Supabase.

Po potwierdzonym usunięciu frontend w tej samej akcji uruchamia dotychczasowy, niezależnie chroniony enrollment. Nowy QR i klucz pozostają wyłącznie w odpowiedzi do przeglądarki właściciela i w bieżącym formularzu. Nie trafiają do diagnostyki, logów ani storage UI. Gdy usunięcie lub readback zawiedzie, nie uruchamia się enrollment ani retry.

To możliwość wykonania raz zatwierdzonej naprawy starego czynnika, nie ogólny mechanizm resetowania MFA. Po wyniku właściciela usunąć trzy tymczasowe zmienne stagingu i wycofać dostępność przycisku; samo okno wygaśnie także bez następnego deployu.

## Testy

- **632/632 PASS**, w tym 39 testów MFA.
- Nowe regresje: recheck owner/factors przed DELETE i odczyt zera po; verified TOTP/phone/webauthn; czynnik verified poza ograniczoną listą; niekompletna lista; wiele faktorów; brak daty; AAL2; błędny właściciel; CSRF; zły host; wygaśnięcie; nowy czynnik poza zakresem zgody; zmiana verified podczas kontroli; błąd upstream bez retry.
- Test rzeczywistego JS w DOM: jeden jawny klik → usunięcie starego pending → enrollment → QR; bez wysyłania kodu weryfikacji, podwójnego kliknięcia lub zapisu klucza w diagnostyce.
- Zachowana wcześniejsza regresja realistycznego SVG Supabase → backend → normalizator QR frontend. Nie jest to test prawdziwego QR właściciela.
- Kalkulator: 125 663 porównania PASS. Oba generatory, konfiguracja, syntax i diff-check PASS. Staging dry-run/deploy PASS.
- `/health`, `/ready`, `/administracja` 200; anonimowe security/me/orders 401 private/no-store; GET restart-pending 405 (wymagany POST). Asset zgodny. W prawdziwej przeglądarce anonimowy panel pozostaje zamknięty, brak przycisku resetu i brak QR.

## Jeden następny krok

W zalogowanej [administracji stagingu](https://rexbid-auth-test.tedn828.workers.dev/administracja) odświeżyć stronę i kliknąć raz **„Rozpocznij konfigurację QR od nowa”**. QR skanuje i kod potwierdza wyłącznie właściciel; nie przesyła ich w czacie.
