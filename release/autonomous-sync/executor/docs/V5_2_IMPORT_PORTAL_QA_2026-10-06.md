# REXBID V5.2 — panel importów, QA i zakres

Data: 6 października 2026. Baza: V5.1 `bf226d65a8a4551d396eb3741c21fbcea5f72f14`. Wynik: **lokalny kandydat do uruchomienia na stagingu**, nie wdrożona produkcja.

## Wynik

Dodano panel klienta i właściciela, pięć nowych tabel jako propozycję migracji, prywatne API, szyfrowanie treści i plików, rzeczywistą integrację TOTP Supabase po stronie serwera oraz cztery polskie szkice odpowiedzi. Jedynym właścicielem portalu jest konto wskazane nieedytowalnym przez klienta `REXBID_OWNER_USER_ID`; wspólnik nie otrzymuje automatycznie uprawnień. Stare konta, ulubione, katalog i kalkulator zachowano.

Główne pliki: `portal/operations.cjs`, `portal/crypto.cjs`, `portal/attachments.cjs`, `portal/worker-router.cjs`, `portal/reply-drafts.cjs`, `auth/owner-mfa.cjs`, `public/panel.html`, `public/administracja.html`, `public/rexbid-client-portal.js`, `public/rexbid-client-portal.css`, `public/rexbid-owner-mfa.js`. `worker.js` inicjuje portal wyłącznie dla namespace `/api/portal`; standardowe odczyty katalogu nie wywołują modułu prywatnych danych.

## Weryfikacja

| Kontrola | Wynik i ograniczenia |
| --- | --- |
| Pełny pakiet Node tests | **562/562 PASS**, 0 skipped, 0 failures; 96 więcej niż V5.1 |
| Panel DOM | **20/20 PASS**: rzeczywisty HTML + JS w jsdom, role, prywatne linki, profile, paginacja klientów, konflikty, szkice, upload i bramka MFA |
| Komponent MFA DOM | **13/13 PASS**, sekret/kod nie zapisują się w storage, QR bez aktywnego markup, błędy i podwójne próby |
| Nowy resolver + serwer MFA | **18 nowych testów PASS**: realna kryptografia RSA/JWKS, AES cookies i SQLite z symulowanym transportem Supabase |
| Backend importów | **22/22 PASS**, SQLite, izolacja dwóch klientów, autoryzacja przed odszyfrowaniem/R2, MFA, notatki wewnętrzne, SQL binding, konflikt atomowej aktualizacji |
| Prywatne pliki/szyfrowanie | **7/7 PASS**, realny AES-GCM, losowe nonce, AAD, rotacja, podmiana/tamper, zaszyfrowane R2, limit także przy fałszywym Content-Length, nagłówki pobrania |
| Integracja Worker + portal | **5/5 PASS**, rzeczywisty router/backend/R2 crypto z wstrzykniętą testową capability konta; podpisana sesja jest testowana oddzielnie, nie udawana tym mockiem |
| Szkice odpowiedzi | **11/11 PASS**: wyłącznie dane klientowskie, brak zmyślonej wpłaty/ETA/kwoty/przyczyny, brak wysyłki |
| Regresja kalkulatora | **125 663 porównania PASS**, 610 lokalizacji, stawki oraz obliczenia niezmienione |
| Validator konfiguracji istniejących Workerów | PASS; nie zmieniono targetów baz ani aktywujących flag |
| Nieaktywny produkcyjny release | PASS; read-only, Auth/provider/sync nadal OFF; nie jest profilem uruchamiającym konta |
| Wrangler staging dry-run | PASS, 44 assets, 499,25 KiB / gzip 103,02 KiB, tylko staging D1; bundler poprawnie dołącza lazy router portalu |
| Wrangler release dry-run | PASS, 44 assets, 398,70 KiB / gzip 83,96 KiB, tylko produkcyjna D1; release nie został aktywowany |
| Diff / składnia | PASS |
| Cloudflare sesja | **You are not authenticated** — sprawdzono read-only; nie wykonywano logowania ani tymczasowego wdrożenia |
| Rzeczywisty browser E2E, Supabase TOTP, R2 zdalne, recovery/SMTP | **NOT VERIFIED**, wymagane po skonfigurowaniu stagingu |

