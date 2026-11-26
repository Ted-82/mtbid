# V5.3.1 — niedokończony TOTP i diagnostyka HTTP 503

## Stan wdrożenia

- Wyłącznie Worker `rexbid-auth-test`, Version **6d654598-11e5-47ab-887e-6f45e9cb7acb**.
- Poprzednia wersja: `3b14561e-c624-45a8-b7f9-fbab60ef468f`.
- D1 `rexbid-auth-test-db`, `acb3cb8e-69a2-459f-8a46-0f2f5b9004be`.
- SHA256 konfiguracji stagingu nadal `6f576cdb6a04ca93aa0bc8a208b7791e7dfd0d7b0b87b65d520f306cd0129db1`.
- Cały dotychczasowy working tree zachowany. Bez zmian sekretów, przypisania właściciela, rzeczywistych czynników MFA, produkcji, DNS i D1. Bez commitu/pusha. Apibara **0**.

## Diagnoza: dowód a hipoteza

Kliknięcie „Skonfiguruj ochronę konta” wywołuje `POST /api/portal/security/enroll`, który po sprawdzeniu sesji właściciela wywołuje Supabase `POST /auth/v1/factors`. GET `/api/portal/security` to osobny odczyt aktualnego stanu. Dotychczas frontend przedstawiał wszystkie odpowiedzi 503 identycznie; backend enrollment zamieniał wszystkie wyjątki na 503, tracąc status i kod Supabase.

Potwierdzony błąd kodu: GET udostępniał bezpieczne metadane niezweryfikowanego TOTP, ale UI je ignorował. Oferował kolejny enrollment ze stałym `friendly_name`. Według [implementacji Supabase Auth](https://github.com/supabase/auth/blob/master/internal/api/mfa.go) również niezweryfikowany czynnik zajmuje nazwę; próba utworzenia drugiego pod tą samą nazwą kończy się `422 mfa_factor_name_conflict`. Adapter/handler ukrywał ten konflikt pod 503. Przypadek jest odtworzony i zabezpieczony testami bez połączenia z Supabase.

**Nie można potwierdzić, że właśnie ten kod Supabase wystąpił w konkretnej wcześniejszej próbie właściciela.** Cloudflare settings GET zwrócił 200 i `observability=null`; odczyt historycznej telemetrii zwrócił 403/code10000. Nie ma dostępnej odpowiedzi z tej próby. Przeglądarka dostępna agentowi jest anonimowa. Nie pobierano sesji z innego profilu, nie używano service-role ani nie tworzono nowego enrollmentu w celu odtworzenia błędu. Historyczny status upstream i rzeczywista lista czynników konta pozostają **NOT VERIFIED**.

## Zmiana

1. Panel z oczekującym TOTP pokazuje formularz dokończenia weryfikacji istniejącego czynnika. Nie wykonuje ponownego enrollmentu. Wyjaśnia, że Supabase nie udostępnia starego QR/klucza ponownie.
2. Backend odrzuca ponowny enrollment przy istniejącym oczekującym TOTP: 409 `MFA_ENROLLMENT_PENDING`, bez requestu `/factors` i bez usuwania czynnika.
3. Zweryfikowane MFA ma pierwszeństwo. AAL1 nie może ominąć zweryfikowanego czynnika przez oczekujący TOTP. Zwracane `has_verified_factor` chroni także przypadek zweryfikowanego czynnika poza ograniczoną listą wyświetlania.
4. Konflikt Supabase (również wyścig dwóch kart) →409; limit prób →429; wygasła sesja →401; niedostępność/wyłączone TOTP →503 z odrębnym bezpiecznym kodem. Dozwolone są wyłącznie stałe kody z allowlisty, nigdy komunikaty providera.
5. Stagingowa odpowiedź zawiera `diagnostic`: losowy request ID, operacja, etap, status HTTP, status upstream jeśli dostępny, bezpieczny kod, liczniki zweryfikowanych/oczekujących TOTP dopiero po autoryzacji właściciela. Nie ma identyfikatorów użytkownika/czynników, e-maili, tokenów, cookies, kodów, URI, sekretów ani QR.
6. Bramka diagnostyki: dokładny HTTPS origin stagingu oraz trzy dotychczasowe flagi diagnostyczne. Sama flaga na innym hoście nie wystarcza. Frontend ma dodatkową kontrolę origin i zamkniętą allowlistę pól/kodów; przechowuje w DOM najwyżej pięć ostatnich bezpiecznych wpisów, bez localStorage. Sekcja „Diagnostyka MFA — staging” pozwala ustalić endpoint i etap bez przeszukiwania taila.
7. Błąd konfliktu nie uruchamia automatycznego retry. Przycisk sprawdzenia istniejącej konfiguracji wykonuje GET; nie tworzy ani nie usuwa TOTP.

## Weryfikacja

- **624/624 PASS** w pełnym `node --test`; **31 testów MFA**. Nowe testy: wznowienie pending bez enrollment/delete, konflikt i mapowanie HTTP, konfiguracja/D1/owner stage, izolacja produkcji i sanitizacja, UI pending → challenge → verify, priorytet istniejącego MFA.
- Regresja kalkulatora: **125 663 porównania PASS**. Oba generatory: 610 lokalizacji PASS. Walidatory Worker/release, składnia i diff-check PASS.
- Staging dry-run i deploy PASS; aktualny asset `rexbid-owner-mfa.js?v=880f0d84f40d` bajtowo zgodny z lokalnym plikiem.
- `/health`, `/ready`, `/administracja`, `/api/portal/config` →200. Portal nadal ON, dotychczasowa konfiguracja R2/plików bez zmian.
- Anonimowe `/api/portal/security`, `/api/portal/me`, `/api/portal/orders` →401 i `private, no-store`. Diagnostyka GET pokazuje etap `session`, bez liczników faktorów i danych prywatnych. Nie wywołuje Supabase MFA.
- Przeglądarka rzeczywistego stagingu: nowy asset, bramka logowania, bez QR/klucza i bez dostępu do administracji anonimowo. **Nie jest to weryfikacja rzeczywistego AAL2 właściciela.**
- Zdalny SELECT: `users=1`, `user_favorites=1`, `rows_written=0`, `changed_db=false`.

## Jeden następny krok właściciela

Odświeżyć zalogowaną [administrację stagingu](https://rexbid-auth-test.tedn828.workers.dev/administracja), rozwinąć „Diagnostyka MFA — staging” i przekazać tylko wyświetlony bezpieczny wpis. Sam odczyt nie tworzy i nie usuwa TOTP. Nie przesyłać QR, klucza ani sześciocyfrowego kodu.

Jeśli oczekująca konfiguracja istnieje, ale konto nie zostało wcześniej dodane w aplikacji, dalsza ponowna konfiguracja wymaga odrębnej, świadomej decyzji właściciela. Ten sprint niczego nie resetuje ani nie usuwa, również spośród niezweryfikowanych czynników.