Logi lokalnej weryfikacji są zachowane w `docs/qa/v5-2-import-portal-2026-10-06/`. Podgląd HTML z tego katalogu zawiera wyraźnie przykładowe dane i nie jest dowodem wykonania produkcyjnych API lub renderowanego testu przeglądarkowego.

## Zabezpieczenia, które faktycznie powstały

Wszystkie odczyty klienta mają warunek jego wewnętrznego user ID. Podmiana ID zamówienia lub pliku daje jednolite 404; serwer nie odczytuje wtedy prywatnego obiektu i niczego nie odszyfrowuje. Administrator wymaga zweryfikowanego `aal2`, również na stagingu. Publiczna rejestracja i dane profilu nie mogą nadawać roli właściciela. Serwer nie odczytuje ról z body, Bearer tokena przesłanego przez portal, URL user_id ani localStorage.

Weryfikacja TOTP obejmuje enrollment, challenge oraz verify. Challenge jest związany z właścicielem, faktorem i tożsamością dostawcy w szyfrowanym cookie HttpOnly, maksymalnie pięć minut. Zweryfikowany token nowej sesji musi wskazywać tę samą tożsamość i `aal2`. Istniejący drugi czynnik nie może zostać zastąpiony przez sesję AAL1. Żaden endpoint panelu nie usuwa ani nie resetuje czynnika.

Treści profili, wiadomości i notatek oraz pliki mają dodatkowe AES-256-GCM z AAD. Metadane D1 nie są wszystkie dodatkowo szyfrowane aplikacyjnie. Klucze, cookies i JWKS nie trafiają do publicznej konfiguracji. Brak konfiguracji szyfrowania, Auth lub bazy zamyka dostęp. Logi usuwają identyfikatory spraw i plików z route. Prywatne strony i API mają no-store/noindex; publiczny HTML panelu nie zawiera informacji klientów.

Właściciel i klient mogą zapisać wiadomość w swojej rozmowie. Administrator udostępnia plik jako klientowski albo wewnętrzny. Internal note nie zmienia widocznego klientowi statusu, wersji ani czasu aktualizacji. Aktualizacja publicznych faktów i wpis historii są atomowe; stale `expected_version` nie nadpisuje nowszej pracy.

## Ledger i rzeczywisty stan usług

**0 push, 0 deploy, 0 zmian DNS/MX, 0 zdalnych migracji, 0 utworzonych bucketów lub skrzynek, 0 wysłanych e-maili, 0 requestów Apibara.** Wszystkie zapisy testów wykonano w lokalnych fixture SQLite / pamięci R2. `wrangler whoami` jest odczytem statusu sesji, a dry-run buduje kod bez publikacji.

Nowa migracja jest wyłącznie w `docs/proposals/`, bez automatycznej migracji. Istniejące konfiguracje otrzymały tylko dwa dodatkowe guarded asset aliases `/panel` i `/administracja`; portal pozostaje OFF domyślnie. Propozycja adresu `kontakt@rexbid.pl` nie oznacza aktywnej skrzynki. Kanał kontaktu nadal jest draftem, dopóki nadawca/odbiór nie zostanie skonfigurowany.

Przed komercyjnymi kontami pozostały: uwierzytelniony staging i browser QA, pełny eksport nowych danych portalu, retencja/usuwanie i odtworzenie D1+R2+kluczy, własny SMTP z potwierdzonym doręczeniem, procedura awaryjna MFA i wspólny produkcyjny profil. Zakres oraz kolejność: `docs/REXBID_PORTAL_DEPLOYMENT_2026-10-06.md`.
